import { redis } from "./client.js";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

// Atomic fixed-window counter — same atomic-Lua-script approach as
// matchmakingQueue.ts, so concurrent requests (including from different
// backend instances, since this is backed by the shared Redis rather than
// process memory) can never under-count. The first increment in a window
// sets the expiry; the window only resets once that expiry elapses.
//
// Fixed-window is a deliberate initial choice: simple and cheap, with a
// known tradeoff (a burst straddling a window boundary can briefly allow up
// to ~2x the limit). A sliding-window-log or token-bucket would avoid that
// but add complexity — only worth it if real abuse patterns show this gap
// matters in practice.
const INCR_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {current, ttl}
`;

// `key` must already be a fully-formed, caller-chosen Redis key (e.g.
// "ratelimit:login:email:<normalized-email>") — this module has no opinion
// on naming, only on atomicity. Callers must never log the key themselves
// (it may embed an email/IP) — see routes/auth.ts for how failures are
// logged generically instead.
export async function checkRateLimit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
  const [current, ttl] = (await redis.eval(INCR_SCRIPT, 1, key, windowSeconds)) as [number, number];
  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
    retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
  };
}

export type LimitCheck = { allowed: boolean; retryAfterSeconds: number };

// Shared fail-open wrapper for every rate-limited endpoint/event in this
// app. FAIL-OPEN POLICY (deliberate, not silent — every failure is logged):
// if Redis itself is unreachable, the action is allowed through rather than
// blocked. This is logged under a fixed, caller-supplied category label
// only — never the key itself (which may embed an email/userId/IP) and
// never the raw error object (which can echo the failing command/key back).
//
// Why fail-open: for login/register (Phase 1), Postgres — not Redis — is
// the real dependency; failing closed here would mean a transient Redis
// blip locks every user out of login entirely, a worse outcome than briefly
// degraded abuse-protection. For matchmaking/socket-tickets/chat (Phase 2),
// this choice mostly doesn't matter in practice: the matchmaking queue and
// socket-ticket auth both already hard-depend on Redis, so if Redis is
// down, those features are already unusable regardless of what the
// rate limiter does. Kept consistent across both phases for simplicity.
export async function checkLimitFailOpen(
  key: string,
  limit: number,
  windowSeconds: number,
  category: string,
): Promise<LimitCheck> {
  try {
    const result = await checkRateLimit(key, limit, windowSeconds);
    return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
  } catch {
    console.error(`Rate limit check failed (fail-open): ${category}`);
    return { allowed: true, retryAfterSeconds: windowSeconds };
  }
}

// Shared HTTP 429 response shape — deliberately generic (never reveals
// which specific limit was hit, or whether e.g. an email/account exists).
export function sendRateLimitedResponse(res: import("express").Response, retryAfterSeconds: number): void {
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  res.status(429).json({ error: "Too many attempts. Please try again later." });
}
