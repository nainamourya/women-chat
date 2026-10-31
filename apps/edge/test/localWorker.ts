import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parse } from "dotenv";
import { assertSafeTestTargets } from "../../server/src/config/testTargetGuard";

const edgeDir = path.resolve(import.meta.dirname, "..");
const serverEnvTest = path.resolve(edgeDir, "../server/.env.test");

export type LocalTargets = { databaseUrl: string | undefined; redisUrl: string | undefined; optIn: string | undefined };

// The ONLY source of a database URL for the local Worker. It must pass the
// same allow-list guard the server's tests use (local loopback, a database
// name containing a "test" word, explicit opt-in) — otherwise this throws
// before any process is started. The URL is never logged.
export function resolveLocalDatabaseUrl(targets: LocalTargets): string {
  assertSafeTestTargets(targets);
  return targets.databaseUrl as string;
}

export function readServerTestTargets(): LocalTargets {
  // Parsed, not loaded into process.env, so nothing else inherits it.
  const values = parse(readFileSync(serverEnvTest));
  return {
    databaseUrl: values.TEST_DATABASE_URL,
    redisUrl: values.TEST_REDIS_URL,
    optIn: values.ALLOW_TEST_DB_WRITES,
  };
}

export type RunningWorker = { baseUrl: string; stop: () => void };

// Synthetic, test-only values. They are passed on the wrangler command line
// (visible in the local process list), which is fine precisely because none of
// them is a real secret.
export const TEST_INTERNAL_SECRET = "edge-test-internal-secret-0123456789";
export const TEST_ORIGIN = "http://localhost:3000";
export const DEFAULT_TEST_VARS: Record<string, string> = {
  NODE_ENV: "test",
  CORS_ORIGIN: TEST_ORIGIN,
  INTERNAL_API_SECRET: TEST_INTERNAL_SECRET,
};

export type StartOptions = {
  // Replaces DEFAULT_TEST_VARS entirely when given (used to prove fail-closed).
  vars?: Record<string, string>;
  // For a Worker that is expected to answer 503 to everything: any HTTP
  // response counts as "up".
  anyResponseCountsAsUp?: boolean;
  // Point the Worker at a different database. It still has to pass the same
  // testTargetGuard (local, test-named, opted in) — used to simulate an
  // unreachable database with a closed local port.
  databaseUrl?: string;
};

/** The guard-validated local database URL, for tests that seed or clean rows. */
export function guardedTestDatabaseUrl(): string {
  return resolveLocalDatabaseUrl(readServerTestTargets());
}

export async function startLocalWorker(port: number, options: StartOptions = {}): Promise<RunningWorker> {
  const databaseUrl = options.databaseUrl
    ? resolveLocalDatabaseUrl({ ...readServerTestTargets(), databaseUrl: options.databaseUrl })
    : guardedTestDatabaseUrl();
  const vars = options.vars ?? DEFAULT_TEST_VARS;
  const varArgs = Object.entries(vars).flatMap(([key, value]) => ["--var", `${key}:${value}`]);

  const child: ChildProcess = spawn(
    process.execPath,
    [path.resolve(edgeDir, "../../node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--port", String(port), "--ip", "127.0.0.1", ...varArgs],
    {
      cwd: edgeDir,
      stdio: "ignore",
      env: {
        ...process.env,
        WRANGLER_SEND_METRICS: "false",
        // Wrangler's documented override for a Hyperdrive binding's local target.
        CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE: databaseUrl,
      },
    },
  );

  const stop = () => {
    if (child.pid) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  };

  const baseUrl = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok || options.anyResponseCountsAsUp) return { baseUrl, stop };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  throw new Error("Local Worker did not become ready within 90s");
}
