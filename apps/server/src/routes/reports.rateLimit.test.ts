import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { inArray } from "drizzle-orm";
import { reportsRouter } from "./reports.js";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

// Integration test against the real Express route. Uses real verified users
// so createReport's own validation succeeds (not just the limiter), proving
// the limit is reached through normal, successful use — not just 400s. Each
// attempt targets a *different* reported user, since reports.service.ts
// already has its own separate duplicate-report guard (same reporter +
// same reported user within 10 minutes) that would otherwise interfere with
// testing the rate limiter specifically.

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
  app.use("/api/reports", reportsRouter);
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

function createReportRequest(reporterUserId: string, reportedUserId: string) {
  return fetch(`${baseUrl}/api/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET },
    body: JSON.stringify({
      reporterUserId,
      reportedUserId,
      reason: "other",
      description: "rate limit test",
    }),
  });
}

describe("report creation rate limiting", () => {
  it("allows up to 5 reports per hour, blocks the 6th with 429 — without banning the reporter", async () => {
    const reporter = await createVerifiedUser(`reportlimit-${randomUUID()}@example.com`);

    for (let i = 0; i < 5; i++) {
      const reported = await createVerifiedUser(`reported-${randomUUID()}@example.com`);
      const res = await createReportRequest(reporter.id, reported.id);
      expect(res.status).toBe(201);
    }

    const lastReported = await createVerifiedUser(`reported-${randomUUID()}@example.com`);
    const blocked = await createReportRequest(reporter.id, lastReported.id);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();

    // Hitting the limit must never itself ban/suspend the reporter.
    const stillVerified = await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, reporter.id) });
    expect(stillVerified?.accountStatus).toBe("active");
  }, 15_000);

  it("keeps the limit independent per reporter", async () => {
    const reporterA = await createVerifiedUser(`reportlimit-a-${randomUUID()}@example.com`);
    const reporterB = await createVerifiedUser(`reportlimit-b-${randomUUID()}@example.com`);

    for (let i = 0; i < 6; i++) {
      const reported = await createVerifiedUser(`reported-a-${randomUUID()}@example.com`);
      await createReportRequest(reporterA.id, reported.id);
    }
    const lastReportedA = await createVerifiedUser(`reported-a-${randomUUID()}@example.com`);
    const blockedA = await createReportRequest(reporterA.id, lastReportedA.id);
    expect(blockedA.status).toBe(429);

    const reportedB = await createVerifiedUser(`reported-b-${randomUUID()}@example.com`);
    const allowedB = await createReportRequest(reporterB.id, reportedB.id);
    expect(allowedB.status).toBe(201);
  }, 15_000);
});
