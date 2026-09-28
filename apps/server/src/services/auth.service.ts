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
  const { passwordHash, verificationRef, ...publicUser } = user;
  return publicUser;
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
  if (!user) {
    throw new AuthError("Invalid email or password.", 401);
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    throw new AuthError("Invalid email or password.", 401);
  }

  if (user.isBanned) {
    throw new AuthError("This account has been suspended.", 403);
  }

  return toPublicUser(user);
}
