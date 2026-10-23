import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { conversations, directMessages, posts, users, type Conversation } from "../../db/schema.js";
import { AuthError } from "../auth.service.js";
import {
  findVisibleMemberByUsername,
  isBlockedEitherWay,
  loadViewer,
  notBlockedWith,
  notFound,
  postImageUrl,
  SocialError,
  toUserCard,
  visibleMember,
  type UserCard,
} from "./access.js";
import { isMutualFollow } from "./follows.service.js";
import { pushToUser, upsertMessageNotification } from "./notifications.service.js";
import { olderThan, tsText } from "./pagination.js";
import { decodeCursor, messageSchema, toPage, uuidSchema, type Page } from "./validation.js";

// Private messaging between two members who follow each other.
//
// The rule "may these two exchange messages right now?" is evaluated on the
// server, from the live `follows` and `blocks` tables, every time a
// conversation is opened or a message is sent. It is never stored on the
// conversation, so unfollowing or blocking takes effect immediately and an old
// conversation cannot be used to bypass it. Messages are stored in plain text
// in PostgreSQL: this is NOT end-to-end encrypted, and the product must not
// claim otherwise.

type Side = "a" | "b";

function sideOf(conversation: Conversation, userId: string): Side | null {
  if (conversation.userAId === userId) return "a";
  if (conversation.userBId === userId) return "b";
  return null;
}

function otherUserId(conversation: Conversation, userId: string): string {
  return conversation.userAId === userId ? conversation.userBId : conversation.userAId;
}

// Membership check shared by every conversation endpoint. A conversation the
// viewer is not part of is a 404, indistinguishable from one that doesn't exist.
async function loadMembership(viewerId: string, conversationId: string) {
  if (!uuidSchema.safeParse(conversationId).success) throw notFound("Conversation not found.");
  const conversation = await db.query.conversations.findFirst({ where: eq(conversations.id, conversationId) });
  if (!conversation || !sideOf(conversation, viewerId)) throw notFound("Conversation not found.");
  const otherId = otherUserId(conversation, viewerId);
  const other = await db.query.users.findFirst({ where: eq(users.id, otherId) });
  return { conversation, other: other! };
}

export type MessageView = {
  id: string;
  conversationId: string;
  senderUsername: string;
  fromMe: boolean;
  content: string;
  createdAt: Date;
  sharedPost: { id: string; imageUrl: string; caption: string; authorUsername: string } | null;
  // True when the message shared a post that has since been deleted or is no longer visible.
  sharedPostUnavailable: boolean;
};

export type ConversationView = {
  id: string;
  other: UserCard;
  lastMessage: { content: string; createdAt: Date; fromMe: boolean; isPostShare: boolean } | null;
  lastMessageAt: Date;
  unreadCount: number;
  // False when the pair no longer follows each other: history stays readable,
  // sending is refused.
  canSend: boolean;
};

async function canExchange(viewerId: string, otherId: string): Promise<{ ok: boolean; reason?: SocialError }> {
  // A block looks like "not found", exactly as it does everywhere else, so the
  // response never tells someone they have been blocked.
  if (await isBlockedEitherWay(viewerId, otherId)) {
    return { ok: false, reason: notFound("Conversation not found.") };
  }
  if (!(await isMutualFollow(viewerId, otherId))) {
    return { ok: false, reason: new SocialError("You can only message members you follow and who follow you back.", 403, "not_mutual") };
  }
  return { ok: true };
}

// Starts (or returns) the conversation with another member. Allowed only when
// both follow each other and neither has blocked the other.
export async function startConversation(viewerId: string, username: string): Promise<{ id: string }> {
  const viewer = await loadViewer(viewerId);
  const target = await findVisibleMemberByUsername(viewerId, username);
  if (target.id === viewer.id) throw new AuthError("You can't message yourself.", 400);

  const check = await canExchange(viewer.id, target.id);
  if (!check.ok) throw check.reason!;

  const [userAId, userBId] = [viewer.id, target.id].sort();
  // The unique (user_a_id, user_b_id) constraint makes this safe under races.
  await db.insert(conversations).values({ userAId: userAId!, userBId: userBId! }).onConflictDoNothing({
    target: [conversations.userAId, conversations.userBId],
  });
  const [row] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.userAId, userAId!), eq(conversations.userBId, userBId!)));
  return { id: row!.id };
}

function unreadExpression(viewerId: string) {
  // Messages from the other person newer than the viewer's own read marker.
  return sql<number>`(
    select count(*)::int from ${directMessages} dm
    where dm.conversation_id = ${conversations.id}
      and dm.sender_id <> ${viewerId}
      and dm.created_at > coalesce(
        case when ${conversations.userAId} = ${viewerId} then ${conversations.userALastReadAt} else ${conversations.userBLastReadAt} end,
        '-infinity'::timestamptz
      )
  )`;
}

export async function listConversations(viewerId: string, rawCursor: string | undefined, limit: number): Promise<Page<ConversationView>> {
  await loadViewer(viewerId);
  const cursor = decodeCursor(rawCursor);
  const otherId = sql<string>`case when ${conversations.userAId} = ${viewerId} then ${conversations.userBId} else ${conversations.userAId} end`;

  const rows = await db
    .select({
      id: conversations.id,
      createdAt: conversations.lastMessageAt,
      ts: tsText(conversations.lastMessageAt),
      otherId,
      username: users.username,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
      unread: unreadExpression(viewerId),
    })
    .from(conversations)
    .innerJoin(users, sql`${users.id} = ${otherId}`)
    .where(
      and(
        or(eq(conversations.userAId, viewerId), eq(conversations.userBId, viewerId)),
        visibleMember,
        notBlockedWith(viewerId, users.id),
        olderThan(conversations.lastMessageAt, conversations.id, cursor),
      ),
    )
    .orderBy(desc(conversations.lastMessageAt), desc(conversations.id))
    .limit(limit + 1);

  const page = toPage(rows, limit);
  const ids = page.items.map((r) => r.id);

  // One query for the latest message of every conversation on the page.
  const lastRows = ids.length
    ? await db
        .selectDistinctOn([directMessages.conversationId], {
          conversationId: directMessages.conversationId,
          content: directMessages.content,
          senderId: directMessages.senderId,
          createdAt: directMessages.createdAt,
          postId: directMessages.postId,
        })
        .from(directMessages)
        .where(inArray(directMessages.conversationId, ids))
        .orderBy(directMessages.conversationId, desc(directMessages.createdAt), desc(directMessages.id))
    : [];
  const last = new Map(lastRows.map((r) => [r.conversationId, r]));

  // One query for mutual status across the page.
  const mutualRows = page.items.length
    ? await db.execute<{ other_id: string }>(sql`
        select f1.followee_id as other_id
        from follows f1
        join follows f2 on f2.follower_id = f1.followee_id and f2.followee_id = f1.follower_id
        where f1.follower_id = ${viewerId} and f1.followee_id in (${sql.join(page.items.map((r) => sql`${r.otherId}::uuid`), sql`, `)})
      `)
    : [];
  const mutual = new Set((mutualRows as unknown as { other_id: string }[]).map((r) => r.other_id));

  return {
    nextCursor: page.nextCursor,
    items: page.items.map((row) => {
      const lastMessage = last.get(row.id);
      return {
        id: row.id,
        other: toUserCard({ username: row.username, displayName: row.displayName, avatarKey: row.avatarKey }),
        lastMessage: lastMessage
          ? {
              content: lastMessage.content,
              createdAt: lastMessage.createdAt,
              fromMe: lastMessage.senderId === viewerId,
              isPostShare: lastMessage.postId !== null,
            }
          : null,
        lastMessageAt: row.createdAt,
        unreadCount: row.unread,
        canSend: mutual.has(row.otherId),
      };
    }),
  };
}

async function toMessageViews(viewerId: string, rows: Array<{ id: string; conversationId: string; senderId: string; senderUsername: string | null; content: string; createdAt: Date; postId: string | null }>): Promise<MessageView[]> {
  const postIds = [...new Set(rows.map((r) => r.postId).filter((id): id is string => id !== null))];
  const visible = postIds.length
    ? await db
        .select({ id: posts.id, caption: posts.caption, authorUsername: users.username })
        .from(posts)
        .innerJoin(users, eq(users.id, posts.authorId))
        .where(and(inArray(posts.id, postIds), visibleMember, notBlockedWith(viewerId, posts.authorId)))
    : [];
  const byId = new Map(visible.map((p) => [p.id, p]));

  return rows.map((row) => {
    const shared = row.postId ? byId.get(row.postId) : undefined;
    return {
      id: row.id,
      conversationId: row.conversationId,
      senderUsername: row.senderUsername ?? "",
      fromMe: row.senderId === viewerId,
      content: row.content,
      createdAt: row.createdAt,
      sharedPost: shared ? { id: shared.id, imageUrl: postImageUrl(shared.id), caption: shared.caption.slice(0, 140), authorUsername: shared.authorUsername ?? "" } : null,
      sharedPostUnavailable: row.postId !== null && !shared,
    };
  });
}

// Newest first (the client reverses for display) so "load earlier" is just
// "next page".
export async function listMessages(viewerId: string, conversationId: string, rawCursor: string | undefined, limit: number): Promise<Page<MessageView> & { canSend: boolean; other: UserCard }> {
  await loadViewer(viewerId);
  const { conversation, other } = await loadMembership(viewerId, conversationId);
  // A blocked pair cannot read the history either.
  if (await isBlockedEitherWay(viewerId, other.id)) throw notFound("Conversation not found.");

  const cursor = decodeCursor(rawCursor);
  const rows = await db
    .select({
      id: directMessages.id,
      conversationId: directMessages.conversationId,
      senderId: directMessages.senderId,
      senderUsername: users.username,
      content: directMessages.content,
      createdAt: directMessages.createdAt,
      ts: tsText(directMessages.createdAt),
      postId: directMessages.postId,
    })
    .from(directMessages)
    .innerJoin(users, eq(users.id, directMessages.senderId))
    .where(and(eq(directMessages.conversationId, conversation.id), olderThan(directMessages.createdAt, directMessages.id, cursor)))
    .orderBy(desc(directMessages.createdAt), desc(directMessages.id))
    .limit(limit + 1);

  const page = toPage(rows, limit);
  return {
    nextCursor: page.nextCursor,
    items: await toMessageViews(viewerId, page.items),
    canSend: (await canExchange(viewerId, other.id)).ok,
    other: toUserCard(other),
  };
}

export async function sendMessage(viewerId: string, conversationId: string, input: { content?: string; postId?: string }): Promise<MessageView> {
  const viewer = await loadViewer(viewerId);
  const { conversation, other } = await loadMembership(viewerId, conversationId);

  // The other member must still be an active, verified member.
  const [otherMember] = await db.select({ id: users.id }).from(users).where(and(eq(users.id, other.id), visibleMember));
  if (!otherMember) throw notFound("Conversation not found.");

  // Re-checked now, from live data — see the note at the top of this file.
  const check = await canExchange(viewer.id, other.id);
  if (!check.ok) throw check.reason!;

  let content = "";
  if (input.content !== undefined && input.content.trim() !== "") {
    const parsed = messageSchema.safeParse(input.content);
    if (!parsed.success) throw new AuthError(parsed.error.issues[0]?.message ?? "Invalid message.", 400);
    content = parsed.data;
  }

  let postId: string | null = null;
  if (input.postId !== undefined) {
    if (!uuidSchema.safeParse(input.postId).success) throw new AuthError("Invalid post.", 400);
    // The sender must be able to see the post, and so must the recipient: a
    // share never reveals a post to someone who couldn't open it themselves.
    const [visibleToBoth] = await db
      .select({ id: posts.id })
      .from(posts)
      .innerJoin(users, eq(users.id, posts.authorId))
      .where(and(eq(posts.id, input.postId), visibleMember, notBlockedWith(viewer.id, posts.authorId), notBlockedWith(other.id, posts.authorId)));
    if (!visibleToBoth) throw notFound("That post isn't available.");
    postId = visibleToBoth.id;
  }

  if (content === "" && postId === null) throw new AuthError("Message can't be empty.", 400);

  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(directMessages)
      .values({ conversationId: conversation.id, senderId: viewer.id, content, postId })
      .returning();
    const readColumn = sideOf(conversation, viewer.id) === "a" ? { userALastReadAt: row!.createdAt } : { userBLastReadAt: row!.createdAt };
    await tx.update(conversations).set({ lastMessageAt: row!.createdAt, ...readColumn }).where(eq(conversations.id, conversation.id));
    return row!;
  });

  await upsertMessageNotification({ recipientId: other.id, actorId: viewer.id, conversationId: conversation.id });

  const [view] = await toMessageViews(viewer.id, [{ ...created, senderUsername: viewer.username }]);
  // Real-time delivery to both participants' live sockets (the sender's other
  // devices included). The recipient's copy is computed from THEIR point of view.
  pushToUser(viewer.id, "dm:message", view);
  const [theirView] = await toMessageViews(other.id, [{ ...created, senderUsername: viewer.username }]);
  pushToUser(other.id, "dm:message", theirView);
  return view!;
}

export async function markConversationRead(viewerId: string, conversationId: string): Promise<void> {
  await loadViewer(viewerId);
  const { conversation } = await loadMembership(viewerId, conversationId);
  const column = sideOf(conversation, viewerId) === "a" ? { userALastReadAt: sql`now()` } : { userBLastReadAt: sql`now()` };
  await db.update(conversations).set(column).where(eq(conversations.id, conversation.id));
  // Opening a conversation also clears its message notification.
  await db.execute(sql`update notifications set read_at = now() where user_id = ${viewerId} and dedupe_key = ${`message:${conversation.id}`} and read_at is null`);
}

export async function unreadMessageCount(viewerId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${unreadExpression(viewerId)}), 0)::int` })
    .from(conversations)
    .innerJoin(users, sql`${users.id} = case when ${conversations.userAId} = ${viewerId} then ${conversations.userBId} else ${conversations.userAId} end`)
    .where(and(or(eq(conversations.userAId, viewerId), eq(conversations.userBId, viewerId)), visibleMember, notBlockedWith(viewerId, users.id)));
  return row?.n ?? 0;
}
