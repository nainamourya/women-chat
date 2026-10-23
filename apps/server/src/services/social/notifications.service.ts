import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { comments, notifications, posts, users } from "../../db/schema.js";
import { emitToUser } from "../../socket/index.js";
import { olderThan, tsText } from "./pagination.js";
import { decodeCursor, toPage, type Page } from "./validation.js";
import { notBlockedWith, postImageUrl, toUserCard, visibleMember, type UserCard } from "./access.js";

type NotificationType = "follow" | "like" | "comment" | "message";

export type NewNotification = {
  recipientId: string;
  actorId: string;
  type: NotificationType;
  dedupeKey: string;
  postId?: string | null;
  commentId?: string | null;
  conversationId?: string | null;
};

// Real-time pushes are best-effort: the socket server may not be running (for
// example in route-level tests) and the persisted row is the source of truth.
export function pushToUser(userId: string, event: string, payload: unknown): void {
  try {
    emitToUser(userId, event, payload);
  } catch {
    // no socket server in this process
  }
}

// Idempotent: the unique (user_id, dedupe_key) index turns a retried request
// into a no-op, so repeated taps or network retries never stack duplicate
// notifications. Never notifies someone about their own action.
export async function createNotification(input: NewNotification): Promise<boolean> {
  if (input.recipientId === input.actorId) return false;
  const inserted = await db
    .insert(notifications)
    .values({
      userId: input.recipientId,
      actorId: input.actorId,
      type: input.type,
      dedupeKey: input.dedupeKey,
      postId: input.postId ?? null,
      commentId: input.commentId ?? null,
      conversationId: input.conversationId ?? null,
    })
    .onConflictDoNothing({ target: [notifications.userId, notifications.dedupeKey] })
    .returning({ id: notifications.id });
  if (inserted.length > 0) pushToUser(input.recipientId, "notification:new", { type: input.type });
  return inserted.length > 0;
}

// Messages are the one type that should resurface: a new message in a
// conversation you already cleared brings its notification back to unread,
// instead of creating one row per message.
export async function upsertMessageNotification(input: {
  recipientId: string;
  actorId: string;
  conversationId: string;
}): Promise<void> {
  if (input.recipientId === input.actorId) return;
  await db
    .insert(notifications)
    .values({
      userId: input.recipientId,
      actorId: input.actorId,
      type: "message",
      dedupeKey: `message:${input.conversationId}`,
      conversationId: input.conversationId,
    })
    .onConflictDoUpdate({
      target: [notifications.userId, notifications.dedupeKey],
      set: { actorId: input.actorId, readAt: null, createdAt: sql`now()` },
    });
  pushToUser(input.recipientId, "notification:new", { type: "message" });
}

export type NotificationItem = {
  id: string;
  type: NotificationType;
  createdAt: Date;
  read: boolean;
  actor: UserCard;
  postId: string | null;
  postImageUrl: string | null;
  commentPreview: string | null;
  conversationId: string | null;
};

// A member only ever sees notifications addressed to them, and only ones whose
// actor is still a visible member who has not blocked them (or been blocked).
export async function listNotifications(viewerId: string, rawCursor: string | undefined, limit: number): Promise<Page<NotificationItem>> {
  const cursor = decodeCursor(rawCursor);
  const rows = await db
    .select({
      id: notifications.id,
      type: notifications.type,
      createdAt: notifications.createdAt,
      ts: tsText(notifications.createdAt),
      readAt: notifications.readAt,
      postId: notifications.postId,
      conversationId: notifications.conversationId,
      commentContent: comments.content,
      postExists: posts.id,
      actorUsername: users.username,
      actorDisplayName: users.displayName,
      actorAvatarKey: users.avatarKey,
    })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.actorId))
    .leftJoin(comments, eq(comments.id, notifications.commentId))
    .leftJoin(posts, eq(posts.id, notifications.postId))
    .where(
      and(
        eq(notifications.userId, viewerId),
        visibleMember,
        notBlockedWith(viewerId, users.id),
        olderThan(notifications.createdAt, notifications.id, cursor),
      ),
    )
    .orderBy(desc(notifications.createdAt), desc(notifications.id))
    .limit(limit + 1);

  const page = toPage(rows, limit);
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((row) => ({
      id: row.id,
      type: row.type,
      createdAt: row.createdAt,
      read: row.readAt !== null,
      actor: toUserCard({ username: row.actorUsername, displayName: row.actorDisplayName, avatarKey: row.actorAvatarKey }),
      postId: row.postExists ? row.postId : null,
      postImageUrl: row.postExists && row.postId ? postImageUrl(row.postId) : null,
      commentPreview: row.commentContent ? row.commentContent.slice(0, 120) : null,
      conversationId: row.conversationId,
    })),
  };
}

export async function unreadNotificationCount(viewerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(notifications)
    .innerJoin(users, eq(users.id, notifications.actorId))
    .where(and(eq(notifications.userId, viewerId), isNull(notifications.readAt), visibleMember, notBlockedWith(viewerId, users.id)));
  return row?.n ?? 0;
}

export async function markNotificationsRead(viewerId: string, ids?: string[]): Promise<void> {
  const filter = ids && ids.length > 0 ? inArray(notifications.id, ids) : undefined;
  await db
    .update(notifications)
    .set({ readAt: sql`now()` })
    .where(and(eq(notifications.userId, viewerId), isNull(notifications.readAt), filter));
}
