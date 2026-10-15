import { describe, it, expect } from "vitest";
import { Redis } from "ioredis";
import { pingRedis, redis } from "./client.js";

function unreachableRedis() {
  const client = new Redis({
    host: "127.0.0.1",
    port: 1,
    lazyConnect: true,
    retryStrategy: () => null,
    maxRetriesPerRequest: 1,
  });
  // Without this, an unhandled 'error' event would crash the test process.
  client.on("error", () => {});
  return client;
}

describe("pingRedis", () => {
  it("resolves true against a reachable Redis", async () => {
    await expect(pingRedis(redis)).resolves.toBe(true);
  });

  it("resolves false when Redis is unreachable", async () => {
    const bad = unreachableRedis();
    await expect(pingRedis(bad, 300)).resolves.toBe(false);
    bad.disconnect();
  });

  it("resolves false when the ping exceeds the timeout", async () => {
    await expect(pingRedis(redis, 0)).resolves.toBe(false);
  });
});
