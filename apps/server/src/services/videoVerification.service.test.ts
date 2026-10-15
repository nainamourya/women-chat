import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import { eq, inArray, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, verificationSubmissions } from "../db/schema.js";
import { AuthError } from "./auth.service.js";
import { fakeMp4Base64 } from "../testUtils/fakeVideo.js";
import {
  getOwnLatestSubmission,
  recordReviewDecision,
  retryPendingDeletion,
  submitVerificationVideo,
} from "./videoVerification.service.js";

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

const testUserIds: string[] = [];

async function createUser() {
  const [user] = await db
    .insert(users)
    .values({
      email: `videoverify-${randomUUID()}@example.com`,
      passwordHash: "test-hash-not-used",
      displayName: "Test user",
      ageConfirmed18: true,
      verificationStatus: "pending",
    })
    .returning();
  testUserIds.push(user.id);
  return user;
}

async function storageKeyFor(userId: string): Promise<string | null> {
  const row = await db.query.verificationSubmissions.findFirst({ where: eq(verificationSubmissions.userId, userId) });
  return row?.videoStorageKey ?? null;
}

afterAll(async () => {
  if (testUserIds.length > 0) {
    // reviewedBy has no ON DELETE CASCADE (unlike userId), so submissions
    // referencing a test user as reviewer must be cleared first.
    await db
      .delete(verificationSubmissions)
      .where(or(inArray(verificationSubmissions.userId, testUserIds), inArray(verificationSubmissions.reviewedBy, testUserIds)));
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
});

describe("submitVerificationVideo", () => {
  it("rejects a submission without explicit acknowledgement", async () => {
    const user = await createUser();
    await expect(submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", false)).rejects.toThrow(
      /acknowledge/,
    );
  });

  it("rejects an invalid upload (bad signature) and leaves no row behind", async () => {
    const user = await createUser();
    const notAVideo = Buffer.from("not a real video").toString("base64");
    await expect(submitVerificationVideo(user.id, notAVideo, "video/mp4", true)).rejects.toThrow(AuthError);
    expect(await getOwnLatestSubmission(user.id)).toBeNull();
  });

  it("accepts a valid submission and sets the user's status to pending", async () => {
    const user = await createUser();
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);
    expect(submission.status).toBe("pending_review");
    expect((submission as Record<string, unknown>).videoStorageKey).toBeUndefined();

    const refreshed = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(refreshed?.verificationStatus).toBe("pending");
  });

  it("rejects a second submission while one is already pending review", async () => {
    const user = await createUser();
    await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);
    await expect(submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true)).rejects.toThrow(
      /already have a submission/,
    );
  });

  it("allows only one submission to win a true concurrent duplicate race", async () => {
    const user = await createUser();
    const results = await Promise.allSettled([
      submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true),
      submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true),
    ]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);

    const rows = await db.query.verificationSubmissions.findMany({
      where: eq(verificationSubmissions.userId, user.id),
    });
    expect(rows.filter((r) => r.status === "pending_review").length).toBe(1);
  });
});

describe("recordReviewDecision", () => {
  it("rejects a decision without a rejection reason", async () => {
    const user = await createUser();
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);
    await expect(recordReviewDecision(submission.id, randomUUID(), "rejected")).rejects.toThrow(/reason/);
  });

  it("approves, deletes the video, and grants verified status", async () => {
    const user = await createUser();
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);
    const reviewer = await createUser();

    const result = await recordReviewDecision(submission.id, reviewer.id, "approved");
    expect(result).toEqual({ finalized: true, deletionPending: false });

    const refreshedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(refreshedUser?.verificationStatus).toBe("verified");

    const refreshedSubmission = await db.query.verificationSubmissions.findFirst({
      where: eq(verificationSubmissions.id, submission.id),
    });
    expect(refreshedSubmission?.status).toBe("approved");
    expect(refreshedSubmission?.videoStorageKey).toBeNull();
    expect(refreshedSubmission?.videoDeletedAt).not.toBeNull();
    expect(refreshedSubmission?.reviewedBy).toBe(reviewer.id);
  });

  it("rejects with a predefined reason, deletes the video, and keeps the user unverified", async () => {
    const user = await createUser();
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);
    const reviewer = await createUser();

    const result = await recordReviewDecision(submission.id, reviewer.id, "rejected", "does_not_meet_guidelines");
    expect(result).toEqual({ finalized: true, deletionPending: false });

    const refreshedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(refreshedUser?.verificationStatus).toBe("rejected");

    const refreshedSubmission = await db.query.verificationSubmissions.findFirst({
      where: eq(verificationSubmissions.id, submission.id),
    });
    expect(refreshedSubmission?.rejectionReason).toBe("does_not_meet_guidelines");
    expect(refreshedSubmission?.videoStorageKey).toBeNull();
  });

  it("refuses to review a submission twice", async () => {
    const user = await createUser();
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);
    const reviewer = await createUser();
    await recordReviewDecision(submission.id, reviewer.id, "approved");
    await expect(recordReviewDecision(submission.id, reviewer.id, "approved")).rejects.toThrow(/already been reviewed/);
  });

  it("withholds verified access when deletion fails, and verified access is only granted once a retry succeeds", async () => {
    const user = await createUser();
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);
    const reviewer = await createUser();

    const storageKey = await storageKeyFor(user.id);
    expect(storageKey).toBeTruthy();
    // Force a genuine deletion-confirmation failure at the R2 layer (not a
    // mock of videoVerification.service.ts itself — the mocked S3 client's
    // next HeadObjectCommand call throws, simulating an R2 auth/network
    // failure specifically during the post-delete existence check).
    forceNextFailure("HeadObjectCommand", new Error("simulated R2 outage confirming deletion"));

    const result = await recordReviewDecision(submission.id, reviewer.id, "approved");
    expect(result).toEqual({ finalized: false, deletionPending: true });

    const refreshedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    // Access must NOT be granted while deletion is unresolved.
    expect(refreshedUser?.verificationStatus).toBe("pending");

    const refreshedSubmission = await db.query.verificationSubmissions.findFirst({
      where: eq(verificationSubmissions.id, submission.id),
    });
    expect(refreshedSubmission?.videoDeletionPending).toBe(true);
    expect(refreshedSubmission?.pendingDecision).toBe("approved");
    // Still pending_review, not yet finalized as approved.
    expect(refreshedSubmission?.status).toBe("pending_review");

    // No further forced failure — retry must be the only way access is
    // subsequently granted.
    const retryResult = await retryPendingDeletion(submission.id);
    expect(retryResult).toEqual({ finalized: true, deletionPending: false });

    const finalUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(finalUser?.verificationStatus).toBe("verified");

    const finalSubmission = await db.query.verificationSubmissions.findFirst({
      where: eq(verificationSubmissions.id, submission.id),
    });
    expect(finalSubmission?.status).toBe("approved");
    expect(finalSubmission?.videoDeletionPending).toBe(false);
    expect(finalSubmission?.videoStorageKey).toBeNull();
  });

  it("retryPendingDeletion is a safe no-op for a submission that isn't pending deletion", async () => {
    const user = await createUser();
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);
    const reviewer = await createUser();
    await recordReviewDecision(submission.id, reviewer.id, "approved");

    const result = await retryPendingDeletion(submission.id);
    expect(result).toEqual({ finalized: true, deletionPending: false });
  });
});
