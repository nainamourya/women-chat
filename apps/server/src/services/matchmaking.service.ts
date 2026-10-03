import { and, eq, or } from "drizzle-orm";
import { db } from "../db/client.js";
import { matches, users } from "../db/schema.js";
import { AuthError } from "./auth.service.js";
import { isWaiting, joinQueue, leaveQueue, refreshWaiting } from "../redis/matchmakingQueue.js";
import { emitToUser } from "../socket/index.js";

async function assertEligible(userId: string) {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) {
    throw new AuthError("User not found.", 404);
  }
  if (user.isBanned) {
    throw new AuthError("This account has been suspended.", 403);
  }
  if (!user.ageConfirmed18) {
    throw new AuthError("Age confirmation is required before matchmaking.", 403);
  }
  if (user.verificationStatus !== "verified") {
    throw new AuthError("Eligibility verification is required before matchmaking.", 403);
  }
}

// The durable record in Postgres — not the Redis queue — is the source of
// truth for "is this user already in an active match", since Redis keys can
// expire/be lost while a match itself stays active indefinitely.
async function findActiveMatch(userId: string) {
  return db.query.matches.findFirst({
    where: and(
      eq(matches.status, "active"),
      or(eq(matches.userAId, userId), eq(matches.userBId, userId)),
    ),
  });
}

function otherUserId(match: { userAId: string; userBId: string }, userId: string) {
  return match.userAId === userId ? match.userBId : match.userAId;
}

export type MatchmakingStatus =
  | { state: "idle" }
  | { state: "waiting" }
  | { state: "matched"; matchId: string; otherUserId: string };

export async function joinMatchmaking(userId: string): Promise<MatchmakingStatus> {
  await assertEligible(userId);

  const existingMatch = await findActiveMatch(userId);
  if (existingMatch) {
    return { state: "matched", matchId: existingMatch.id, otherUserId: otherUserId(existingMatch, userId) };
  }

  const result = await joinQueue(userId);

  if (result.state === "already_waiting") {
    return { state: "waiting" };
  }

  if (result.state === "waiting") {
    emitToUser(userId, "matchmaking:started", {});
    emitToUser(userId, "matchmaking:waiting", {});
    return { state: "waiting" };
  }

  // result.state === "matched" — this user and `candidateId` were atomically
  // claimed together by the Redis queue; persist it as the durable record.
  const candidateId = result.candidateId;
  const [match] = await db
    .insert(matches)
    .values({ userAId: candidateId, userBId: userId, status: "active" })
    .returning();

  emitToUser(userId, "matchmaking:started", {});
  emitToUser(userId, "matchmaking:match_found", { matchId: match.id, otherUserId: candidateId });
  emitToUser(candidateId, "matchmaking:match_found", { matchId: match.id, otherUserId: userId });

  return { state: "matched", matchId: match.id, otherUserId: candidateId };
}

export async function leaveMatchmaking(userId: string): Promise<MatchmakingStatus> {
  const existingMatch = await findActiveMatch(userId);
  if (existingMatch) {
    throw new AuthError("Cannot leave matchmaking: already in an active match.", 409);
  }

  await leaveQueue(userId);
  emitToUser(userId, "matchmaking:cancelled", {});
  return { state: "idle" };
}

export async function getMatchmakingStatus(userId: string): Promise<MatchmakingStatus> {
  const existingMatch = await findActiveMatch(userId);
  if (existingMatch) {
    return { state: "matched", matchId: existingMatch.id, otherUserId: otherUserId(existingMatch, userId) };
  }

  if (await isWaiting(userId)) {
    await refreshWaiting(userId);
    return { state: "waiting" };
  }

  return { state: "idle" };
}
