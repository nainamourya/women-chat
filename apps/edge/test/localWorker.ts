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

export async function startLocalWorker(port: number): Promise<RunningWorker> {
  const databaseUrl = resolveLocalDatabaseUrl(readServerTestTargets());

  const child: ChildProcess = spawn(
    process.execPath,
    [path.resolve(edgeDir, "../../node_modules/wrangler/bin/wrangler.js"), "dev", "--local", "--port", String(port), "--ip", "127.0.0.1"],
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
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return { baseUrl, stop };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  stop();
  throw new Error("Local Worker did not become ready within 60s");
}
