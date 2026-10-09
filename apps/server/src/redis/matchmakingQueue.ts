import { redis } from "./client.js";

const QUEUE_KEY = "mm:queue";
const STATUS_PREFIX = "mm:status:";
// Must be refreshed (see `refreshWaiting`) by the client's status poll while
// waiting. If a user's tab closes/crashes without calling leave, this key
// simply expires and the next match attempt silently discards their stale
// queue entry instead of matching them.
const WAITING_TTL_SECONDS = 20;

// Atomic so concurrent join requests (including two users joining at nearly
// the same instant) can never claim the same waiting candidate twice, and a
// user double-clicking "Find Someone" can never enqueue themselves twice.
// Candidates in the caller's block list (either direction) are popped and
// skipped rather than matched, then pushed back onto the queue so they are
// not lost for other waiting users.
// Returns:
//   ["already_waiting"]
//   ["matched", candidateUserId]
//   ["waiting"]
const JOIN_SCRIPT = `
local queueKey = KEYS[1]
local userId = ARGV[1]
local prefix = ARGV[2]
local ttl = tonumber(ARGV[3])
local selfKey = prefix .. userId
local blockedCount = tonumber(ARGV[4])

local blocked = {}
for i = 1, blockedCount do
  blocked[ARGV[4 + i]] = true
end

if redis.call('GET', selfKey) == 'waiting' then
  return {'already_waiting'}
end

local skipped = {}
local matchedCandidate = nil

while true do
  local candidate = redis.call('RPOP', queueKey)
  if not candidate then
    break
  end
  if candidate == userId then
    -- defensive: the selfKey check above already prevents this
  elseif blocked[candidate] then
    table.insert(skipped, candidate)
  elseif redis.call('GET', prefix .. candidate) == 'waiting' then
    redis.call('DEL', prefix .. candidate)
    matchedCandidate = candidate
    break
  end
end

for i = 1, #skipped do
  redis.call('LPUSH', queueKey, skipped[i])
end

if matchedCandidate then
  return {'matched', matchedCandidate}
end

redis.call('LPUSH', queueKey, userId)
redis.call('SET', selfKey, 'waiting', 'EX', ttl)
return {'waiting'}
`;

export type JoinQueueResult =
  | { state: "already_waiting" }
  | { state: "matched"; candidateId: string }
  | { state: "waiting" };

export async function joinQueue(userId: string, blockedIds: string[] = []): Promise<JoinQueueResult> {
  const result = (await redis.eval(
    JOIN_SCRIPT,
    1,
    QUEUE_KEY,
    userId,
    STATUS_PREFIX,
    WAITING_TTL_SECONDS,
    blockedIds.length,
    ...blockedIds,
  )) as [string, string?];

  if (result[0] === "matched") {
    return { state: "matched", candidateId: result[1]! };
  }
  if (result[0] === "already_waiting") {
    return { state: "already_waiting" };
  }
  return { state: "waiting" };
}

export async function leaveQueue(userId: string): Promise<void> {
  await Promise.all([
    redis.lrem(QUEUE_KEY, 0, userId),
    redis.del(STATUS_PREFIX + userId),
  ]);
}

export async function isWaiting(userId: string): Promise<boolean> {
  return (await redis.get(STATUS_PREFIX + userId)) === "waiting";
}

// Called by the status endpoint while a user polls — slides the TTL forward
// so an actively-polling (i.e. still-open) tab never falls off the queue.
export async function refreshWaiting(userId: string): Promise<void> {
  await redis.expire(STATUS_PREFIX + userId, WAITING_TTL_SECONDS);
}
