import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { blocksRouter } from "./blocks.js";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

// Integration test against the real Express route. `blocks` has foreign key
// constraints to real users, so — unlike the matchmaking limiter tests,
// where a rejected (429) request never reaches the DB at all — any request
// expected to actually *succeed* here needs a real seeded user.

let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;
const testUserIds: string[] = [];

async function createVerifiedUser(email: string) {
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash: "test-hash-not-used",
      displayName: email,
      ageConfirmed18: true,
      verificationStatus: "verified",
    })
    .returning();
  testUserIds.push(user.id);
  return user;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/blocks", blocksRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  if (testUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
});

function request(method: "POST" | "DELETE", blockerUserId: string, blockedUserId: string) {
  return fetch(`${baseUrl}/api/blocks`, {
    method,
    headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET },
    body: JSON.stringify({ blockerUserId, blockedUserId }),
  });
}

describe("block/unblock rate limiting", () => {
  it("allows up to 20 block actions per hour, blocks the 21st with 429", async () => {
    const blocker = await createVerifiedUser(`blocklimit-${randomUUID()}@example.com`);

    for (let i = 0; i < 20; i++) {
      const blocked = await createVerifiedUser(`blocked-${randomUUID()}@example.com`);
      const res = await request("POST", blocker.id, blocked.id);
      expect(res.status).toBe(200);
    }
    const lastBlocked = await createVerifiedUser(`blocked-${randomUUID()}@example.com`);
    const blockedRes = await request("POST", blocker.id, lastBlocked.id);
    expect(blockedRes.status).toBe(429);
    expect(blockedRes.headers.get("Retry-After")).toBeTruthy();
  }, 20_000);

  it("shares one bucket between block and unblock actions", async () => {
    const blocker = await createVerifiedUser(`blocklimit-share-${randomUUID()}@example.com`);
    const target = await createVerifiedUser(`blocked-share-${randomUUID()}@example.com`);

    for (let i = 0; i < 10; i++) {
      const other = await createVerifiedUser(`blocked-${randomUUID()}@example.com`);
      await request("POST", blocker.id, other.id);
    }
    for (let i = 0; i < 10; i++) {
      await request("DELETE", blocker.id, target.id);
    }
    const res = await request("DELETE", blocker.id, target.id);
    expect(res.status).toBe(429);
  }, 20_000);

  it("keeps the limit independent per blocker", async () => {
    const blockerA = await createVerifiedUser(`blocklimit-a-${randomUUID()}@example.com`);
    const blockerB = await createVerifiedUser(`blocklimit-b-${randomUUID()}@example.com`);

    for (let i = 0; i < 21; i++) {
      const target = await createVerifiedUser(`blocked-a-${randomUUID()}@example.com`);
      await request("POST", blockerA.id, target.id);
    }
    const lastTargetA = await createVerifiedUser(`blocked-a-${randomUUID()}@example.com`);
    const blockedA = await request("POST", blockerA.id, lastTargetA.id);
    expect(blockedA.status).toBe(429);

    const targetB = await createVerifiedUser(`blocked-b-${randomUUID()}@example.com`);
    const allowedB = await request("POST", blockerB.id, targetB.id);
    expect(allowedB.status).toBe(200);
  }, 20_000);
});
