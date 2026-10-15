import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";
import { admitConnection, releaseConnection, renewConnection, countActiveConnections } from "./connectionLimit.js";

function uniqueUserId(): string {
  return `test-user-${randomUUID()}`;
}

describe("admitConnection", () => {
  it("admits connections up to the limit, rejects the one after", async () => {
    const userId = uniqueUserId();
    expect(await admitConnection(userId, "conn-1", 3)).toBe(true);
    expect(await admitConnection(userId, "conn-2", 3)).toBe(true);
    expect(await admitConnection(userId, "conn-3", 3)).toBe(true);
    expect(await admitConnection(userId, "conn-4", 3)).toBe(false);
    expect(await countActiveConnections(userId)).toBe(3);
  });

  it("admits concurrent connection attempts atomically without over-admitting", async () => {
    const userId = uniqueUserId();
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, i) => admitConnection(userId, `race-${i}`, 3)),
    );
    const admittedCount = attempts.filter(Boolean).length;
    expect(admittedCount).toBe(3);
    expect(await countActiveConnections(userId)).toBe(3);
  });

  it("frees a slot immediately on release, allowing a new connection right away", async () => {
    const userId = uniqueUserId();
    await admitConnection(userId, "conn-1", 2);
    await admitConnection(userId, "conn-2", 2);
    expect(await admitConnection(userId, "conn-3", 2)).toBe(false);

    await releaseConnection(userId, "conn-1");
    expect(await countActiveConnections(userId)).toBe(1);
    expect(await admitConnection(userId, "conn-3", 2)).toBe(true);
  });

  it("recovers a stale (expired, never-released) lease without any manual cleanup", async () => {
    const userId = uniqueUserId();
    const shortTtlMs = 100;
    await admitConnection(userId, "conn-1", 1, shortTtlMs);
    // Simulates a crashed instance: never releases, disconnect never fires.
    expect(await admitConnection(userId, "conn-2", 1, shortTtlMs)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 150));

    // The next admit attempt for this same user prunes the expired lease
    // itself — no separate sweep/cleanup job needed.
    expect(await admitConnection(userId, "conn-2", 1, shortTtlMs)).toBe(true);
    expect(await countActiveConnections(userId)).toBe(1);
  });

  it("keeps separate users' connection counts independent", async () => {
    const userA = uniqueUserId();
    const userB = uniqueUserId();
    await admitConnection(userA, "a-1", 1);
    expect(await admitConnection(userA, "a-2", 1)).toBe(false);
    expect(await admitConnection(userB, "b-1", 1)).toBe(true);
  });
});

describe("renewConnection", () => {
  it("extends a lease so it survives past its original expiry", async () => {
    const userId = uniqueUserId();
    const shortTtlMs = 150;
    await admitConnection(userId, "conn-1", 1, shortTtlMs);

    await new Promise((resolve) => setTimeout(resolve, 80));
    await renewConnection(userId, "conn-1"); // renews with the real (long) default lease

    await new Promise((resolve) => setTimeout(resolve, 150));
    // Had this not been renewed, conn-1 would have expired by now and a new
    // connection would be admitted instead.
    expect(await admitConnection(userId, "conn-2", 1, shortTtlMs)).toBe(false);
  });

  // Regression tests for the confirmed High-severity bug: the key's own TTL
  // was only ever set once, at admission — a bare ZADD renewal never
  // refreshed it, so Redis deleted the whole key out from under a
  // long-lived, actively-renewed connection once the *original* admission
  // window elapsed, silently undercounting that user's connections from
  // then on.

  it("keeps a long-lived, continuously-renewed connection counted well past the original lease TTL window", async () => {
    const userId = uniqueUserId();
    // Generous relative to real Upstash network round-trip time (this test
    // talks to the real, remote dev Redis, not a local one) so the
    // assertion is about the TTL-refresh logic, not network jitter.
    const shortTtlMs = 500;
    const shortBufferMs = 500; // real default is 60_000 — shrunk so the test can actually elapse past it
    expect(await admitConnection(userId, "conn-1", 1, shortTtlMs, shortBufferMs)).toBe(true);

    // Renew well within the lease window, repeatedly, for several times the
    // ORIGINAL key TTL window (leaseMs + bufferMs = 1000ms here) — this is
    // exactly the scenario that silently broke before the fix.
    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(await renewConnection(userId, "conn-1", shortTtlMs, shortBufferMs)).toBe(true);
    }

    expect(await countActiveConnections(userId)).toBe(1);
  }, 10_000);

  it("keeps a 3rd connection rejected at the configured cap, even after the original lease TTL period has elapsed", async () => {
    const userId = uniqueUserId();
    const shortTtlMs = 500;
    const shortBufferMs = 500;
    await admitConnection(userId, "conn-1", 2, shortTtlMs, shortBufferMs);
    await admitConnection(userId, "conn-2", 2, shortTtlMs, shortBufferMs);

    for (let i = 0; i < 6; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200));
      await renewConnection(userId, "conn-1", shortTtlMs, shortBufferMs);
      await renewConnection(userId, "conn-2", shortTtlMs, shortBufferMs);
    }

    // Well past the point where the pre-fix key-level TTL would have
    // deleted the whole key, wiping out both counted connections.
    expect(await admitConnection(userId, "conn-3", 2, shortTtlMs, shortBufferMs)).toBe(false);
    expect(await countActiveConnections(userId)).toBe(2);
  }, 10_000);

  it("does not resurrect a released lease via a late or racing renewal", async () => {
    const userId = uniqueUserId();
    await admitConnection(userId, "conn-1", 1);
    await releaseConnection(userId, "conn-1");

    expect(await renewConnection(userId, "conn-1")).toBe(false);
    expect(await countActiveConnections(userId)).toBe(0);
    // A new connection must be admitted normally — the released slot was
    // not left in some inconsistent state by the renewal attempt.
    expect(await admitConnection(userId, "conn-2", 1)).toBe(true);
  });

  it("cannot renew or release a different socket's lease", async () => {
    const userId = uniqueUserId();
    await admitConnection(userId, "conn-1", 2);
    await admitConnection(userId, "conn-2", 2);

    await releaseConnection(userId, "conn-1");
    expect(await countActiveConnections(userId)).toBe(1);

    // conn-2 is completely unaffected by conn-1's release.
    expect(await renewConnection(userId, "conn-2")).toBe(true);
    expect(await countActiveConnections(userId)).toBe(1);

    // Renewing the already-released conn-1 still does not resurrect it,
    // and does not touch conn-2 either.
    expect(await renewConnection(userId, "conn-1")).toBe(false);
    expect(await countActiveConnections(userId)).toBe(1);
  });

  it("handles concurrent renewals for the same connection safely (shared Redis, as across backend instances)", async () => {
    const userId = uniqueUserId();
    await admitConnection(userId, "conn-1", 1);

    const results = await Promise.all(Array.from({ length: 10 }, () => renewConnection(userId, "conn-1")));
    expect(results.every(Boolean)).toBe(true);
    expect(await countActiveConnections(userId)).toBe(1);
  });

  it("keeps concurrent admissions and renewals safe together under the same cap", async () => {
    const userId = uniqueUserId();
    await admitConnection(userId, "conn-1", 3);
    await admitConnection(userId, "conn-2", 3);

    const [admitResults] = await Promise.all([
      Promise.all(Array.from({ length: 10 }, (_, i) => admitConnection(userId, `race-${i}`, 3))),
      Promise.all([renewConnection(userId, "conn-1"), renewConnection(userId, "conn-2")]),
    ]);

    // Only 1 more slot was available (2 already held, cap 3).
    expect(admitResults.filter(Boolean).length).toBe(1);
    expect(await countActiveConnections(userId)).toBe(3);
  });
});
