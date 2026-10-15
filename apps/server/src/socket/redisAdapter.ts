import { Redis } from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import { env } from "../config/env.js";

export type RedisAdapterHandles = {
  // The adapter constructor Socket.IO expects as its `adapter` option.
  adapter: ReturnType<typeof createAdapter>;
  close: () => Promise<void>;
};

// Dedicated pub/sub connections for the Socket.IO adapter — deliberately
// separate from the shared matchmaking `redis` client in redis/client.ts.
// Once subscribed, the sub client can never run another command, so sharing
// it with matchmaking (which issues ordinary GET/SET/EVAL commands) would
// break both. This is the only thing this module does: without it, a match
// found / chat message / WebRTC signal emitted from one backend instance
// never reaches a user connected to a different instance (see the audit).
// `redisUrl` is injectable (defaults to the real env var) purely so this is
// unit-testable against a deliberately-unreachable address without touching
// the real connection — see redisAdapter.test.ts.
export async function createRedisAdapter(redisUrl: string = env.REDIS_URL): Promise<RedisAdapterHandles> {
  const pubClient = new Redis(redisUrl);
  const subClient = new Redis(redisUrl);

  pubClient.on("error", (err: Error) => {
    console.error("Socket.IO Redis adapter (pub) connection error:", err.message);
  });
  subClient.on("error", (err: Error) => {
    console.error("Socket.IO Redis adapter (sub) connection error:", err.message);
  });

  function waitUntilReady(client: Redis): Promise<void> {
    if (client.status === "ready") return Promise.resolve();
    return new Promise((resolve, reject) => {
      client.once("ready", resolve);
      client.once("error", reject);
    });
  }

  try {
    await Promise.all([waitUntilReady(pubClient), waitUntilReady(subClient)]);
  } catch (err) {
    // Partial startup failure: at least one client never became ready —
    // don't leave the other connection dangling.
    pubClient.disconnect();
    subClient.disconnect();
    throw err;
  }

  const adapter = createAdapter(pubClient, subClient);

  async function close(): Promise<void> {
    const results = await Promise.allSettled([pubClient.quit(), subClient.quit()]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.error("Error closing Socket.IO adapter Redis connection gracefully, forcing disconnect:", result.reason);
      }
    }
    pubClient.disconnect();
    subClient.disconnect();
  }

  return { adapter, close };
}
