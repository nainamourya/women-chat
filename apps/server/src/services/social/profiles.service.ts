import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "../../db/client.js";
import { blocks, follows, posts, userProfiles, users } from "../../db/schema.js";
import { AuthError } from "../auth.service.js";
import { findVisibleMemberByUsername, loadViewer, notBlockedWith, toUserCard, visibleMember, type UserCard } from "./access.js";
import { sanitizeImage } from "./imageSanitizer.js";
import { deleteMedia, newMediaKey, writeMedia } from "./mediaStorage.js";
import { bioSchema, displayNameSchema, usernameSchema } from "./validation.js";

export type ProfileView = UserCard & {
  bio: string;
  postCount: number;
  followerCount: number;
  followingCount: number;
  isSelf: boolean;
  isFollowing: boolean;
  followsYou: boolean;
  isMutual: boolean;
};

export type OwnProfile = ProfileView & { hasUsername: boolean };

async function counts(userId: string) {
  const [row] = await db
    .select({
      postCount: sql<number>`(select count(*) from ${posts} where ${posts.authorId} = ${userId})::int`,
      followerCount: sql<number>`(select count(*) from ${follows} where ${follows.followeeId} = ${userId})::int`,
      followingCount: sql<number>`(select count(*) from ${follows} where ${follows.followerId} = ${userId})::int`,
    })
    .from(sql`(select 1) as one`);
  return row ?? { postCount: 0, followerCount: 0, followingCount: 0 };
}

async function bioOf(userId: string): Promise<string> {
  const row = await db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, userId) });
  return row?.bio ?? "";
}

async function relationship(viewerId: string, targetId: string) {
  if (viewerId === targetId) return { isFollowing: false, followsYou: false };
  const rows = await db
    .select({ follower: follows.followerId })
    .from(follows)
    .where(
      or(
        and(eq(follows.followerId, viewerId), eq(follows.followeeId, targetId)),
        and(eq(follows.followerId, targetId), eq(follows.followeeId, viewerId)),
      ),
    );
  return {
    isFollowing: rows.some((r) => r.follower === viewerId),
    followsYou: rows.some((r) => r.follower === targetId),
  };
}

async function buildProfile(viewerId: string, user: typeof users.$inferSelect): Promise<ProfileView> {
  const [c, bio, rel] = await Promise.all([counts(user.id), bioOf(user.id), relationship(viewerId, user.id)]);
  return {
    ...toUserCard(user),
    bio,
    ...c,
    isSelf: viewerId === user.id,
    isFollowing: rel.isFollowing,
    followsYou: rel.followsYou,
    isMutual: rel.isFollowing && rel.followsYou,
  };
}

// The viewer's own profile. Works before a username is chosen (that is how
// they get to choose one), so the username requirement is waived here.
export async function getOwnProfile(viewerId: string): Promise<OwnProfile> {
  const viewer = await loadViewer(viewerId, { needsUsername: false });
  const [c, bio] = await Promise.all([counts(viewer.id), bioOf(viewer.id)]);
  return {
    ...toUserCard(viewer),
    bio,
    ...c,
    isSelf: true,
    isFollowing: false,
    followsYou: false,
    isMutual: false,
    hasUsername: Boolean(viewer.username),
  };
}

export async function getProfileByUsername(viewerId: string, username: string): Promise<ProfileView> {
  await loadViewer(viewerId);
  const target = await findVisibleMemberByUsername(viewerId, username);
  return buildProfile(viewerId, target);
}

// Only ever updates the viewer's own row: there is no user id in the input.
export async function updateOwnProfile(
  viewerId: string,
  input: { username?: string; displayName?: string; bio?: string },
): Promise<OwnProfile> {
  const viewer = await loadViewer(viewerId, { needsUsername: false });
  const userPatch: Partial<typeof users.$inferInsert> = {};

  if (input.username !== undefined) {
    const parsed = usernameSchema.safeParse(input.username);
    if (!parsed.success) throw new AuthError(parsed.error.issues[0]?.message ?? "Invalid username.", 400);
    userPatch.username = parsed.data;
  }
  if (input.displayName !== undefined) {
    const parsed = displayNameSchema.safeParse(input.displayName);
    if (!parsed.success) throw new AuthError(parsed.error.issues[0]?.message ?? "Invalid display name.", 400);
    userPatch.displayName = parsed.data;
  }
  let bio: string | undefined;
  if (input.bio !== undefined) {
    const parsed = bioSchema.safeParse(input.bio);
    if (!parsed.success) throw new AuthError(parsed.error.issues[0]?.message ?? "Invalid bio.", 400);
    bio = parsed.data;
  }

  try {
    await db.transaction(async (tx) => {
      if (Object.keys(userPatch).length > 0) {
        await tx.update(users).set({ ...userPatch, updatedAt: new Date() }).where(eq(users.id, viewer.id));
      }
      if (bio !== undefined) {
        await tx
          .insert(userProfiles)
          .values({ userId: viewer.id, bio })
          .onConflictDoUpdate({ target: userProfiles.userId, set: { bio, updatedAt: new Date() } });
      }
    });
  } catch (err) {
    // 23505 = unique_violation on users_username_unique: the race-proof check
    // behind the friendly message (two people claiming a handle at once).
    // drizzle wraps driver errors, so the Postgres code can be on `cause`.
    const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") throw new AuthError("That username is already taken.", 409);
    throw err;
  }
  return getOwnProfile(viewerId);
}

export async function setOwnAvatar(viewerId: string, imageBase64: string, mimeType: string): Promise<OwnProfile> {
  const viewer = await loadViewer(viewerId);
  const image = sanitizeImage(imageBase64, mimeType);
  const key = newMediaKey("avatars", image.ext);
  await writeMedia(key, image.buffer, image.mimeType);
  try {
    await db.update(users).set({ avatarKey: key, updatedAt: new Date() }).where(eq(users.id, viewer.id));
  } catch (err) {
    await deleteMedia(key);
    throw err;
  }
  if (viewer.avatarKey) await deleteMedia(viewer.avatarKey);
  return getOwnProfile(viewerId);
}

export async function removeOwnAvatar(viewerId: string): Promise<OwnProfile> {
  const viewer = await loadViewer(viewerId);
  if (viewer.avatarKey) {
    await db.update(users).set({ avatarKey: null, updatedAt: new Date() }).where(eq(users.id, viewer.id));
    await deleteMedia(viewer.avatarKey);
  }
  return getOwnProfile(viewerId);
}

export type UserListItem = UserCard & { isFollowing: boolean; isSelf: boolean };

// The members the viewer has blocked, so they can be unblocked. Deliberately
// only the viewer's OWN blocks: who has blocked the viewer is never revealed.
// A blocked member is not otherwise reachable (their profile is a 404), so this
// list is the only place an unblock can happen.
export async function listBlockedMembers(viewerId: string): Promise<UserCard[]> {
  await loadViewer(viewerId, { needsUsername: false });
  const rows = await db
    .select({ username: users.username, displayName: users.displayName, avatarKey: users.avatarKey })
    .from(blocks)
    .innerJoin(users, eq(users.id, blocks.blockedUserId))
    .where(eq(blocks.blockerUserId, viewerId))
    .orderBy(asc(users.username));
  return rows.filter((row) => row.username !== null).map((row) => toUserCard(row));
}

// Discover members by username or display name. Returns the first page only,
// ordered alphabetically; requires at least two characters so it cannot be
// used to enumerate the whole membership.
export async function searchMembers(viewerId: string, rawQuery: string, limit: number): Promise<UserListItem[]> {
  await loadViewer(viewerId);
  const q = rawQuery.trim().replace(/[%_\\]/g, (c) => `\\${c}`);
  if (q.length < 2) throw new AuthError("Type at least 2 characters to search.", 400);

  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      displayName: users.displayName,
      avatarKey: users.avatarKey,
      following: sql<boolean>`exists (select 1 from ${follows} f where f.follower_id = ${viewerId} and f.followee_id = ${users.id})`,
    })
    .from(users)
    .where(
      and(
        visibleMember,
        notBlockedWith(viewerId, users.id),
        or(ilike(users.username, `${q}%`), ilike(users.displayName, `%${q}%`)),
      ),
    )
    .orderBy(asc(users.username))
    .limit(limit);

  return rows.map((row) => ({
    ...toUserCard(row),
    isFollowing: row.following,
    isSelf: row.id === viewerId,
  }));
}

