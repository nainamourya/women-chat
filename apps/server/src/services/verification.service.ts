import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { AuthError, toPublicUser } from "./auth.service.js";

/**
 * PROTOTYPE / TEST-ONLY eligibility flow.
 *
 * This does not perform any real identity, age, or gender verification.
 * It exists only so the rest of the product (matching, chat, admin) can be
 * built and tested against a `verificationStatus` field. It must never be
 * presented to end users as real verification, and it stores no ID/selfie
 * data — only a status + a method label recording that the stub was used.
 *
 * Replace this module's internals with a real vendor webhook handler later;
 * the `users.verificationStatus` / `verificationMethod` / `verificationRef`
 * columns are already shaped for that.
 */
export async function simulatePrototypeVerification(userId: string) {
  const [updated] = await db
    .update(users)
    .set({
      verificationStatus: "verified",
      verificationMethod: "manual_stub",
      updatedAt: new Date(),
    })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) {
    throw new AuthError("User not found.", 404);
  }

  return toPublicUser(updated);
}
