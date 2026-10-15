import { and, eq, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { blocks, matches, messages, reports, users, verificationSubmissions } from "../db/schema.js";
import { AuthError } from "./auth.service.js";
import { deleteVerificationVideo } from "./videoStorage.js";

const REDACTED_MESSAGE_CONTENT = "[message removed — sender deleted their account]";

/**
 * Self-service account deletion. Anonymizes the `users` row in place rather
 * than deleting it (see schema.ts's `account_status` "deleted" value) —
 * this is deliberate, not a simplification: the row must keep existing so
 * that `reports.reviewed_by` and `verification_submissions.reviewed_by`
 * (neither of which cascades) never face a foreign-key violation if this
 * account ever reviewed anything as an admin, and so that moderation
 * records referencing this account as reporter/reported stay valid.
 *
 * Ordering is deliberate and not accidental: any still-pending verification
 * video is deleted from R2 — and that deletion independently confirmed —
 * entirely BEFORE any database row is touched. R2 is an external system;
 * a Postgres transaction cannot roll back a deletion that already
 * succeeded there. If the R2 step fails, nothing in the database changes at
 * all, and the caller can safely retry. If the R2 step succeeds but the
 * database transaction that follows fails for an unrelated reason, the
 * account is left "active" with a submission row whose storage key no
 * longer resolves to anything — not a new failure mode: a missing video
 * already surfaces as a normal 404 at the existing admin video-view route.
 * A retry in that state calls deleteVerificationVideo() again on the same
 * (already-gone) key, which is idempotent and returns true, so the retry
 * proceeds cleanly with no special-casing required.
 */
export async function deleteAccount(userId: string): Promise<{ alreadyDeleted: boolean }> {
  const existing = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!existing) {
    throw new AuthError("User not found.", 404);
  }

  // Idempotent no-op: repeated or concurrent requests after the first one
  // has already completed must not re-run any of this, and must not error.
  if (existing.accountStatus === "deleted") {
    return { alreadyDeleted: true };
  }

  const submissionsWithVideo = await db.query.verificationSubmissions.findMany({
    where: eq(verificationSubmissions.userId, userId),
  });
  for (const submission of submissionsWithVideo) {
    if (!submission.videoStorageKey) continue;
    const deleted = await deleteVerificationVideo(submission.videoStorageKey);
    if (!deleted) {
      // Fail closed, before any database change — see file-level comment.
      throw new AuthError(
        "Could not delete your verification video right now. Please try again shortly.",
        503,
      );
    }
  }

  await db.transaction(async (tx) => {
    // Re-check under a row lock inside the transaction — if a concurrent
    // request already completed the deletion first, this is a safe no-op
    // rather than redoing (or conflicting with) that work.
    const [locked] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
    if (!locked || locked.accountStatus === "deleted") {
      return;
    }

    // Redact only this user's own authored messages. matchId/senderId/
    // createdAt are untouched, and the other participant's own messages in
    // the same match(es) are never touched at all — this is an UPDATE, not
    // a DELETE, specifically so the other participant's conversation
    // history is never destroyed.
    await tx
      .update(messages)
      .set({ content: REDACTED_MESSAGE_CONTENT })
      .where(eq(messages.senderId, userId));

    // End (don't delete) any match this user is still active in, so the
    // other participant's client correctly reflects the conversation is
    // over without losing the match record or its message history.
    await tx
      .update(matches)
      .set({ status: "ended", endedAt: new Date() })
      .where(
        and(or(eq(matches.userAId, userId), eq(matches.userBId, userId)), eq(matches.status, "active")),
      );

    // Blocks carry no audit value once this account is gone — removed in
    // both directions.
    await tx.delete(blocks).where(or(eq(blocks.blockerUserId, userId), eq(blocks.blockedUserId, userId)));

    // Reports are never row-deleted here. Reports with a real moderation
    // action (admin_action != 'none') are left completely untouched —
    // preserved for now, with retention period intentionally undecided
    // pending legal review (no period is invented here). Reports with no
    // action taken keep their structured fields (reason, status,
    // timestamps) but have their free-text description cleared, since it
    // carries no decision to audit and may contain personal narrative.
    await tx
      .update(reports)
      .set({ description: null })
      .where(
        and(
          or(eq(reports.reporterUserId, userId), eq(reports.reportedUserId, userId)),
          eq(reports.adminAction, "none"),
        ),
      );

    // Verification submissions and their decision metadata are fully
    // deleted — any video they referenced was already confirmed deleted
    // from R2 above, before this transaction opened.
    await tx.delete(verificationSubmissions).where(eq(verificationSubmissions.userId, userId));

    // Anonymize rather than delete the user row (see file-level comment).
    // The tombstone email embeds this user's own id, guaranteeing it can
    // never collide with another anonymized account, and freeing the
    // original email for reuse by a new signup.
    await tx
      .update(users)
      .set({
        email: `deleted-${userId}@deleted.invalid`,
        passwordHash: null,
        googleId: null,
        displayName: "Deleted user",
        accountStatus: "deleted",
        // No dedicated deletedAt column — accountStatus === "deleted" is the
        // sole source of truth everywhere this is checked (assertAccountActive,
        // the jwt callback, this function's own idempotency check), and
        // updatedAt (already an existing column, no migration required)
        // records when this anonymization happened.
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  });

  return { alreadyDeleted: false };
}
