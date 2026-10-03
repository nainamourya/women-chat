import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { userProfiles, users } from "../db/schema.js";
import { getUserInterests } from "./interests.service.js";

function isProfileComplete(bio: string | null, interestCount: number) {
  return Boolean(bio?.trim()) && interestCount > 0;
}

/**
 * Profile is private by design: these functions always operate on a single
 * `userId` supplied by the caller (the Next.js server, which derives it from
 * the signed-in session — never from client input). There is no lookup path
 * for one user's profile by another user.
 */
export async function getProfile(userId: string) {
  const [user, profile, selectedInterests] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, userId) }),
    db.query.userProfiles.findFirst({ where: eq(userProfiles.userId, userId) }),
    getUserInterests(userId),
  ]);

  const bio = profile?.bio ?? null;

  return {
    userId,
    displayName: user?.displayName ?? null,
    bio,
    interests: selectedInterests,
    profileComplete: isProfileComplete(bio, selectedInterests.length),
  };
}

export async function upsertProfile(
  userId: string,
  input: { bio?: string | null; displayName?: string },
) {
  const [profile, updatedUser] = await db.transaction(async (tx) => {
    const [profileRow] = await tx
      .insert(userProfiles)
      .values({ userId, bio: input.bio ?? null })
      .onConflictDoUpdate({
        target: userProfiles.userId,
        set: { bio: input.bio ?? null, updatedAt: new Date() },
      })
      .returning();

    let userRow: typeof users.$inferSelect | undefined;
    if (input.displayName !== undefined) {
      [userRow] = await tx
        .update(users)
        .set({ displayName: input.displayName, updatedAt: new Date() })
        .where(eq(users.id, userId))
        .returning();
    } else {
      userRow = await tx.query.users.findFirst({ where: eq(users.id, userId) });
    }

    return [profileRow, userRow] as const;
  });

  const interestCount = await getUserInterests(userId).then((rows) => rows.length);

  return {
    userId: profile.userId,
    displayName: updatedUser?.displayName ?? null,
    bio: profile.bio,
    profileComplete: isProfileComplete(profile.bio, interestCount),
  };
}
