import { describe, it, expect } from "vitest";
import postgres from "postgres";
import { pingDb } from "./client.js";

function unreachablePostgres() {
  return postgres("postgresql://bad:bad@127.0.0.1:1/bad", {
    max: 1,
    connect_timeout: 1,
  });
}

describe("pingDb", () => {
  it("resolves true against a reachable Postgres", async () => {
    await expect(pingDb()).resolves.toBe(true);
  });

  it("resolves false when Postgres is unreachable", async () => {
    const bad = unreachablePostgres();
    await expect(pingDb(bad, 500)).resolves.toBe(false);
    await bad.end({ timeout: 1 });
  });

  it("resolves false when the ping exceeds the timeout", async () => {
    await expect(pingDb(undefined, 0)).resolves.toBe(false);
  });
});
