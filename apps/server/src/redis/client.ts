import { Redis } from "ioredis";
import { env } from "../config/env.js";

// Backs the matchmaking queue/status keys and one-time socket tickets.
export const redis = new Redis(env.REDIS_URL);

redis.on("error", (err: Error) => {
  console.error("Redis connection error:", err);
});

// `client` is injectable (defaults to the shared singleton above) purely so
// this is unit-testable against a deliberately-unreachable instance without
// touching the real connection — see client.test.ts.
export async function pingRedis(client: Redis = redis, timeoutMs = 2000): Promise<boolean> {
  try {
    const result = await Promise.race([
      client.ping(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Redis ping timed out")), timeoutMs)),
    ]);
    return result === "PONG";
  } catch (err) {
    console.error("Redis health check failed:", err);
    return false;
  }
}

// Graceful close: QUIT waits for in-flight replies before closing. Falls
// back to a hard disconnect so shutdown never hangs on a wedged connection.
export async function closeRedis(client: Redis = redis): Promise<void> {
  try {
    await client.quit();
  } catch (err) {
    console.error("Error closing Redis connection gracefully, forcing disconnect:", err);
    client.disconnect();
  }
}
