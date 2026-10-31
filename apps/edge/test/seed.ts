import { randomUUID } from "node:crypto";
import { inArray } from "drizzle-orm";
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
