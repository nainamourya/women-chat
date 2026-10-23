import { and, asc, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { comments, follows, postLikes, posts, users } from "../../db/schema.js";
import { AuthError } from "../auth.service.js";
import {
  findVisibleMemberByUsername,
  loadViewer,
  notBlockedWith,
  notFound,
  postImageUrl,
  toUserCard,
  visibleMember,
  type UserCard,
} from "./access.js";
import { sanitizeImage } from "./imageSanitizer.js";
import { deleteMedia, newMediaKey, readMedia, writeMedia } from "./mediaStorage.js";
import { createNotification } from "./notifications.service.js";
import { newerThan, olderThan, tsText } from "./pagination.js";
import { captionSchema, commentSchema, decodeCursor, toPage, type Page } from "./validation.js";

export type PostView = {
  id: string;
  author: UserCard;
  caption: string;
  imageUrl: string;
  createdAt: Date;
  likeCount: number;
  commentCount: number;
  likedByViewer: boolean;
  isOwner: boolean;
};

type PostRow = {
  id: string;
  caption: string;
  createdAt: Date;
  ts?: string;
  authorId: string;
  username: string | null;
  displayName: string;
  avatarKey: string | null;
};

// Turns a page of post rows into API objects with exactly three extra
// queries for the whole page (like counts, comment counts, the viewer's own
// likes) rather than three per post.
async function hydrate(viewerId: string, rows: PostRow[]): Promise<PostView[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [likeRows, commentRows, mine] = await Promise.all([
    db
      .select({ postId: postLikes.postId, n: sql<number>`count(*)::int` })
      .from(postLikes)
      .where(inArray(postLikes.postId, ids))
      .groupBy(postLikes.postId),
    db
      .select({ postId: comments.postId, n: sql<number>`count(*)::int` })
      .from(comments)
      .where(inArray(comments.postId, ids))
      .groupBy(comments.postId),
    db
      .select({ postId: postLikes.postId })
      .from(postLikes)
      .where(and(inArray(postLikes.postId, ids), eq(postLikes.userId, viewerId))),
  ]);
  const likes = new Map(likeRows.map((r) => [r.postId, r.n]));
  const commentCounts = new Map(commentRows.map((r) => [r.postId, r.n]));
  const liked = new Set(mine.map((r) => r.postId));

  return rows.map((row) => ({
    id: row.id,
    author: toUserCard({ username: row.username, displayName: row.displayName, avatarKey: row.avatarKey }),
    caption: row.caption,
    imageUrl: postImageUrl(row.id),
    createdAt: row.createdAt,
    likeCount: likes.get(row.id) ?? 0,
    commentCount: commentCounts.get(row.id) ?? 0,
    likedByViewer: liked.has(row.id),
    isOwner: row.authorId === viewerId,
  }));
}

const postColumns = {
  id: posts.id,
  caption: posts.caption,
  createdAt: posts.createdAt,
  ts: tsText(posts.createdAt),
  authorId: posts.authorId,
  username: users.username,
  displayName: users.displayName,
  avatarKey: users.avatarKey,
};

function postCursorFilter(rawCursor: string | undefined) {
  return olderThan(posts.createdAt, posts.id, decodeCursor(rawCursor));
}

// A post is visible to a signed-in, eligible member when its author is a
// visible member and neither side has blocked the other. This is the single
// rule behind the feed, profile grids, post pages, share links and the media
// route — anything else is the same 404.
async function findVisiblePost(viewerId: string, postId: string) {
  const [row] = await db
    .select({ ...postColumns, imageKey: posts.imageKey, imageMimeType: posts.imageMimeType })
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(eq(posts.id, postId), visibleMember, notBlockedWith(viewerId, posts.authorId)))
    .limit(1);
  if (!row) throw notFound("That post isn't available.");
  return row;
}

export async function createPost(viewerId: string, input: { caption?: string; imageBase64: string; mimeType: string }): Promise<PostView> {
  const viewer = await loadViewer(viewerId);
  const parsedCaption = captionSchema.safeParse(input.caption ?? "");
  if (!parsedCaption.success) throw new AuthError(parsedCaption.error.issues[0]?.message ?? "Invalid caption.", 400);

  const image = sanitizeImage(input.imageBase64, input.mimeType);
  const key = newMediaKey("posts", image.ext);
  await writeMedia(key, image.buffer, image.mimeType);

  try {
    const [created] = await db
      .insert(posts)
      .values({ authorId: viewer.id, caption: parsedCaption.data, imageKey: key, imageMimeType: image.mimeType })
      .returning({ id: posts.id });
    return await getPost(viewerId, created!.id);
  } catch (err) {
    await deleteMedia(key);
    throw err;
  }
}

export async function getPost(viewerId: string, postId: string): Promise<PostView> {
  await loadViewer(viewerId);
  const row = await findVisiblePost(viewerId, postId);
  const [view] = await hydrate(viewerId, [row]);
  return view!;
}

// Only the author can delete; "not yours" is indistinguishable from "not found".
export async function deletePost(viewerId: string, postId: string): Promise<void> {
  await loadViewer(viewerId);
  const [row] = await db
    .delete(posts)
    .where(and(eq(posts.id, postId), eq(posts.authorId, viewerId)))
    .returning({ imageKey: posts.imageKey });
  if (!row) throw notFound("That post isn't available.");
  await deleteMedia(row.imageKey);
}

export async function listUserPosts(viewerId: string, username: string, rawCursor: string | undefined, limit: number): Promise<Page<PostView>> {
  await loadViewer(viewerId);
  const author = await findVisibleMemberByUsername(viewerId, username);
  const rows = await db
    .select(postColumns)
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(and(eq(posts.authorId, author.id), postCursorFilter(rawCursor)))
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);
  const page = toPage(rows, limit);
  return { nextCursor: page.nextCursor, items: await hydrate(viewerId, page.items) };
}

// Posts from people the viewer follows, plus their own, newest first.
export async function getFeed(viewerId: string, rawCursor: string | undefined, limit: number): Promise<Page<PostView>> {
  await loadViewer(viewerId);
  const rows = await db
    .select(postColumns)
    .from(posts)
    .innerJoin(users, eq(users.id, posts.authorId))
    .where(
      and(
        visibleMember,
        notBlockedWith(viewerId, posts.authorId),
        or(
          eq(posts.authorId, viewerId),
          sql`${posts.authorId} in (select ${follows.followeeId} from ${follows} where ${follows.followerId} = ${viewerId})`,
        ),
        postCursorFilter(rawCursor),
      ),
    )
    .orderBy(desc(posts.createdAt), desc(posts.id))
    .limit(limit + 1);
  const page = toPage(rows, limit);
  return { nextCursor: page.nextCursor, items: await hydrate(viewerId, page.items) };
}

export async function readPostImage(viewerId: string, postId: string): Promise<{ bytes: Buffer; mimeType: string }> {
  await loadViewer(viewerId);
  const row = await findVisiblePost(viewerId, postId);
  try {
    return { bytes: await readMedia(row.imageKey), mimeType: row.imageMimeType };
  } catch {
    throw notFound("That image isn't available.");
  }
}

export async function readAvatarImage(viewerId: string, username: string): Promise<{ bytes: Buffer; mimeType: string }> {
  await loadViewer(viewerId);
  const owner = await findVisibleMemberByUsername(viewerId, username);
  if (!owner.avatarKey) throw notFound("No profile photo.");
  const mimeType = owner.avatarKey.endsWith(".png") ? "image/png" : owner.avatarKey.endsWith(".webp") ? "image/webp" : "image/jpeg";
  try {
    return { bytes: await readMedia(owner.avatarKey), mimeType };
  } catch {
    throw notFound("No profile photo.");
  }
}

// --- Likes ---------------------------------------------------------------

async function likeCount(postId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(postLikes).where(eq(postLikes.postId, postId));
  return row?.n ?? 0;
}

export async function likePost(viewerId: string, postId: string): Promise<{ liked: true; likeCount: number }> {
  const viewer = await loadViewer(viewerId);
  const post = await findVisiblePost(viewerId, postId);
  const inserted = await db
    .insert(postLikes)
    .values({ postId, userId: viewer.id })
    .onConflictDoNothing({ target: [postLikes.postId, postLikes.userId] })
    .returning({ postId: postLikes.postId });
  if (inserted.length > 0) {
    await createNotification({
      recipientId: post.authorId,
      actorId: viewer.id,
      type: "like",
      postId,
      dedupeKey: `like:${viewer.id}:${postId}`,
    });
  }
  return { liked: true, likeCount: await likeCount(postId) };
}

export async function unlikePost(viewerId: string, postId: string): Promise<{ liked: false; likeCount: number }> {
  await loadViewer(viewerId);
  await findVisiblePost(viewerId, postId);
  await db.delete(postLikes).where(and(eq(postLikes.postId, postId), eq(postLikes.userId, viewerId)));
  return { liked: false, likeCount: await likeCount(postId) };
}

// --- Comments ------------------------------------------------------------

export type CommentView = {
  id: string;
  author: UserCard;
  content: string;
  createdAt: Date;
  canDelete: boolean;
};

export async function listComments(viewerId: string, postId: string, rawCursor: string | undefined, limit: number): Promise<Page<CommentView>> {
  await loadViewer(viewerId);
  const post = await findVisiblePost(viewerId, postId);
  const cursor = decodeCursor(rawCursor);
  const rows = await db
    .select({
      id: comments.id,
      content: comments.content,
      createdAt: comments.createdAt,
      ts: tsText(comments.createdAt),
      authorId: comments.authorId,
      username: users.username,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
    })
    .from(comments)
    .innerJoin(users, eq(users.id, comments.authorId))
    .where(
      and(
        eq(comments.postId, postId),
        // Hide comments from people who are no longer visible members, or whom
        // the viewer has blocked (or who blocked the viewer).
        visibleMember,
        notBlockedWith(viewerId, comments.authorId),
        newerThan(comments.createdAt, comments.id, cursor),
      ),
    )
    .orderBy(asc(comments.createdAt), asc(comments.id))
    .limit(limit + 1);

  const page = toPage(rows, limit);
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((row) => ({
      id: row.id,
      author: toUserCard({ username: row.username, displayName: row.displayName, avatarKey: row.avatarKey }),
      content: row.content,
      createdAt: row.createdAt,
      // The author of a comment, and the owner of the post it is on, may remove it.
      canDelete: row.authorId === viewerId || post.authorId === viewerId,
    })),
  };
}

export async function addComment(viewerId: string, postId: string, rawContent: string): Promise<CommentView> {
  const viewer = await loadViewer(viewerId);
  const post = await findVisiblePost(viewerId, postId);
  const parsed = commentSchema.safeParse(rawContent);
  if (!parsed.success) throw new AuthError(parsed.error.issues[0]?.message ?? "Invalid comment.", 400);

  const [created] = await db
    .insert(comments)
    .values({ postId, authorId: viewer.id, content: parsed.data })
    .returning({ id: comments.id, createdAt: comments.createdAt });

  await createNotification({
    recipientId: post.authorId,
    actorId: viewer.id,
    type: "comment",
    postId,
    commentId: created!.id,
    dedupeKey: `comment:${created!.id}`,
  });

  return {
    id: created!.id,
    author: toUserCard(viewer),
    content: parsed.data,
    createdAt: created!.createdAt,
    canDelete: true,
  };
}

export async function deleteComment(viewerId: string, commentId: string): Promise<void> {
  await loadViewer(viewerId);
  const [row] = await db
    .select({ id: comments.id, authorId: comments.authorId, postAuthorId: posts.authorId })
    .from(comments)
    .innerJoin(posts, eq(posts.id, comments.postId))
    .where(eq(comments.id, commentId))
    .limit(1);
  // Not found and not permitted look identical.
  if (!row || (row.authorId !== viewerId && row.postAuthorId !== viewerId)) throw notFound("That comment isn't available.");
  await db.delete(comments).where(eq(comments.id, commentId));
}
