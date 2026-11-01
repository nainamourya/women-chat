import { getRequestContext, matchmakerFor } from "../realtime/env";
import type { JoinQueueResult } from "../realtime/matchmaker";

// Build-time replacement for apps/server/src/redis/matchmakingQueue.ts (see
// scripts/build.mjs): same four functions, same results, backed by the
// Matchmaker Durable Object instead of Redis.
export type { JoinQueueResult };

const queue = () => matchmakerFor(getRequestContext().env);

export async function joinQueue(userId: string, blockedIds: string[] = []): Promise<JoinQueueResult> {
  const q = queue();
  const result = await q.join(userId, blockedIds);
  if (result.state === "waiting") await q.afterJoin();
  return result;
}

export async function leaveQueue(userId: string): Promise<void> {
  await queue().leave(userId);
}

export async function isWaiting(userId: string): Promise<boolean> {
  return queue().waiting(userId);
}

export async function refreshWaiting(userId: string): Promise<void> {
  await queue().refresh(userId);
}
