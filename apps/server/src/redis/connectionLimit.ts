import { redis } from "./client.js";

// Each admitted connection is a member of a per-user Redis sorted set, with
// its score set to an expiry timestamp (ms since epoch) rather than a plain
// membership flag. This gives the set a per-member "lease" without needing
// per-member TTLs (Redis only supports TTL per-key) — a live connection
// renews its own lease periodically (see startHeartbeat); a connection that
// never renews (the process crashed, or disconnect handling never got a
// chance to run) simply ages out and is pruned the next time *this same
// user* attempts to admit a new connection. This is deliberately
// self-healing rather than relying on a separate background sweep: no
// crashed instance can permanently consume a slot, because the very next
// legitimate (re)connection attempt from that user prunes it first.
const LEASE_TTL_MS = 60_000;
// Safety margin added on top of the lease TTL for the *key's* own expiry,
// so the key reliably outlives whatever member scores it holds (a key
// expiring slightly before its longest-lived member's score would reopen
// the exact bug this file fixes). Injectable, like leaseTtlMs, purely so
// tests can observe "the key survives past its real TTL" without waiting
// out this margin in real time.
const KEY_EXPIRY_BUFFER_MS = 60_000;
export const CONNECTION_HEARTBEAT_INTERVAL_MS = LEASE_TTL_MS / 2;
export const DEFAULT_CONCURRENT_CONNECTION_LIMIT = 3;

function connectionsKey(userId: string): string {
  return `conn:user:${userId}`;
}

// Atomic: prune-expired + count + conditionally-admit all happen in one
// Redis script, so two connections admitted at nearly the same instant
// (including from different backend instances, since Redis serializes
// script execution) can never both squeeze in over the limit.
const ADMIT_SCRIPT = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local leaseMs = tonumber(ARGV[3])
local limit = tonumber(ARGV[4])
local keyExpiryBufferMs = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, '-inf', now)
local count = redis.call('ZCARD', key)
if count >= limit then
  return 0
end
redis.call('ZADD', key, now + leaseMs, member)
redis.call('PEXPIRE', key, leaseMs + keyExpiryBufferMs)
return 1
`;

// `connectionId` must be unique per connection attempt (socket.id, which
// Engine.IO already generates as a unique, unguessable id per handshake, is
// sufficient and is what callers should pass). Returns false if the user is
// already at their concurrent-connection limit. `leaseTtlMs` is injectable
// (defaults to the real 60s lease) purely so tests can exercise stale-lease
// recovery quickly rather than waiting a full minute.
export async function admitConnection(
  userId: string,
  connectionId: string,
  limit: number,
  leaseTtlMs: number = LEASE_TTL_MS,
  keyExpiryBufferMs: number = KEY_EXPIRY_BUFFER_MS,
): Promise<boolean> {
  const now = Date.now();
  const result = await redis.eval(
    ADMIT_SCRIPT,
    1,
    connectionsKey(userId),
    connectionId,
    now,
    leaseTtlMs,
    limit,
    keyExpiryBufferMs,
  );
  return result === 1;
}

// ROOT CAUSE FIX: a bare ZADD (the previous implementation) updates the
// member's score but never touches the *key's* own TTL — Redis tracks key
// expiry independently of sorted-set member scores. The key's TTL was only
// ever set once, at admission (see ADMIT_SCRIPT's PEXPIRE), so any
// connection alive longer than that original window had its whole
// `conn:user:<id>` key deleted by Redis out from under it, mid-renewal,
// silently undercounting that user's active connections from then on
// (confirmed empirically — see the Phase 3 security audit). Atomic because
// the existence check and the score+TTL update must happen as one
// uninterruptible step: without that, a concurrent release (ZREM) could
// interleave between "member exists" and "re-add it", resurrecting a lease
// that was legitimately freed a moment earlier.
const RENEW_SCRIPT = `
local key = KEYS[1]
local member = ARGV[1]
local now = tonumber(ARGV[2])
local leaseMs = tonumber(ARGV[3])
local keyExpiryBufferMs = tonumber(ARGV[4])

if redis.call('ZSCORE', key, member) == false then
  return 0
end
redis.call('ZADD', key, now + leaseMs, member)
redis.call('PEXPIRE', key, leaseMs + keyExpiryBufferMs)
return 1
`;

// Called periodically for the lifetime of a connection so a long-lived,
// legitimate connection's lease — and the key backing it — never expires
// out from under it. Returns false (a no-op) if this connectionId is no
// longer present (already released or pruned as stale) — deliberately does
// *not* resurrect it, so a renewal racing with this exact connection's own
// disconnect/release can never bring a freed lease back.
export async function renewConnection(
  userId: string,
  connectionId: string,
  leaseTtlMs: number = LEASE_TTL_MS,
  keyExpiryBufferMs: number = KEY_EXPIRY_BUFFER_MS,
): Promise<boolean> {
  const result = await redis.eval(
    RENEW_SCRIPT,
    1,
    connectionsKey(userId),
    connectionId,
    Date.now(),
    leaseTtlMs,
    keyExpiryBufferMs,
  );
  return result === 1;
}

// Frees the slot immediately on a clean disconnect, rather than waiting for
// the lease to expire — lets the same user open a replacement connection
// right away instead of being blocked for up to LEASE_TTL_MS.
export async function releaseConnection(userId: string, connectionId: string): Promise<void> {
  await redis.zrem(connectionsKey(userId), connectionId);
}

export function startHeartbeat(userId: string, connectionId: string): ReturnType<typeof setInterval> {
  const timer = setInterval(() => {
    // Never logs the raw error, which could echo the failing command/key
    // (which embeds the userId) — just a fixed message; a missed renewal
    // just gets retried next interval, or the lease expires harmlessly.
    renewConnection(userId, connectionId).catch(() => {
      console.error("Failed to renew socket connection lease (will retry next interval).");
    });
  }, CONNECTION_HEARTBEAT_INTERVAL_MS);
  timer.unref?.();
  return timer;
}

// Read-only — for tests/diagnostics, never logged with the userId attached
// in production code paths.
export async function countActiveConnections(userId: string): Promise<number> {
  const now = Date.now();
  await redis.zremrangebyscore(connectionsKey(userId), "-inf", now);
  return redis.zcard(connectionsKey(userId));
}
