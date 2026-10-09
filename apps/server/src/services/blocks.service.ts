import { and, eq, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { blocks } from "../db/schema.js";
import { AuthError } from "./auth.service.js";

export async function blockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  if (blockerUserId === blockedUserId) {
    throw new AuthError("You cannot block yourself.", 400);
  }

  await db
    .insert(blocks)
    .values({ blockerUserId, blockedUserId })
    .onConflictDoNothing({ target: [blocks.blockerUserId, blocks.blockedUserId] });
}

export async function unblockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  await db
    .delete(blocks)
    .where(and(eq(blocks.blockerUserId, blockerUserId), eq(blocks.blockedUserId, blockedUserId)));
}

// Mutual exclusion for matchmaking: a candidate is excluded whether this
// user blocked them or they blocked this user.
export async function getBlockedCounterpartIds(userId: string): Promise<string[]> {
  const rows = await db
    .select({ blockerUserId: blocks.blockerUserId, blockedUserId: blocks.blockedUserId })
    .from(blocks)
    .where(or(eq(blocks.blockerUserId, userId), eq(blocks.blockedUserId, userId)));

  return rows.map((row) => (row.blockerUserId === userId ? row.blockedUserId : row.blockerUserId));
}
