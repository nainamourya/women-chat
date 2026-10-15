import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { verificationRouter } from "./verification.js";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { fakeMp4Base64 } from "../testUtils/fakeVideo.js";

// Mocks the R2 (S3-compatible) client — see videoStorage.test.ts for why
// this needs to be a self-contained vi.hoisted block in every file that
// needs it (a vitest hoisting constraint, not a design choice).
const { mockSend } = vi.hoisted(() => {
  const store = new Map<string, Buffer>();

  function notFoundError(name: "NoSuchKey" | "NotFound") {
    const err = new Error("not found") as Error & { name: string; $metadata: { httpStatusCode: number } };
    err.name = name;
    err.$metadata = { httpStatusCode: 404 };
    return err;
  }

  const mockSend = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const ctor = command.constructor.name;
    const key = command.input.Key as string;

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

  return { mockSend };
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

async function createUser() {
  const [user] = await db
    .insert(users)
    .values({
      email: `verifyroute-${randomUUID()}@example.com`,
      passwordHash: "test-hash-not-used",
      displayName: "Test user",
      ageConfirmed18: true,
      verificationStatus: "pending",
    })
    .returning();
  testUserIds.push(user.id);
  return user;
}

beforeAll(async () => {
  const app = express();
  app.use("/api/verification", verificationRouter);
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

function submitVideo(body: Record<string, unknown>, withSecret = true) {
  return fetch(`${baseUrl}/api/verification/video`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(withSecret ? { "x-internal-api-secret": env.INTERNAL_API_SECRET } : {}),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /api/verification/video", () => {
  it("rejects requests without the internal secret (not a public endpoint)", async () => {
    const user = await createUser();
    const res = await submitVideo(
      { userId: user.id, videoBase64: fakeMp4Base64(), mimeType: "video/mp4", acknowledgedNotice: true },
      false,
    );
    expect(res.status).toBe(401);
  });

  it("rejects an upload without explicit acknowledgement", async () => {
    const user = await createUser();
    const res = await submitVideo({
      userId: user.id,
      videoBase64: fakeMp4Base64(),
      mimeType: "video/mp4",
      acknowledgedNotice: false,
    });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid video (bad signature)", async () => {
    const user = await createUser();
    const res = await submitVideo({
      userId: user.id,
      videoBase64: Buffer.from("not a real video").toString("base64"),
      mimeType: "video/mp4",
      acknowledgedNotice: true,
    });
    expect(res.status).toBe(400);
  });

  it("accepts a valid upload and reports status afterward", async () => {
    const user = await createUser();
    const res = await submitVideo({
      userId: user.id,
      videoBase64: fakeMp4Base64(),
      mimeType: "video/mp4",
      acknowledgedNotice: true,
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { submission: { status: string } };
    expect(body.submission.status).toBe("pending_review");

    const statusRes = await fetch(`${baseUrl}/api/verification/video/status/${user.id}`, {
      headers: { "x-internal-api-secret": env.INTERNAL_API_SECRET },
    });
    const statusBody = (await statusRes.json()) as { submission: { status: string } };
    expect(statusBody.submission.status).toBe("pending_review");
  });

  it("rejects a video exceeding the 15-second limit, end-to-end over HTTP", async () => {
    const user = await createUser();
    const res = await submitVideo({
      userId: user.id,
      videoBase64: fakeMp4Base64(20),
      mimeType: "video/mp4",
      acknowledgedNotice: true,
    });
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate submission while one is pending review", async () => {
    const user = await createUser();
    const first = await submitVideo({
      userId: user.id,
      videoBase64: fakeMp4Base64(),
      mimeType: "video/mp4",
      acknowledgedNotice: true,
    });
    expect(first.status).toBe(201);

    const second = await submitVideo({
      userId: user.id,
      videoBase64: fakeMp4Base64(),
      mimeType: "video/mp4",
      acknowledgedNotice: true,
    });
    expect(second.status).toBe(409);
  });
});
