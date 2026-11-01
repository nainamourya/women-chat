import type { Response } from "express";
import { checkLimitFailOpen as limitFailOpen, type LimitCheck } from "../realtime/limiter";
import { getRequestContext } from "../realtime/env";

// Build-time replacement for apps/server/src/redis/rateLimit.ts (see
// scripts/build.mjs), for the server routers the Worker reuses. Same signature
// and fail-open behavior; the counter lives in the Limiter Durable Object.
export type { LimitCheck };

export function checkLimitFailOpen(key: string, limit: number, windowSeconds: number, category: string): Promise<LimitCheck> {
  return limitFailOpen(getRequestContext().env, key, limit, windowSeconds, category);
}

// Identical to the Express server's: deliberately generic, never says which
// limit was hit.
export function sendRateLimitedResponse(res: Response, retryAfterSeconds: number): void {
  res.setHeader("Retry-After", String(Math.max(1, Math.ceil(retryAfterSeconds))));
  res.status(429).json({ error: "Too many attempts. Please try again later." });
}
