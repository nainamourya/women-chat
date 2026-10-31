import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resolveLocalDatabaseUrl, startLocalWorker, type RunningWorker } from "./localWorker";

describe("edge Worker (Stage A) against local Docker Postgres", () => {
  let worker: RunningWorker;

  beforeAll(async () => {
    worker = await startLocalWorker(8794);
  });
  afterAll(() => worker?.stop());

  it("GET /api/health is live and matches the Express contract", async () => {
    const res = await fetch(`${worker.baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  it("GET /api/health/ready reaches Postgres through the Hyperdrive binding", async () => {
    const res = await fetch(`${worker.baseUrl}/api/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", dependencies: { postgres: "ok" } });
  });

  it("unknown routes return 404 (Express's default, as on the Express server)", async () => {
    const res = await fetch(`${worker.baseUrl}/api/nope`);
    expect(res.status).toBe(404);
  });

  it("50 sequential readiness requests all succeed (no shared-client failure)", async () => {
    for (let i = 0; i < 50; i++) {
      const res = await fetch(`${worker.baseUrl}/api/health/ready`);
      expect(res.status, `sequential request ${i + 1}`).toBe(200);
    }
  });

  it("50 parallel readiness requests all succeed", async () => {
    const results = await Promise.all(
      Array.from({ length: 50 }, () => fetch(`${worker.baseUrl}/api/health/ready`).then((r) => r.status)),
    );
    expect(results.filter((s) => s !== 200)).toEqual([]);
  });
});

// The harness may only hand the Worker a database that passes the server's
// testTargetGuard. These use synthetic strings only — no real host or credential.
describe("testTargetGuard still gates the local Worker's database", () => {
  const good = { redisUrl: "redis://localhost:6379/1", optIn: "1" };

  it("accepts a local database whose name has a test word", () => {
    expect(() => resolveLocalDatabaseUrl({ ...good, databaseUrl: "postgresql://u:p@localhost:5432/example_test" })).not.toThrow();
  });

  it("rejects a hosted (Neon-style) database", () => {
    expect(() => resolveLocalDatabaseUrl({ ...good, databaseUrl: "postgresql://u:p@ep-example-123.us-east-2.aws.neon.tech/example_test" })).toThrow(/Refusing to run tests/);
  });

  it("rejects a local database that is not a test database", () => {
    expect(() => resolveLocalDatabaseUrl({ ...good, databaseUrl: "postgresql://u:p@localhost:5432/example" })).toThrow(/Refusing to run tests/);
  });

  it("rejects a loopback URL carrying a query string (driver-bypass trick)", () => {
    expect(() => resolveLocalDatabaseUrl({ ...good, databaseUrl: "postgresql://u:p@localhost:5432/example_test?host=db.example.com" })).toThrow(/Refusing to run tests/);
  });

  it("rejects when the explicit opt-in is missing", () => {
    expect(() => resolveLocalDatabaseUrl({ ...good, optIn: undefined, databaseUrl: "postgresql://u:p@localhost:5432/example_test" })).toThrow(/Refusing to run tests/);
  });

  it("rejects when no database is configured at all", () => {
    expect(() => resolveLocalDatabaseUrl({ ...good, databaseUrl: undefined })).toThrow(/Refusing to run tests/);
  });

  it("error messages never echo the URL, host or credentials", () => {
    try {
      resolveLocalDatabaseUrl({ ...good, databaseUrl: "postgresql://secretuser:secretpass@ep-example-123.neon.tech/example_test" });
      expect.unreachable();
    } catch (err) {
      const message = String((err as Error).message);
      expect(message).not.toMatch(/secretuser|secretpass|ep-example|neon\.tech/);
    }
  });
});
