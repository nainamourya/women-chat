import { desc, eq, ilike, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { AuthError, toPublicUser } from "./auth.service.js";
import { disconnectUser } from "../socket/index.js";
import { getMatchDurationsByUser } from "./adminStats.service.js";

export async function listUsersForAdmin(filter?: { search?: string }) {
  const search = filter?.search?.trim();
  const [rows, durations] = await Promise.all([
    db.query.users.findMany({
      where: search ? or(ilike(users.email, `%${search}%`), ilike(users.displayName, `%${search}%`)) : undefined,
      orderBy: desc(users.createdAt),
      limit: 100,
    }),
    getMatchDurationsByUser(),
  ]);

  return rows.map((row) => ({
    ...toPublicUser(row),
    timeSpentMinutes: Math.round((durations.get(row.id) ?? 0) / 60),
  }));
}

async function getTargetUser(targetUserId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, targetUserId) });
  if (!user) {
    throw new AuthError("User not found.", 404);
  }
  return user;
}

// Every mutating action below is self-guarded against an admin acting on
// their own account — losing admin/active status this way would otherwise
// lock the acting admin out with no recovery path other than direct DB access.
function assertNotSelf(actingAdminId: string, targetUserId: string) {
  if (actingAdminId === targetUserId) {
    throw new AuthError("You cannot perform this action on your own account.", 400);
  }
}

export async function adminSuspendUser(
  actingAdminId: string,
  targetUserId: string,
  suspendUntil: Date | null,
) {
  assertNotSelf(actingAdminId, targetUserId);
  await getTargetUser(targetUserId);

  const [updated] = await db
    .update(users)
    .set({ accountStatus: "suspended", suspendedUntil: suspendUntil, updatedAt: new Date() })
    .where(eq(users.id, targetUserId))
    .returning();
  disconnectUser(targetUserId);
  return toPublicUser(updated);
}

export async function adminUnsuspendUser(actingAdminId: string, targetUserId: string) {
  assertNotSelf(actingAdminId, targetUserId);
  await getTargetUser(targetUserId);

  const [updated] = await db
    .update(users)
    .set({ accountStatus: "active", suspendedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, targetUserId))
    .returning();
  return toPublicUser(updated);
}

export async function adminBanUser(actingAdminId: string, targetUserId: string) {
  assertNotSelf(actingAdminId, targetUserId);
  await getTargetUser(targetUserId);

  const [updated] = await db
    .update(users)
    .set({ accountStatus: "banned", suspendedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, targetUserId))
    .returning();
  disconnectUser(targetUserId);
  return toPublicUser(updated);
}

export async function adminUnbanUser(actingAdminId: string, targetUserId: string) {
  assertNotSelf(actingAdminId, targetUserId);
  await getTargetUser(targetUserId);

  const [updated] = await db
    .update(users)
    .set({ accountStatus: "active", suspendedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, targetUserId))
    .returning();
  return toPublicUser(updated);
}

export async function adminDeleteUser(actingAdminId: string, targetUserId: string) {
  assertNotSelf(actingAdminId, targetUserId);
  await getTargetUser(targetUserId);

  disconnectUser(targetUserId);
  // Cascades to userProfiles, userInterests, matches, messages, blocks and
  // the reporter/reportedUser side of reports — see schema.ts onDelete rules.
  await db.delete(users).where(eq(users.id, targetUserId));
}
