import { spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

// `npm run test:db:migrate` executes SQL, so what matters is that it refuses an
// unsafe destination BEFORE it creates a database client. These tests run the
// real script as a child process and give it only synthetic, unsafe targets
// (made-up hosts that are never contacted). A run that tried to connect would
// either print "Applying migrations…" or hang until the timeout.
//
// Each case sets every TEST_* variable explicitly — even to "" — because the
// script loads a local, gitignored .env.test for any variable that is absent,
// and these tests must not depend on whether a developer has one.
const SERVER_ROOT = path.resolve(import.meta.dirname, "../..");
const SAFE_REDIS = "redis://localhost:6379/15";
const FAKE_NEON = "postgresql://appuser:s3cretpw@ep-example-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";

function runScript(env: Record<string, string>) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "src/db/migrateTestDb.ts"], {
    cwd: SERVER_ROOT,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 60_000,
  });
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe("test:db:migrate refuses an unsafe destination before any SQL", () => {
  it("rejects a production-style database URL", () => {
    const run = runScript({ TEST_DATABASE_URL: FAKE_NEON, TEST_REDIS_URL: SAFE_REDIS, ALLOW_TEST_DB_WRITES: "1" });
    expect(run.status).toBe(1);
    expect(run.output).toMatch(/Refusing to run tests/);
    expect(run.output).toMatch(/hosted\/production service/);
    expect(run.output).not.toMatch(/Applying migrations/);
    expect(run.output).not.toMatch(/migrations complete/i);
  });

  it("rejects a missing configuration and ignores an ambient DATABASE_URL", () => {
    const run = runScript({
      DATABASE_URL: FAKE_NEON,
      TEST_DATABASE_URL: "",
      TEST_REDIS_URL: "",
      ALLOW_TEST_DB_WRITES: "",
    });
    expect(run.status).toBe(1);
    expect(run.output).toMatch(/not configured/);
    expect(run.output).not.toMatch(/Applying migrations/);
  });

  it("rejects a loopback database that is not a test database", () => {
    const run = runScript({
      TEST_DATABASE_URL: "postgresql://womenchat:womenchat@localhost:5432/womenchat",
      TEST_REDIS_URL: SAFE_REDIS,
      ALLOW_TEST_DB_WRITES: "1",
    });
    expect(run.status).toBe(1);
    expect(run.output).toMatch(/must contain "test"/);
    expect(run.output).not.toMatch(/Applying migrations/);
  });

  it("never prints the URL, host or credentials it was given", () => {
    const run = runScript({ TEST_DATABASE_URL: FAKE_NEON, TEST_REDIS_URL: SAFE_REDIS, ALLOW_TEST_DB_WRITES: "1" });
    for (const supplied of [FAKE_NEON, "s3cretpw", "appuser", "ep-example-123456", "neon.tech"]) {
      expect(run.output).not.toContain(supplied);
    }
  });
});
