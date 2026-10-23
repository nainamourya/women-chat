import { and, eq, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { blocks, follows } from "../db/schema.js";
import { AuthError } from "./auth.service.js";

export async function blockUser(blockerUserId: string, blockedUserId: string): Promise<void> {
  if (blockerUserId === blockedUserId) {
    throw new AuthError("You cannot block yourself.", 400);
  }

  // One transaction: record the block AND drop any follow between the two in
  // either direction, so a block also ends the social connection (and with it
  // the mutual-follow condition for private messages).
  await db.transaction(async (tx) => {
    await tx
      .insert(blocks)
      .values({ blockerUserId, blockedUserId })
      .onConflictDoNothing({ target: [blocks.blockerUserId, blocks.blockedUserId] });
    await tx
      .delete(follows)
      .where(
        or(
          and(eq(follows.followerId, blockerUserId), eq(follows.followeeId, blockedUserId)),
          and(eq(follows.followerId, blockedUserId), eq(follows.followeeId, blockerUserId)),
        ),
      );
  });
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
