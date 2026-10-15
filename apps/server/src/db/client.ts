import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { env } from "../config/env.js";

type PostgresClient = ReturnType<typeof postgres>;

const queryClient = postgres(env.DATABASE_URL);

export const db = drizzle(queryClient, { schema });

// `client` is injectable (defaults to the shared singleton above) purely so
// this is unit-testable against a deliberately-unreachable instance without
// touching the real connection — see client.test.ts.
export async function pingDb(client: PostgresClient = queryClient, timeoutMs = 2000): Promise<boolean> {
  try {
    await Promise.race([
      client`select 1`,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Postgres ping timed out")), timeoutMs)),
    ]);
    return true;
  } catch (err) {
    console.error("Postgres health check failed:", err);
    return false;
  }
}

// Graceful close: waits up to `timeoutSeconds` for in-flight queries to
// finish before closing, rather than cutting connections immediately.
export async function closeDb(client: PostgresClient = queryClient, timeoutSeconds = 5): Promise<void> {
  await client.end({ timeout: timeoutSeconds });
}
