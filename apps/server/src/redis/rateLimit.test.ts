import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { checkRateLimit } from "./rateLimit.js";

function uniqueKey(label: string): string {
  return `ratelimit:test:${label}:${randomUUID()}`;
}

describe("checkRateLimit", () => {
  it("allows requests under the limit", async () => {
    const key = uniqueKey("under");
    const r1 = await checkRateLimit(key, 3, 10);
    const r2 = await checkRateLimit(key, 3, 10);
    expect(r1.allowed).toBe(true);
    expect(r2.allowed).toBe(true);
    expect(r2.remaining).toBe(1);
  });

  it("blocks once the limit is reached", async () => {
    const key = uniqueKey("blocked");
    await checkRateLimit(key, 2, 10);
    await checkRateLimit(key, 2, 10);
    const third = await checkRateLimit(key, 2, 10);
    expect(third.allowed).toBe(false);
    expect(third.remaining).toBe(0);
    expect(third.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets after the window expires", async () => {
    const key = uniqueKey("expiry");
    await checkRateLimit(key, 1, 1);
    const blocked = await checkRateLimit(key, 1, 1);
    expect(blocked.allowed).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 1200));

    const afterExpiry = await checkRateLimit(key, 1, 1);
    expect(afterExpiry.allowed).toBe(true);
  }, 10_000);

  it("counts concurrent requests atomically without under-counting", async () => {
    const key = uniqueKey("concurrent");
    const results = await Promise.all(Array.from({ length: 20 }, () => checkRateLimit(key, 10, 10)));
    const allowedCount = results.filter((r) => r.allowed).length;
    expect(allowedCount).toBe(10);
  });

  it("keeps separate keys independent", async () => {
    const keyA = uniqueKey("a");
    const keyB = uniqueKey("b");
    await checkRateLimit(keyA, 1, 10);
    const blockedA = await checkRateLimit(keyA, 1, 10);
    const allowedB = await checkRateLimit(keyB, 1, 10);
    expect(blockedA.allowed).toBe(false);
    expect(allowedB.allowed).toBe(true);
  });
});
