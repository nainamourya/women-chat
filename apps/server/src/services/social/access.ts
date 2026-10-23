import { and, eq, isNotNull, sql, type AnyColumn, type SQL } from "drizzle-orm";
import { db } from "../../db/client.js";
import { blocks, users, type User } from "../../db/schema.js";
import { AuthError, assertEligible } from "../auth.service.js";

// A structured error the web app can react to (for example, send someone who
// has not chosen a username to the profile setup screen).
export class SocialError extends AuthError {
  constructor(
    message: string,
    status: number,
    public readonly code?: "not_eligible" | "username_required" | "not_found" | "blocked" | "not_mutual",
  ) {
    super(message, status);
  }
}

export function notFound(what = "Not found."): SocialError {
  return new SocialError(what, 404, "not_found");
}

export type Viewer = User & { username: string | null };

// The acting member. `viewerId` is never client input: the Next.js server
// derives it from the signed-in session and sends it over the internal-secret
// channel (see routes/social.ts), and it is re-checked here against the
// database on every request, so a suspended, banned, deleted or unverified
// account loses access immediately.
export async function loadViewer(viewerId: string, { needsUsername = true } = {}): Promise<Viewer> {
  const user = await db.query.users.findFirst({ where: eq(users.id, viewerId) });
  if (!user) throw new SocialError("Account not found.", 401);

  try {
    // Same rule as matchmaking: active account, 18+ confirmed, eligibility verified.
    assertEligible(user);
  } catch (err) {
    if (err instanceof AuthError) throw new SocialError(err.message, err.status, "not_eligible");
    throw err;
  }

  if (needsUsername && !user.username) {
    throw new SocialError("Choose a username to use this feature.", 403, "username_required");
  }
  return user;
}

// A member other people may see and interact with: active, verified, 18+
// confirmed, and has chosen a username. Anyone else (unverified, suspended,
// banned, deleted) simply does not exist as far as the social features go.
export const visibleMember: SQL = and(
  eq(users.accountStatus, "active"),
  eq(users.verificationStatus, "verified"),
  eq(users.ageConfirmed18, true),
  isNotNull(users.username),
)!;

// True when neither party has blocked the other. `other` is the column (or
// expression) holding the other member's id, e.g. posts.authorId.
export function notBlockedWith(viewerId: string, other: AnyColumn | SQL): SQL {
  return sql`not exists (
    select 1 from ${blocks} b
    where (b.blocker_user_id = ${viewerId} and b.blocked_user_id = ${other})
       or (b.blocker_user_id = ${other} and b.blocked_user_id = ${viewerId})
  )`;
}

export async function isBlockedEitherWay(a: string, b: string): Promise<boolean> {
  const [row] = await db
    .select({ id: blocks.id })
    .from(blocks)
    .where(
      sql`(${blocks.blockerUserId} = ${a} and ${blocks.blockedUserId} = ${b}) or (${blocks.blockerUserId} = ${b} and ${blocks.blockedUserId} = ${a})`,
    )
    .limit(1);
  return Boolean(row);
}

// Resolves a username to a member the viewer is allowed to see; anything
// else (missing, ineligible, blocked in either direction) is the same 404 so
// the response cannot be used to probe who exists or who blocked whom.
export async function findVisibleMemberByUsername(viewerId: string, username: string): Promise<User> {
  const [row] = await db
    .select()
    .from(users)
    .where(and(eq(users.username, username.toLowerCase()), visibleMember, notBlockedWith(viewerId, users.id)))
    .limit(1);
  if (!row) throw notFound("That member wasn't found.");
  return row;
}

// Relative URL of a member's profile photo, served by the authenticated media
// route. The key's file name is unique per upload, so it doubles as a cache
// buster. Null when there is no photo.
export function avatarUrl(user: Pick<User, "username" | "avatarKey">): string | null {
  if (!user.avatarKey || !user.username) return null;
  const version = user.avatarKey.split("/").pop()?.split(".")[0] ?? "";
  return `/api/social/media/avatars/${encodeURIComponent(user.username)}?v=${version}`;
}

export function postImageUrl(postId: string): string {
  return `/api/social/media/posts/${postId}`;
}

export type UserCard = {
  username: string;
  displayName: string;
  avatarUrl: string | null;
};

export function toUserCard(user: Pick<User, "username" | "displayName" | "avatarKey">): UserCard {
  return { username: user.username ?? "", displayName: user.displayName, avatarUrl: avatarUrl(user) };
}
