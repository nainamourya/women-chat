import { Redis } from "ioredis";
import { env } from "../config/env.js";

// Not used by any route yet (Phase 1/2 scope). Connected here so matchmaking
// and presence logic in later phases can rely on it without further setup.
export const redis = new Redis(env.REDIS_URL);

redis.on("error", (err: Error) => {
  console.error("Redis connection error:", err);
});
