import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, verificationSubmissions, type VerificationSubmission } from "../db/schema.js";
import { AuthError } from "./auth.service.js";
import { saveVerificationVideo, readVerificationVideo, deleteVerificationVideo } from "./videoStorage.js";

export type VideoRejectionReason =
  | "video_unclear_or_incomplete"
  | "duration_or_format_invalid"
  | "does_not_meet_guidelines"
  | "other";

export type ReviewDecision = "approved" | "rejected" | "resubmission_required";

function toPublicSubmission(submission: VerificationSubmission) {
  // Never exposes videoStorageKey — that's an internal filesystem reference,
  // not something any client (including the admin UI, which streams the
  // video through its own authenticated endpoint instead) needs directly.
  const { videoStorageKey, ...publicSubmission } = submission;
  return publicSubmission;
}

/**
 * `userId` must already be the caller's own trusted session id (the route
 * layer is responsible for that — see verification.ts) — never trusted from
 * elsewhere in this module.
 */
export async function submitVerificationVideo(
  userId: string,
  videoBase64: string,
  mimeType: string,
  acknowledgedNotice: boolean,
) {
  if (!acknowledgedNotice) {
    throw new AuthError("You must acknowledge the verification and privacy notice before uploading.", 400);
  }

  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) {
    throw new AuthError("User not found.", 404);
  }

  // App-level pre-check for a friendly error message; the database's own
  // partial unique index (verification_submissions_one_pending_per_user) is
  // the real guard against a race between two near-simultaneous submit
  // requests creating two "pending_review" rows for the same user.
  const existingPending = await db.query.verificationSubmissions.findFirst({
    where: and(eq(verificationSubmissions.userId, userId), eq(verificationSubmissions.status, "pending_review")),
  });
  if (existingPending) {
    throw new AuthError("You already have a submission awaiting review.", 409);
  }

  // Saves to private disk storage and validates size/signature before any
  // database row is written — see videoStorage.ts for what is and isn't
  // checked (duration is client-side only).
  const storageKey = await saveVerificationVideo(videoBase64, mimeType);

  let submission: VerificationSubmission;
  try {
    [submission] = await db
      .insert(verificationSubmissions)
      .values({ userId, status: "pending_review", videoStorageKey: storageKey })
      .returning();
  } catch (err) {
    // The partial unique index rejected a concurrent duplicate submission —
    // clean up the file we just wrote rather than leaving an orphan.
    await deleteVerificationVideo(storageKey).catch(() => {});
    if ((err as { code?: string })?.code === "23505") {
      throw new AuthError("You already have a submission awaiting review.", 409);
    }
    throw err;
  }

  await db.update(users).set({ verificationStatus: "pending", updatedAt: new Date() }).where(eq(users.id, userId));

  return toPublicSubmission(submission);
}

export async function getOwnLatestSubmission(userId: string) {
  const submission = await db.query.verificationSubmissions.findFirst({
    where: eq(verificationSubmissions.userId, userId),
    orderBy: desc(verificationSubmissions.createdAt),
  });
  return submission ? toPublicSubmission(submission) : null;
}

// Admin-only — authorization is enforced by the route layer (assertAdmin),
// same trust model as reports.ts/adminUsers.ts.
export async function listSubmissions(status?: VerificationSubmission["status"]) {
  const rows = await db.query.verificationSubmissions.findMany({
    where: status ? eq(verificationSubmissions.status, status) : undefined,
    orderBy: desc(verificationSubmissions.createdAt),
  });
  return rows.map(toPublicSubmission);
}

export async function getSubmissionById(id: string) {
  const submission = await db.query.verificationSubmissions.findFirst({
    where: eq(verificationSubmissions.id, id),
  });
  if (!submission) {
    throw new AuthError("Submission not found.", 404);
  }
  return submission;
}

/** Admin-only — streams the raw video bytes for review. Never logged. */
export async function getSubmissionVideo(id: string): Promise<Buffer> {
  const submission = await getSubmissionById(id);
  if (!submission.videoStorageKey) {
    throw new AuthError("This video has already been deleted.", 404);
  }
  return readVerificationVideo(submission.videoStorageKey);
}

/**
 * Records a review decision and immediately attempts to delete the video.
 *
 * "approved" specifically withholds granting access (users.verificationStatus
 * is left unchanged) until deletion is confirmed — if deletion fails, the
 * decision is recorded as pending and the account stays restricted. "rejected"
 * and "resubmission_required" never grant access either way, so they finalize
 * immediately regardless of deletion outcome, while still tracking a pending
 * retry if needed — see retryPendingDeletion below. The whole operation is
 * one transaction so the submission row and the user's status always change
 * together or not at all.
 */
export async function recordReviewDecision(
  submissionId: string,
  reviewerId: string,
  decision: ReviewDecision,
  rejectionReason?: VideoRejectionReason,
): Promise<{ finalized: boolean; deletionPending: boolean }> {
  const submission = await getSubmissionById(submissionId);
  if (submission.status !== "pending_review") {
    throw new AuthError("This submission has already been reviewed.", 409);
  }
  if (decision !== "approved" && !rejectionReason) {
    throw new AuthError("A rejection reason is required.", 400);
  }

  const deletionOk = submission.videoStorageKey ? await deleteVerificationVideo(submission.videoStorageKey) : true;

  if (decision === "approved" && !deletionOk) {
    await db
      .update(verificationSubmissions)
      .set({ videoDeletionPending: true, pendingDecision: "approved", reviewedBy: reviewerId, reviewedAt: new Date() })
      .where(eq(verificationSubmissions.id, submissionId));
    // users.verificationStatus intentionally left untouched — stays
    // restricted until a retry confirms deletion.
    return { finalized: false, deletionPending: true };
  }

  await db.transaction(async (tx) => {
    await tx
      .update(verificationSubmissions)
      .set({
        status: decision,
        videoStorageKey: deletionOk ? null : submission.videoStorageKey,
        videoDeletedAt: deletionOk ? new Date() : null,
        videoDeletionPending: !deletionOk,
        pendingDecision: null,
        rejectionReason: decision === "approved" ? null : (rejectionReason ?? null),
        reviewedBy: reviewerId,
        reviewedAt: new Date(),
      })
      .where(eq(verificationSubmissions.id, submissionId));

    await tx
      .update(users)
      .set({ verificationStatus: decision === "approved" ? "verified" : decision, updatedAt: new Date() })
      .where(eq(users.id, submission.userId));
  });

  return { finalized: true, deletionPending: !deletionOk };
}

/**
 * Re-attempts a deletion that previously failed. Idempotent: calling this on
 * a submission that isn't actually pending is a safe no-op, so a retry can
 * always be called again without needing to check state first.
 */
export async function retryPendingDeletion(submissionId: string): Promise<{ finalized: boolean; deletionPending: boolean }> {
  const submission = await getSubmissionById(submissionId);
  if (!submission.videoDeletionPending) {
    return { finalized: true, deletionPending: false };
  }

  const deletionOk = submission.videoStorageKey ? await deleteVerificationVideo(submission.videoStorageKey) : true;
  if (!deletionOk) {
    return { finalized: false, deletionPending: true };
  }

  const finalStatus = submission.pendingDecision ?? submission.status;

  await db.transaction(async (tx) => {
    await tx
      .update(verificationSubmissions)
      .set({
        status: finalStatus,
        videoStorageKey: null,
        videoDeletedAt: new Date(),
        videoDeletionPending: false,
        pendingDecision: null,
      })
      .where(eq(verificationSubmissions.id, submissionId));

    if (finalStatus === "approved") {
      await tx
        .update(users)
        .set({ verificationStatus: "verified", updatedAt: new Date() })
        .where(eq(users.id, submission.userId));
    }
  });

  return { finalized: true, deletionPending: false };
}
