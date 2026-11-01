import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../server/src/db/schema";
import { guardedTestDatabaseUrl } from "./localWorker";

// Seeds rows into the guard-validated LOCAL test database only, using unique
// markers, and removes exactly those rows afterwards (cascades handle the
// profile/interest join rows).
export type Seed = {
  adminId: string;
  memberId: string;
  targetId: string;
  memberEmail: string;
  interestIds: string[];
  cleanup: () => Promise<void>;
};

export async function seedRows(): Promise<Seed> {
  const client = postgres(guardedTestDatabaseUrl(), { max: 1 });
  const db = drizzle(client, { schema });
  const tag = randomUUID().slice(0, 8);

  const [admin, member, target] = await db
    .insert(schema.users)
    .values([
      { email: `edge-admin-${tag}@example.test`, displayName: `Edge Admin ${tag}`, role: "admin", ageConfirmed18: true },
      { email: `edge-member-${tag}@example.test`, displayName: `Edge Member ${tag}`, ageConfirmed18: true },
      { email: `edge-target-${tag}@example.test`, displayName: `Edge Target ${tag}`, ageConfirmed18: true },
    ])
    .returning();

  const interestRows = await db
    .insert(schema.interests)
    .values([{ name: `edge-test-a-${tag}` }, { name: `edge-test-b-${tag}` }])
    .returning();

  return {
    adminId: admin.id,
    memberId: member.id,
    targetId: target.id,
    memberEmail: member.email,
    interestIds: interestRows.map((row) => row.id),
    cleanup: async () => {
      await db.delete(schema.users).where(inArray(schema.users.id, [admin.id, member.id, target.id]));
      await db.delete(schema.interests).where(inArray(schema.interests.id, interestRows.map((row) => row.id)));
      await client.end({ timeout: 2 });
    },
  };
}

export async function readUser(id: string) {
  const client = postgres(guardedTestDatabaseUrl(), { max: 1 });
  try {
    const db = drizzle(client, { schema });
    return await db.query.users.findFirst({ where: (u, { eq }) => eq(u.id, id) });
  } finally {
    await client.end({ timeout: 2 });
  }
}

// ---- Real-time fixtures: verified members, matches, and their cleanup ----------

import type { InferInsertModel } from "drizzle-orm";

export class Fixtures {
  private client = postgres(guardedTestDatabaseUrl(), { max: 1 });
  private db = drizzle(this.client, { schema });
  private userIds: string[] = [];
  private tag = randomUUID().slice(0, 8);
  private n = 0;

  /** A member who is allowed to use chat and calls, unless overridden. */
  async member(overrides: Partial<InferInsertModel<typeof schema.users>> = {}) {
    const i = ++this.n;
    const [row] = await this.db
      .insert(schema.users)
      .values({
        email: `edge-rt-${this.tag}-${i}@example.test`,
        displayName: `Edge RT ${i}`,
        ageConfirmed18: true,
        verificationStatus: "verified",
        ...overrides,
      })
      .returning();
    this.userIds.push(row.id);
    return row;
  }

  async match(userAId: string, userBId: string, status: "active" | "ended" = "active") {
    const [row] = await this.db
      .insert(schema.matches)
      .values({ userAId, userBId, status, endedAt: status === "ended" ? new Date() : null })
      .returning();
    return row;
  }

  async messageCount(matchId: string): Promise<number> {
    const rows = await this.db.select().from(schema.messages).where(eq(schema.messages.matchId, matchId));
    return rows.length;
  }

  async setStatus(userId: string, accountStatus: "active" | "banned" | "suspended") {
    await this.db.update(schema.users).set({ accountStatus }).where(eq(schema.users.id, userId));
  }

  async cleanup() {
    if (this.userIds.length > 0) await this.db.delete(schema.users).where(inArray(schema.users.id, this.userIds));
    await this.client.end({ timeout: 2 });
  }
}
