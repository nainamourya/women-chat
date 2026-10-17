import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, closeDb } from "../db/client.js";
import { users, matches, messages, blocks, reports, verificationSubmissions } from "../db/schema.js";
import { fakeMp4Base64 } from "../testUtils/fakeVideo.js";

// Mocks the R2 (S3-compatible) client — see videoStorage.test.ts for why
// this needs to be a self-contained vi.hoisted block in every file that
// needs it (a vitest hoisting constraint, not a design choice).
const { mockSend, resetMockR2, forceNextFailure } = vi.hoisted(() => {
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
    resetMockR2: () => {
      store.clear();
      forced = null;
    },
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

const { deleteAccount } = await import("./accountDeletion.service.js");
const { submitVerificationVideo, recordReviewDecision } = await import("./videoVerification.service.js");
const { createReport, updateReportDecision } = await import("./reports.service.js");
const { sendMessage } = await import("./chat.service.js");

const testUserIds: string[] = [];

async function createUser(role: "user" | "admin" = "user") {
  const [user] = await db
    .insert(users)
    .values({
      email: `acctdel-${randomUUID()}@example.com`,
      passwordHash: "test-hash-not-used",
      displayName: "Test user",
      ageConfirmed18: true,
      verificationStatus: "verified",
      role,
    })
    .returning();
  testUserIds.push(user.id);
  return user;
}

async function createActiveMatch(userAId: string, userBId: string) {
  const [match] = await db.insert(matches).values({ userAId, userBId, status: "active" }).returning();
  return match;
}

beforeEach(() => {
  resetMockR2();
});

afterAll(async () => {
  if (testUserIds.length > 0) {
    await db
      .delete(verificationSubmissions)
      .where(or(inArray(verificationSubmissions.userId, testUserIds), inArray(verificationSubmissions.reviewedBy, testUserIds)));
    await db.delete(reports).where(or(inArray(reports.reporterUserId, testUserIds), inArray(reports.reportedUserId, testUserIds)));
    await db.delete(messages).where(inArray(messages.senderId, testUserIds));
    await db.delete(matches).where(or(inArray(matches.userAId, testUserIds), inArray(matches.userBId, testUserIds)));
    await db.delete(blocks).where(or(inArray(blocks.blockerUserId, testUserIds), inArray(blocks.blockedUserId, testUserIds)));
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
  await closeDb();
});

describe("deleteAccount", () => {
  it("anonymizes only the target account, leaving other users untouched", async () => {
    const target = await createUser();
    const other = await createUser();

    await deleteAccount(target.id);

    const deletedUser = await db.query.users.findFirst({ where: eq(users.id, target.id) });
    expect(deletedUser?.accountStatus).toBe("deleted");
    expect(deletedUser?.passwordHash).toBeNull();
    expect(deletedUser?.googleId).toBeNull();
    expect(deletedUser?.email).toBe(`deleted-${target.id}@deleted.invalid`);

    const untouchedOther = await db.query.users.findFirst({ where: eq(users.id, other.id) });
    expect(untouchedOther?.accountStatus).toBe("active");
  });

  it("redacts the deleting user's messages while leaving the other participant's messages unchanged", async () => {
    const a = await createUser();
    const b = await createUser();
    const match = await createActiveMatch(a.id, b.id);

    const fromA = await sendMessage(a.id, match.id, "hello from A");
    const fromB = await sendMessage(b.id, match.id, "hello from B");

    await deleteAccount(a.id);

    const refreshedFromA = await db.query.messages.findFirst({ where: eq(messages.id, fromA.id) });
    const refreshedFromB = await db.query.messages.findFirst({ where: eq(messages.id, fromB.id) });

    expect(refreshedFromA?.content).toBe("[message removed — sender deleted their account]");
    expect(refreshedFromB?.content).toBe("hello from B");
  });

  it("preserves match/conversation history for the other participant and ends the active match", async () => {
    const a = await createUser();
    const b = await createUser();
    const match = await createActiveMatch(a.id, b.id);
    await sendMessage(a.id, match.id, "hi");
    await sendMessage(b.id, match.id, "hi back");

    await deleteAccount(a.id);

    const refreshedMatch = await db.query.matches.findFirst({ where: eq(matches.id, match.id) });
    expect(refreshedMatch).not.toBeNull();
    expect(refreshedMatch?.status).toBe("ended");
    expect(refreshedMatch?.endedAt).not.toBeNull();

    const remainingMessages = await db.query.messages.findMany({ where: eq(messages.matchId, match.id) });
    expect(remainingMessages.length).toBe(2);
  });

  it("removes blocks associated with the deleting user in both directions", async () => {
    const a = await createUser();
    const b = await createUser();
    const c = await createUser();
    await db.insert(blocks).values({ blockerUserId: a.id, blockedUserId: b.id });
    await db.insert(blocks).values({ blockerUserId: c.id, blockedUserId: a.id });
    await db.insert(blocks).values({ blockerUserId: b.id, blockedUserId: c.id });

    await deleteAccount(a.id);

    const remaining = await db.query.blocks.findMany({
      where: or(eq(blocks.blockerUserId, a.id), eq(blocks.blockedUserId, a.id)),
    });
    expect(remaining.length).toBe(0);

    const unrelated = await db.query.blocks.findFirst({
      where: and(eq(blocks.blockerUserId, b.id), eq(blocks.blockedUserId, c.id)),
    });
    expect(unrelated).not.toBeNull();
  });

  it("preserves an actioned report untouched, including its description", async () => {
    const reporter = await createUser();
    const reported = await createUser();
    const admin = await createUser("admin");
    const report = await createReport({
      reporterUserId: reporter.id,
      reportedUserId: reported.id,
      reason: "harassment",
      description: "detailed account of what happened",
    });
    await updateReportDecision(report.id, { status: "resolved", adminAction: "warn", reviewedBy: admin.id });

    await deleteAccount(reporter.id);

    const refreshed = await db.query.reports.findFirst({ where: eq(reports.id, report.id) });
    expect(refreshed?.description).toBe("detailed account of what happened");
    expect(refreshed?.adminAction).toBe("warn");
    expect(refreshed?.reporterUserId).toBe(reporter.id);
  });

  it("clears the description of an unactioned report but keeps its structured fields", async () => {
    const reporter = await createUser();
    const reported = await createUser();
    const report = await createReport({
      reporterUserId: reporter.id,
      reportedUserId: reported.id,
      reason: "spam_scam",
      description: "some narrative that should be cleared",
    });

    await deleteAccount(reporter.id);

    const refreshed = await db.query.reports.findFirst({ where: eq(reports.id, report.id) });
    expect(refreshed?.description).toBeNull();
    expect(refreshed?.reason).toBe("spam_scam");
    expect(refreshed?.status).toBe("pending");
    expect(refreshed?.adminAction).toBe("none");
    expect(refreshed?.createdAt).not.toBeNull();
  });

  it("deletes verification submissions and their decision metadata", async () => {
    const user = await createUser();
    const reviewer = await createUser("admin");
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);
    await recordReviewDecision(submission.id, reviewer.id, "approved");

    await deleteAccount(user.id);

    const remaining = await db.query.verificationSubmissions.findFirst({
      where: eq(verificationSubmissions.id, submission.id),
    });
    expect(remaining).toBeUndefined();
  });

  it("deletes a pending verification video from R2 before committing any database change", async () => {
    const user = await createUser();
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);

    await deleteAccount(user.id);

    const remaining = await db.query.verificationSubmissions.findFirst({
      where: eq(verificationSubmissions.id, submission.id),
    });
    expect(remaining).toBeUndefined();
    const refreshedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(refreshedUser?.accountStatus).toBe("deleted");
  });

  it("aborts with no database changes at all when R2 deletion fails", async () => {
    const user = await createUser();
    await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);

    forceNextFailure("DeleteObjectCommand", new Error("simulated R2 outage"));

    await expect(deleteAccount(user.id)).rejects.toThrow(/verification video/);

    const refreshedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(refreshedUser?.accountStatus).toBe("active");
    const submissions = await db.query.verificationSubmissions.findMany({
      where: eq(verificationSubmissions.userId, user.id),
    });
    expect(submissions.length).toBe(1);
  });

  it("completes safely on retry when R2 deletion already succeeded but the database step did not run", async () => {
    const user = await createUser();
    const submission = await submitVerificationVideo(user.id, fakeMp4Base64(), "video/mp4", true);

    // Simulate "R2 succeeded, database transaction did not commit" by
    // performing the R2 deletion directly, bypassing deleteAccount, leaving
    // the database exactly as it would be after that partial failure.
    const row = await db.query.verificationSubmissions.findFirst({
      where: eq(verificationSubmissions.id, submission.id),
    });
    const storageKey = row?.videoStorageKey as string;
    const { deleteVerificationVideo } = await import("./videoStorage.js");
    expect(await deleteVerificationVideo(storageKey)).toBe(true);

    // The submission row still references the now-already-deleted key —
    // this is the exact state a crash between the R2 step and the
    // transaction would leave behind.
    const stillThere = await db.query.verificationSubmissions.findFirst({
      where: eq(verificationSubmissions.id, submission.id),
    });
    expect(stillThere).not.toBeUndefined();

    // Retry: deleteAccount must complete successfully — deleteVerificationVideo
    // is idempotent, so calling it again on an already-gone key returns true.
    await deleteAccount(user.id);

    const refreshedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(refreshedUser?.accountStatus).toBe("deleted");
    const remaining = await db.query.verificationSubmissions.findFirst({
      where: eq(verificationSubmissions.id, submission.id),
    });
    expect(remaining).toBeUndefined();
  });

  it("is idempotent for repeated sequential deletion requests", async () => {
    const user = await createUser();

    const first = await deleteAccount(user.id);
    expect(first).toEqual({ alreadyDeleted: false });

    const second = await deleteAccount(user.id);
    expect(second).toEqual({ alreadyDeleted: true });

    const refreshedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(refreshedUser?.accountStatus).toBe("deleted");
  });

  it("is safe for concurrent deletion requests", async () => {
    const user = await createUser();

    const results = await Promise.allSettled([deleteAccount(user.id), deleteAccount(user.id)]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);

    const refreshedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(refreshedUser?.accountStatus).toBe("deleted");
  });

  it("preserves reviewer foreign-key integrity when the reviewer's own account is deleted", async () => {
    const applicant = await createUser();
    const admin = await createUser("admin");
    const submission = await submitVerificationVideo(applicant.id, fakeMp4Base64(), "video/mp4", true);
    await recordReviewDecision(submission.id, admin.id, "approved");

    const reporter = await createUser();
    const reported = await createUser();
    const report = await createReport({
      reporterUserId: reporter.id,
      reportedUserId: reported.id,
      reason: "other",
    });
    await updateReportDecision(report.id, { status: "resolved", adminAction: "warn", reviewedBy: admin.id });

    // The admin deletes their own account — must not throw a foreign-key
    // violation, since reviewed_by has no ON DELETE CASCADE and this
    // design never hard-deletes the users row in the first place.
    await expect(deleteAccount(admin.id)).resolves.toEqual({ alreadyDeleted: false });

    const refreshedReport = await db.query.reports.findFirst({ where: eq(reports.id, report.id) });
    expect(refreshedReport?.reviewedBy).toBe(admin.id);

    const adminUser = await db.query.users.findFirst({ where: eq(users.id, admin.id) });
    expect(adminUser?.accountStatus).toBe("deleted");
  });

  it("frees the original email for reuse, and the anonymized account can no longer log in with the old credentials", async () => {
    const user = await createUser();
    const originalEmail = user.email;

    await deleteAccount(user.id);

    const deletedUser = await db.query.users.findFirst({ where: eq(users.id, user.id) });
    expect(deletedUser?.email).not.toBe(originalEmail);
    expect(deletedUser?.passwordHash).toBeNull();

    // The original email is now free — a new signup with the same email
    // must not collide with the anonymized row.
    const [reregistered] = await db
      .insert(users)
      .values({
        email: originalEmail,
        passwordHash: "a-new-hash",
        displayName: "New account",
        ageConfirmed18: true,
      })
      .returning();
    testUserIds.push(reregistered.id);
    expect(reregistered.email).toBe(originalEmail);

    // No row can still be found by the original email pointing at the
    // deleted account — the only row with that email is the new one.
    const matchingOriginalEmail = await db.query.users.findMany({ where: eq(users.email, originalEmail) });
    expect(matchingOriginalEmail.length).toBe(1);
    expect(matchingOriginalEmail[0].id).toBe(reregistered.id);
  });
});
