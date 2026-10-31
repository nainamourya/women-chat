import { sql } from "drizzle-orm";
import { db, withDb, type DbEnv } from "./db";

// Stage A: liveness and readiness only. Mirrors apps/server/src/routes/health.ts
// (same paths and response shapes); Redis is not part of the Worker yet, so
// readiness reports Postgres only. No other route is migrated in this stage.
type Env = DbEnv;

const READINESS_TIMEOUT_MS = 2000;

async function pingDb(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      db.execute(sql`select 1`),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("Postgres ping timed out")), READINESS_TIMEOUT_MS);
      }),
    ]);
    return true;
  } catch (err) {
    // Log only the error type — never the message, which could carry a
    // connection string or host.
    console.error("Postgres health check failed:", err instanceof Error ? err.name : "unknown error");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    if (request.method === "GET" && pathname === "/api/health") {
      return Response.json({ status: "ok" });
    }

    if (request.method === "GET" && pathname === "/api/health/ready") {
      return withDb(env, async () => {
        const dbOk = await pingDb();
        return Response.json(
          { status: dbOk ? "ok" : "error", dependencies: { postgres: dbOk ? "ok" : "error" } },
          { status: dbOk ? 200 : 503 },
        );
      });
    }

    return Response.json({ error: "Not found." }, { status: 404 });
  },
};
