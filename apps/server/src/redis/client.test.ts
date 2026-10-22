import { afterAll, afterEach, describe, it, expect, vi } from "vitest";
import { Redis } from "ioredis";
import { closeRedis, pingRedis, redis } from "./client.js";

// Every extra client a test creates is tracked and torn down in afterEach, so
// a failing assertion can never leave a connection open.
const created: Redis[] = [];

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
  created.push(client);
  return client;
}

// A stand-in whose PING never settles on its own, so "the ping exceeds the
// timeout" is simulated exactly rather than raced against real network
// latency (a local PING takes ~0.2ms, so a tiny real timeout is a coin flip).
function hungRedis() {
  return { ping: vi.fn(() => new Promise<never>(() => {})) } as unknown as Redis;
}

afterEach(() => {
  vi.useRealTimers();
  for (const client of created.splice(0)) client.disconnect();
});

afterAll(async () => {
  await closeRedis(redis);
});

describe("pingRedis", () => {
  it("resolves true against a reachable Redis", async () => {
    await expect(pingRedis(redis)).resolves.toBe(true);
  });

  it("resolves false when Redis is unreachable", async () => {
    const bad = unreachableRedis();
    await expect(pingRedis(bad, 300)).resolves.toBe(false);
  });

  it("resolves false when the ping exceeds the timeout, and not before", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = hungRedis();

    let settled: boolean | undefined;
    const result = pingRedis(client, 2000).then((value) => (settled = value));

    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
    expect(client.ping).toHaveBeenCalledTimes(1);
  });

  it("does not leave its timeout timer behind after a successful ping", async () => {
    vi.useFakeTimers();
    const client = { ping: vi.fn(async () => "PONG") } as unknown as Redis;

    await expect(pingRedis(client, 2000)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not leave its timeout timer behind after a failed ping", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = { ping: vi.fn(async () => Promise.reject(new Error("connection lost"))) } as unknown as Redis;

    await expect(pingRedis(client, 2000)).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("resolves false for a reply other than PONG", async () => {
    const client = { ping: vi.fn(async () => "NOPE") } as unknown as Redis;
    await expect(pingRedis(client, 2000)).resolves.toBe(false);
  });
});
