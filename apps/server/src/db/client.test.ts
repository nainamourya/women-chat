import { afterAll, afterEach, describe, it, expect, vi } from "vitest";
import postgres from "postgres";
import { closeDb, pingDb } from "./client.js";

type PostgresClient = ReturnType<typeof postgres>;

// Every extra client a test creates is tracked and closed in afterEach, so a
// failing assertion can never leave a connection open.
const created: PostgresClient[] = [];

function unreachablePostgres() {
  const client = postgres("postgresql://bad:bad@127.0.0.1:1/bad", {
    max: 1,
    connect_timeout: 1,
  });
  created.push(client);
  return client;
}

// A stand-in whose query never settles on its own, so "the ping exceeds the
// timeout" is simulated exactly rather than raced against real latency (a
// tiny real timeout against a local database is a coin flip).
function hungPostgres() {
  return vi.fn(() => new Promise<never>(() => {})) as unknown as PostgresClient;
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(created.splice(0).map((client) => client.end({ timeout: 1 })));
});

afterAll(async () => {
  await closeDb();
});

describe("pingDb", () => {
  it("resolves true against a reachable Postgres", async () => {
    await expect(pingDb()).resolves.toBe(true);
  });

  it("resolves false when Postgres is unreachable", async () => {
    const bad = unreachablePostgres();
    await expect(pingDb(bad, 500)).resolves.toBe(false);
  });

  it("resolves false when the ping exceeds the timeout, and not before", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = hungPostgres();

    let settled: boolean | undefined;
    const result = pingDb(client, 2000).then((value) => (settled = value));

    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBeUndefined();

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toBe(false);
    expect(client).toHaveBeenCalledTimes(1);
  });

  it("does not leave its timeout timer behind after a successful ping", async () => {
    vi.useFakeTimers();
    const client = vi.fn(async () => [{ "?column?": 1 }]) as unknown as PostgresClient;

    await expect(pingDb(client, 2000)).resolves.toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not leave its timeout timer behind after a failed ping", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    const client = vi.fn(async () => Promise.reject(new Error("connection lost"))) as unknown as PostgresClient;

    await expect(pingDb(client, 2000)).resolves.toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
