import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { follows, users } from "../../db/schema.js";
import { AuthError } from "../auth.service.js";
import { findVisibleMemberByUsername, loadViewer, notBlockedWith, toUserCard, visibleMember, SocialError } from "./access.js";
import { createNotification } from "./notifications.service.js";
import { olderThan, tsText } from "./pagination.js";
import { decodeCursor, toPage, type Page } from "./validation.js";
import type { UserListItem } from "./profiles.service.js";

export async function followMember(viewerId: string, username: string): Promise<{ following: true; followerCount: number }> {
  const viewer = await loadViewer(viewerId);
  const target = await findVisibleMemberByUsername(viewerId, username);
  if (target.id === viewer.id) throw new AuthError("You can't follow yourself.", 400);

  // The primary key makes this idempotent: a double-tap or a retried request
  // inserts nothing the second time (and so sends no second notification).
  const inserted = await db
    .insert(follows)
    .values({ followerId: viewer.id, followeeId: target.id })
    .onConflictDoNothing({ target: [follows.followerId, follows.followeeId] })
    .returning({ followerId: follows.followerId });

  if (inserted.length > 0) {
    await createNotification({
      recipientId: target.id,
      actorId: viewer.id,
      type: "follow",
      dedupeKey: `follow:${viewer.id}`,
    });
  }
  return { following: true, followerCount: await followerCount(target.id) };
}

export async function unfollowMember(viewerId: string, username: string): Promise<{ following: false; followerCount: number }> {
  await loadViewer(viewerId);
  // Unfollowing works even if the other member has since become unavailable to
  // the viewer, so a stale edge can always be removed.
  const [target] = await db.select({ id: users.id }).from(users).where(eq(users.username, username.toLowerCase())).limit(1);
  if (!target) throw new SocialError("That member wasn't found.", 404, "not_found");
  await db.delete(follows).where(and(eq(follows.followerId, viewerId), eq(follows.followeeId, target.id)));
  return { following: false, followerCount: await followerCount(target.id) };
}

async function followerCount(userId: string): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(follows).where(eq(follows.followeeId, userId));
  return row?.n ?? 0;
}

// The one place the "may these two chat?" follow rule lives. True only when
// BOTH directions exist right now.
export async function isMutualFollow(a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(follows)
    .where(or(and(eq(follows.followerId, a), eq(follows.followeeId, b)), and(eq(follows.followerId, b), eq(follows.followeeId, a))));
  return (row?.n ?? 0) === 2;
}

async function listEdge(
  viewerId: string,
  username: string,
  direction: "followers" | "following",
  rawCursor: string | undefined,
  limit: number,
): Promise<Page<UserListItem>> {
  await loadViewer(viewerId);
  const subject = await findVisibleMemberByUsername(viewerId, username);
  const cursor = decodeCursor(rawCursor);

  // followers: edges pointing AT the subject, listing the follower; following: the reverse.
  const [ownerCol, otherCol] = direction === "followers" ? [follows.followeeId, follows.followerId] : [follows.followerId, follows.followeeId];

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
      ts: tsText(follows.createdAt),
      viewerFollows: sql<boolean>`exists (select 1 from ${follows} vf where vf.follower_id = ${viewerId} and vf.followee_id = ${users.id})`,
    })
    .from(follows)
    .innerJoin(users, eq(users.id, otherCol))
    .where(
      and(
        eq(ownerCol, subject.id),
        visibleMember,
        notBlockedWith(viewerId, users.id),
        olderThan(follows.createdAt, users.id, cursor),
      ),
    )
    .orderBy(desc(follows.createdAt), desc(users.id))
    .limit(limit + 1);

  const page = toPage(rows, limit);
  return {
    nextCursor: page.nextCursor,
    items: page.items.map((row) => ({
      ...toUserCard(row),
      isFollowing: row.viewerFollows,
      isSelf: row.id === viewerId,
    })),
  };
}

export const listFollowers = (viewerId: string, username: string, cursor: string | undefined, limit: number) =>
  listEdge(viewerId, username, "followers", cursor, limit);

export const listFollowing = (viewerId: string, username: string, cursor: string | undefined, limit: number) =>
  listEdge(viewerId, username, "following", cursor, limit);
