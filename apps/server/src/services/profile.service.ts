import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { userProfiles } from "../db/schema.js";
import { getUserInterests } from "./interests.service.js";

/**
 * Profile is private by design: these functions always operate on a single
 * `userId` supplied by the caller (the Next.js server, which derives it from
 * the signed-in session — never from client input). There is no lookup path
 * for one user's profile by another user.
 */
export async function getProfile(userId: string) {
  const [profile, selectedInterests] = await Promise.all([
    db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, userId) }),
    getUserInterests(userId),
  ]);

  return {
    userId,
    bio: profile?.bio ?? null,
    interests: selectedInterests,
  };
}

export async function upsertProfile(userId: string, input: { bio?: string | null }) {
  const [profile] = await db
    .insert(userProfiles)
    .values({ userId, bio: input.bio ?? null })
    .onConflictDoUpdate({
      target: userProfiles.userId,
      set: { bio: input.bio ?? null, updatedAt: new Date() },
    })
    .returning();

  return {
    userId: profile.userId,
    bio: profile.bio,
  };
}
