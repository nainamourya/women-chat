import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { adminVerificationRouter } from "./adminVerification.js";
import { verificationRouter } from "./verification.js";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { users, verificationSubmissions } from "../db/schema.js";
import { fakeMp4Base64 } from "../testUtils/fakeVideo.js";

// Mocks the R2 (S3-compatible) client — see videoStorage.test.ts for why
// this needs to be a self-contained vi.hoisted block in every file that
// needs it (a vitest hoisting constraint, not a design choice).
const { mockSend, forceNextFailure } = vi.hoisted(() => {
  const store = new Map<string, Buffer>();
  let forced: { op: string; error: Error } | null = null;

  function notFoundError(name: "NoSuchKey" | "NotFound") {
    const err = new Error("not found") as Error & { name: string; $metadata: { httpStatusCode: number } };
    err.name = name;
    err.$metadata = { httpStatusCode: 404 };
    return err;
  }

  const mockSend = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const ctor = command.constructor.name;
    const key = command.input.Key as string;

    if (forced && forced.op === ctor) {
      const err = forced.error;
      forced = null;
      throw err;
    }

    if (ctor === "PutObjectCommand") {
      store.set(key, Buffer.from(command.input.Body as Buffer));
      return {};
    }
    if (ctor === "GetObjectCommand") {
      const body = store.get(key);
      if (!body) throw notFoundError("NoSuchKey");
      return { Body: { transformToByteArray: async () => body } };
    }
    if (ctor === "DeleteObjectCommand") {
      store.delete(key);
      return {};
    }
    if (ctor === "HeadObjectCommand") {
      if (!store.has(key)) throw notFoundError("NotFound");
      return {};
    }
    throw new Error("unexpected command: " + ctor);
  };

  return {
    mockSend,
    forceNextFailure: (op: string, error: Error) => {
      forced = { op, error };
    },
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class S3Client {
    send = mockSend;
  },
  PutObjectCommand: class PutObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  GetObjectCommand: class GetObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  DeleteObjectCommand: class DeleteObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  HeadObjectCommand: class HeadObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;
const testUserIds: string[] = [];

async function createUser(role: "user" | "admin" = "user") {
  const [user] = await db
    .insert(users)
    .values({
      email: `adminverify-${randomUUID()}@example.com`,
      passwordHash: "test-hash-not-used",
      displayName: "Test user",
      ageConfirmed18: true,
      verificationStatus: "pending",
      role,
    })
    .returning();
  testUserIds.push(user.id);
  return user;
}

async function submitVideoFor(userId: string) {
  const res = await fetch(`${baseUrl}/api/verification/video`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET },
    body: JSON.stringify({ userId, videoBase64: fakeMp4Base64(), mimeType: "video/mp4", acknowledgedNotice: true }),
  });
  const body = (await res.json()) as { submission: { id: string } };
  return body.submission;
}

async function storageKeyFor(submissionId: string): Promise<string | null> {
  const row = await db.query.verificationSubmissions.findFirst({ where: eq(verificationSubmissions.id, submissionId) });
  return row?.videoStorageKey ?? null;
}

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "40mb" }));
  app.use("/api/verification", verificationRouter);
  app.use("/api/admin/verification", adminVerificationRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  if (testUserIds.length > 0) {
    // reviewedBy has no ON DELETE CASCADE (unlike userId), so submissions
    // referencing a test user as reviewer must be cleared first.
    await db
      .delete(verificationSubmissions)
      .where(or(inArray(verificationSubmissions.userId, testUserIds), inArray(verificationSubmissions.reviewedBy, testUserIds)));
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
});

function withSecret(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET, ...init.headers },
  };
}

describe("admin verification routes — admin-only enforcement", () => {
  it("rejects listing submissions for a non-admin user", async () => {
    const nonAdmin = await createUser("user");
    const res = await fetch(
      `${baseUrl}/api/admin/verification?adminUserId=${nonAdmin.id}`,
      withSecret(),
    );
    expect(res.status).toBe(403);
  });

  it("rejects viewing a submission's video for a non-admin user", async () => {
    const applicant = await createUser("user");
    const nonAdmin = await createUser("user");
    const submission = await submitVideoFor(applicant.id);

    const res = await fetch(
      `${baseUrl}/api/admin/verification/${submission.id}/video?adminUserId=${nonAdmin.id}`,
      withSecret(),
    );
    expect(res.status).toBe(403);

    // The video must still exist — a rejected unauthorized request must not
    // have triggered any deletion side effect.
    expect(await storageKeyFor(submission.id)).toBeTruthy();
  });

  it("rejects recording a decision for a non-admin user", async () => {
    const applicant = await createUser("user");
    const nonAdmin = await createUser("user");
    const submission = await submitVideoFor(applicant.id);

    const res = await fetch(
      `${baseUrl}/api/admin/verification/${submission.id}`,
      withSecret({ method: "PATCH", body: JSON.stringify({ adminUserId: nonAdmin.id, decision: "approved" }) }),
    );
    expect(res.status).toBe(403);
  });

  it("allows an admin to list, view, and decide on a submission", async () => {
    const applicant = await createUser("user");
    const admin = await createUser("admin");
    const submission = await submitVideoFor(applicant.id);

    const listRes = await fetch(
      `${baseUrl}/api/admin/verification?adminUserId=${admin.id}&status=pending_review`,
      withSecret(),
    );
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { submissions: { id: string }[] };
    expect(listBody.submissions.some((s) => s.id === submission.id)).toBe(true);

    const videoRes = await fetch(
      `${baseUrl}/api/admin/verification/${submission.id}/video?adminUserId=${admin.id}`,
      withSecret(),
    );
    expect(videoRes.status).toBe(200);

    const decisionRes = await fetch(
      `${baseUrl}/api/admin/verification/${submission.id}`,
      withSecret({ method: "PATCH", body: JSON.stringify({ adminUserId: admin.id, decision: "approved" }) }),
    );
    expect(decisionRes.status).toBe(200);

    const refreshedUser = await db.query.users.findFirst({ where: eq(users.id, applicant.id) });
    expect(refreshedUser?.verificationStatus).toBe("verified");
  });

  it("requires a rejection reason when rejecting", async () => {
    const applicant = await createUser("user");
    const admin = await createUser("admin");
    const submission = await submitVideoFor(applicant.id);

    const res = await fetch(
      `${baseUrl}/api/admin/verification/${submission.id}`,
      withSecret({ method: "PATCH", body: JSON.stringify({ adminUserId: admin.id, decision: "rejected" }) }),
    );
    expect(res.status).toBe(400);
  });
});

describe("admin verification routes — deletion failure and retry", () => {
  it("withholds approval and allows a safe retry when deletion fails", async () => {
    const applicant = await createUser("user");
    const admin = await createUser("admin");
    const submission = await submitVideoFor(applicant.id);
    const storageKey = await storageKeyFor(submission.id);
    expect(storageKey).toBeTruthy();

    // Force a genuine deletion-confirmation failure at the R2 layer — the
    // mocked S3 client's next HeadObjectCommand call throws, simulating an
    // R2 auth/network failure specifically during the post-delete existence
    // check (see videoStorage.test.ts for the equivalent unit-level test).
    forceNextFailure("HeadObjectCommand", new Error("simulated R2 outage confirming deletion"));

    const decisionRes = await fetch(
      `${baseUrl}/api/admin/verification/${submission.id}`,
      withSecret({ method: "PATCH", body: JSON.stringify({ adminUserId: admin.id, decision: "approved" }) }),
    );
    expect(decisionRes.status).toBe(200);
    const decisionBody = await decisionRes.json();
    expect(decisionBody).toEqual({ finalized: false, deletionPending: true });

    const stillPendingUser = await db.query.users.findFirst({ where: eq(users.id, applicant.id) });
    expect(stillPendingUser?.verificationStatus).toBe("pending");

    // No further forced failure — retry must be the only way access is
    // subsequently granted.
    const retryRes = await fetch(
      `${baseUrl}/api/admin/verification/${submission.id}/retry-deletion`,
      withSecret({ method: "POST", body: JSON.stringify({ adminUserId: admin.id }) }),
    );
    expect(retryRes.status).toBe(200);
    const retryBody = await retryRes.json();
    expect(retryBody).toEqual({ finalized: true, deletionPending: false });

    const verifiedUser = await db.query.users.findFirst({ where: eq(users.id, applicant.id) });
    expect(verifiedUser?.verificationStatus).toBe("verified");
  });

  it("rejects a retry-deletion request from a non-admin user", async () => {
    const applicant = await createUser("user");
    const nonAdmin = await createUser("user");
    const submission = await submitVideoFor(applicant.id);

    const res = await fetch(
      `${baseUrl}/api/admin/verification/${submission.id}/retry-deletion`,
      withSecret({ method: "POST", body: JSON.stringify({ adminUserId: nonAdmin.id }) }),
    );
    expect(res.status).toBe(403);
  });
});
