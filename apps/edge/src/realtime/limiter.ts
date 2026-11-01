import { DurableObject } from "cloudflare:workers";
import { limiterFor, type RealtimeEnv } from "./env";

type Window = { count: number; resetAt: number };

export type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number };

// Replaces apps/server/src/redis/rateLimit.ts: the same atomic fixed-window
// counter (INCR, EXPIRE on the first hit of a window, TTL as retry-after). One
// object per key, so concurrent callers are serialized and can never under-count.
export class Limiter extends DurableObject<RealtimeEnv> {
  async hit(limit: number, windowSeconds: number): Promise<RateLimitResult> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      let window = await this.ctx.storage.get<Window>("w");
      if (!window || now >= window.resetAt) {
        window = { count: 0, resetAt: now + windowSeconds * 1000 };
        await this.ctx.storage.setAlarm(window.resetAt);
      }
      window.count += 1;
      await this.ctx.storage.put("w", window);
      const ttl = Math.ceil((window.resetAt - now) / 1000);
      return {
        allowed: window.count <= limit,
        remaining: Math.max(0, limit - window.count),
        retryAfterSeconds: ttl > 0 ? ttl : windowSeconds,
      };
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}

export type LimitCheck = { allowed: boolean; retryAfterSeconds: number };

// Same fail-open policy as the Express server's checkLimitFailOpen: if the
// limiter itself is unreachable the action is allowed, and the failure is
// logged under a fixed category only — never the key (it embeds a user id) and
// never the raw error.
export async function checkLimitFailOpen(
  env: RealtimeEnv,
  key: string,
  limit: number,
  windowSeconds: number,
  category: string,
): Promise<LimitCheck> {
  try {
    const result = await limiterFor(env, key).hit(limit, windowSeconds);
    return { allowed: result.allowed, retryAfterSeconds: result.retryAfterSeconds };
  } catch {
    console.error(`Rate limit check failed (fail-open): ${category}`);
    return { allowed: true, retryAfterSeconds: windowSeconds };
  }
}
