import path from "node:path";
import { config as loadDotenv } from "dotenv";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { assertSafeTestTargets } from "../config/testTargetGuard.js";

// Applies the schema to the dedicated TEST database only. This is deliberately
// separate from `npm run db:migrate` (db/migrate.ts), which targets whatever
// DATABASE_URL the application is configured with and is the only command meant
// for a real database. This one never reads the application's `.env` or
// DATABASE_URL: it takes TEST_DATABASE_URL from `.env.test` or the shell and
// refuses to connect unless that URL is a local, test-named database.
loadDotenv({ path: path.resolve(import.meta.dirname, "../../.env.test"), quiet: true });

async function main() {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  // Both targets are validated (not just the database) so a half-configured
  // test setup is reported here rather than later, mid-test-run.
  assertSafeTestTargets({
    databaseUrl,
    redisUrl: process.env.TEST_REDIS_URL,
    optIn: process.env.ALLOW_TEST_DB_WRITES,
  });

  const client = postgres(databaseUrl!, { max: 1 });
  try {
    console.log("Applying migrations to the test database…");
    await migrate(drizzle(client), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
    console.log("Test database migrations complete.");
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err: unknown) => {
  // The guard's messages never contain connection strings; other errors are
  // reduced to their message for the same reason.
  console.error("Test database migration failed:", err instanceof Error ? err.message : "unknown error");
  process.exit(1);
});
