import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../db/client.js";
import { users, type User } from "../db/schema.js";

const SALT_ROUNDS = 12;

export class AuthError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export function toPublicUser(user: User) {
  const { passwordHash, verificationRef, googleId, ...publicUser } = user;
  return publicUser;
}

// A suspension with a past `suspendedUntil` is treated as expired/active
// again everywhere account status is checked, without a background job —
// the next read that touches this user self-heals the status.
function isCurrentlySuspended(user: Pick<User, "accountStatus" | "suspendedUntil">): boolean {
  if (user.accountStatus !== "suspended") return false;
  if (!user.suspendedUntil) return true;
  return user.suspendedUntil.getTime() > Date.now();
}

export function assertAccountActive(user: Pick<User, "accountStatus" | "suspendedUntil">): void {
  if (user.accountStatus === "banned") {
    throw new AuthError("This account has been permanently banned.", 403);
  }
  if (isCurrentlySuspended(user)) {
    const until = user.suspendedUntil
      ? ` until ${user.suspendedUntil.toISOString().slice(0, 10)}`
      : "";
    throw new AuthError(`This account is suspended${until}.`, 403);
  }
}

// Admin-gated endpoints always pass the acting user's *own* session id
// (the same trust model as every other internal route — see
// middleware/internalAuth.ts), then verify that user's role from the
// database here rather than trusting a role flag supplied in the request.
export async function assertAdmin(actingUserId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, actingUserId) });
  if (!user || user.role !== "admin") {
    throw new AuthError("Admin access required.", 403);
  }
  return user;
}

export async function registerUser(input: {
  email: string;
  password: string;
  displayName: string;
  ageConfirmed18: boolean;
}) {
  if (!input.ageConfirmed18) {
    throw new AuthError("You must confirm you are 18 or older to sign up.", 400);
  }

  const existing = await db.query.users.findFirst({
    where: eq(users.email, input.email.toLowerCase()),
  });
  if (existing) {
    throw new AuthError("An account with this email already exists.", 409);
  }

  const passwordHash = await bcrypt.hash(input.password, SALT_ROUNDS);

  const [user] = await db
    .insert(users)
    .values({
      email: input.email.toLowerCase(),
      passwordHash,
      displayName: input.displayName,
      ageConfirmed18: input.ageConfirmed18,
      // MVP default: no verification has occurred yet. Only the prototype
      // stub flow (see verification.service.ts) can advance this later.
      verificationStatus: "unverified",
    })
    .returning();

  return toPublicUser(user);
}

export async function verifyCredentials(email: string, password: string) {
  const user = await db.query.users.findFirst({
    where: eq(users.email, email.toLowerCase()),
  });
  // Accounts created via Google sign-in have no password set — reject them
  // the same way as a wrong password rather than letting bcrypt.compare throw.
  if (!user || !user.passwordHash) {
    throw new AuthError("Invalid email or password.", 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AuthError("Invalid email or password.", 401);
  }

  assertAccountActive(user);

  return toPublicUser(user);
}

/**
 * Finds an existing user by email to link a Google account to, or creates a
 * new one. Never stores a password or any Google token — only the OIDC
 * `sub` (as `googleId`) so a repeat Google sign-in is recognized. A Google
 * account created/linked this way starts as `unverified` and with
 * `ageConfirmed18: false`, exactly like a brand-new credentials signup —
 * Google sign-in itself confers no eligibility/age verification.
 */
export async function findOrCreateGoogleUser(input: {
  email: string;
  googleId: string;
  displayName: string;
}) {
  const email = input.email.toLowerCase();
  const existing = await db.query.users.findFirst({ where: eq(users.email, email) });

  if (existing) {
    assertAccountActive(existing);
    if (existing.googleId === input.googleId) {
      return toPublicUser(existing);
    }
    const [linked] = await db
      .update(users)
      .set({ googleId: input.googleId, updatedAt: new Date() })
      .where(eq(users.id, existing.id))
      .returning();
    return toPublicUser(linked);
  }

  const [created] = await db
    .insert(users)
    .values({
      email,
      passwordHash: null,
      displayName: input.displayName || "New user",
      googleId: input.googleId,
      ageConfirmed18: false,
      verificationStatus: "unverified",
    })
    .returning();

  return toPublicUser(created);
}

/**
 * Self-attestation checkbox equivalent for accounts that never went through
 * the signup form (e.g. Google sign-in). Only ever flips `false` -> `true`
 * for the session's own user id; never used as, or combined with, real age
 * or identity verification.
 */
export async function confirmAge18(userId: string) {
  const [updated] = await db
    .update(users)
    .set({ ageConfirmed18: true, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();

  if (!updated) {
    throw new AuthError("User not found.", 404);
  }

  return toPublicUser(updated);
}
