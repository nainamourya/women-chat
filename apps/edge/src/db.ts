import { AsyncLocalStorage } from "node:async_hooks";
import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
// The same schema the Express server uses, so the server's services (which use
// the relational `db.query.*` API) behave identically when reused here.
import * as schema from "../../server/src/db/schema";

// Workers cannot share a database client across requests: a module-level
// client keeps I/O objects bound to the request that created it, and a later
// request fails ("Failed query" — seen in the local spike). So each request
// gets its own client, created by `withDb`, and `db` below resolves to that
// request's client. Code written against `db` (as the Express server's
// `db/client.ts` export is) therefore keeps working without every importer
// having to pass a client around.
type Database = PostgresJsDatabase<typeof schema>;
type RequestDb = { db: Database; client: ReturnType<typeof postgres> };

const requestDb = new AsyncLocalStorage<RequestDb>();

export interface DbEnv {
  HYPERDRIVE: { connectionString: string };
}

export async function withDb<T>(env: DbEnv, fn: () => Promise<T>): Promise<T> {
  // max: 1 — Hyperdrive does the real pooling; one connection per request is
  // enough and keeps us far below the Worker's concurrent-connection limit.
  // postgres.js connects lazily, so requests that never query (auth failures,
  // validation errors) cost no connection.
  const client = postgres(env.HYPERDRIVE.connectionString, { max: 1 });
  try {
    return await requestDb.run({ db: drizzle(client, { schema }), client }, fn);
  } finally {
    await client.end({ timeout: 1 });
  }
}

export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const current = requestDb.getStore();
    if (!current) {
      // Fail loudly rather than silently falling back to a shared client.
      throw new Error("db was used outside of a request (wrap the handler in withDb)");
    }
    const value = Reflect.get(current.db, prop);
    return typeof value === "function" ? value.bind(current.db) : value;
  },
});
