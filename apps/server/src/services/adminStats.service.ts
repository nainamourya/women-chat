import { count, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, matches, messages, reports } from "../db/schema.js";

// "Time spent" has no dedicated session-tracking table in this MVP — the
// closest real signal is time inside a matched conversation (chat + call),
// so it's approximated as the wall-clock span of each match
// (endedAt, or now for a still-active match, minus createdAt).
export async function getMatchDurationsByUser(): Promise<Map<string, number>> {
  const allMatches = await db.query.matches.findMany();
  const now = Date.now();
  const seconds = new Map<string, number>();

  for (const m of allMatches) {
    const endMs = m.endedAt ? m.endedAt.getTime() : now;
    const durationSeconds = Math.max(0, (endMs - m.createdAt.getTime()) / 1000);
    seconds.set(m.userAId, (seconds.get(m.userAId) ?? 0) + durationSeconds);
    seconds.set(m.userBId, (seconds.get(m.userBId) ?? 0) + durationSeconds);
  }

  return seconds;
}

export async function getAdminOverviewStats() {
  const [[{ total: totalUsers }], statusCounts, [{ total: totalMatches }], [{ total: totalMessages }], [
    { total: pendingReports },
  ]] = await Promise.all([
    db.select({ total: count() }).from(users),
    db.select({ accountStatus: users.accountStatus, total: count() }).from(users).groupBy(users.accountStatus),
    db.select({ total: count() }).from(matches),
    db.select({ total: count() }).from(messages),
    db.select({ total: count() }).from(reports).where(eq(reports.status, "pending")),
  ]);

  const byStatus = Object.fromEntries(statusCounts.map((s) => [s.accountStatus, s.total]));
  const durations = await getMatchDurationsByUser();
  const totalConversationSeconds = [...durations.values()].reduce((sum, s) => sum + s, 0);

  return {
    totalUsers,
    activeUsers: byStatus.active ?? 0,
    suspendedUsers: byStatus.suspended ?? 0,
    bannedUsers: byStatus.banned ?? 0,
    totalMatches,
    totalMessages,
    pendingReports,
    totalConversationMinutes: Math.round(totalConversationSeconds / 60),
    avgConversationMinutesPerUser: totalUsers > 0 ? Math.round(totalConversationSeconds / 60 / totalUsers) : 0,
  };
}
