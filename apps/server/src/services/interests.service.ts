import { asc, eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { interests, userInterests } from "../db/schema.js";
import { AuthError } from "./auth.service.js";

export async function listInterests() {
  return db.query.interests.findMany({ orderBy: asc(interests.name) });
}

export async function getUserInterests(userId: string) {
  const rows = await db
    .select({ id: interests.id, name: interests.name })
    .from(userInterests)
    .innerJoin(interests, eq(userInterests.interestId, interests.id))
    .where(eq(userInterests.userId, userId))
    .orderBy(asc(interests.name));

  return rows;
}

export async function setUserInterests(userId: string, interestIds: string[]) {
  const uniqueIds = [...new Set(interestIds)];

  if (uniqueIds.length > 0) {
    const valid = await db
      .select({ id: interests.id })
      .from(interests)
      .where(inArray(interests.id, uniqueIds));

    if (valid.length !== uniqueIds.length) {
      throw new AuthError("One or more interests are invalid.", 400);
    }
  }

  await db.transaction(async (tx) => {
    await tx.delete(userInterests).where(eq(userInterests.userId, userId));
    if (uniqueIds.length > 0) {
      await tx.insert(userInterests).values(uniqueIds.map((interestId) => ({ userId, interestId })));
    }
  });

  return getUserInterests(userId);
}
