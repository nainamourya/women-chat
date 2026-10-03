import { and, desc, eq, lt } from "drizzle-orm";
import { db } from "../db/client.js";
import { matches, messages, type ChatMessage, type Match } from "../db/schema.js";
import { AuthError } from "./auth.service.js";

export const MAX_MESSAGE_LENGTH = 2000;
const DEFAULT_HISTORY_LIMIT = 50;

export async function getMatchForParticipant(userId: string, matchId: string): Promise<Match> {
  const match = await db.query.matches.findFirst({ where: eq(matches.id, matchId) });
  if (!match) {
    throw new AuthError("Match not found.", 404);
  }
  if (match.userAId !== userId && match.userBId !== userId) {
    throw new AuthError("You are not part of this match.", 403);
  }
  return match;
}

export async function assertActiveParticipant(userId: string, matchId: string): Promise<Match> {
  const match = await getMatchForParticipant(userId, matchId);
  if (match.status !== "active") {
    throw new AuthError("This chat has ended.", 410);
  }
  return match;
}

export function otherParticipant(match: Pick<Match, "userAId" | "userBId">, userId: string): string {
  return match.userAId === userId ? match.userBId : match.userAId;
}

function chronological(rows: ChatMessage[]): ChatMessage[] {
  return rows.reverse();
}

// Most recent page, returned in chronological order.
export async function getRecentMessages(matchId: string, limit = DEFAULT_HISTORY_LIMIT): Promise<ChatMessage[]> {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.matchId, matchId))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  return chronological(rows);
}

// Older page before a given message, returned in chronological order. Used
// for "load earlier messages" pagination.
export async function getMessagesBefore(
  matchId: string,
  beforeId: string,
  limit = DEFAULT_HISTORY_LIMIT,
): Promise<ChatMessage[]> {
  const cursor = await db.query.messages.findFirst({ where: eq(messages.id, beforeId) });
  if (!cursor || cursor.matchId !== matchId) {
    return [];
  }

  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.matchId, matchId), lt(messages.createdAt, cursor.createdAt)))
    .orderBy(desc(messages.createdAt), desc(messages.id))
    .limit(limit);
  return chronological(rows);
}

export async function sendMessage(userId: string, matchId: string, rawContent: string): Promise<ChatMessage> {
  await assertActiveParticipant(userId, matchId);

  const content = rawContent.trim();
  if (!content) {
    throw new AuthError("Message cannot be empty.", 400);
  }
  if (content.length > MAX_MESSAGE_LENGTH) {
    throw new AuthError(`Message cannot exceed ${MAX_MESSAGE_LENGTH} characters.`, 400);
  }

  const [saved] = await db.insert(messages).values({ matchId, senderId: userId, content }).returning();
  return saved;
}

export async function endChat(userId: string, matchId: string): Promise<{ match: Match; otherUserId: string }> {
  const match = await assertActiveParticipant(userId, matchId);
  const [updated] = await db
    .update(matches)
    .set({ status: "ended", endedAt: new Date() })
    .where(eq(matches.id, matchId))
    .returning();
  return { match: updated, otherUserId: otherParticipant(match, userId) };
}
