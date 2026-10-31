import { parseEnv, type Env } from "../../server/src/config/envSchema";

// The Worker validates its configuration with the SAME schema the Express
// server uses (NODE_ENV must be explicit, INTERNAL_API_SECRET length and
// placeholder rules in production, and so on) — nothing is re-implemented, so
// nothing can drift or be weakened.
//
// Only the variables this Worker structurally does not use are filled in, with
// a fixed marker instead of a real value: the database arrives through the
// Hyperdrive binding (never DATABASE_URL), Redis does not exist here yet
// (Stage C), and R2 is reached through bindings in a later stage. Any real
// DATABASE_URL / REDIS_URL / R2_* value set on the Worker is deliberately
// ignored.
const NOT_USED_IN_EDGE = "not-used-in-edge-worker";

export type EdgeConfig = { ok: true; env: Env; corsOrigins: string[] } | { ok: false };

let cached: EdgeConfig | undefined;

export function getConfig(): EdgeConfig {
  if (cached) return cached;

  const result = parseEnv({
    ...process.env,
    DATABASE_URL: NOT_USED_IN_EDGE,
    REDIS_URL: NOT_USED_IN_EDGE,
    R2_ENDPOINT: NOT_USED_IN_EDGE,
    R2_BUCKET_NAME: NOT_USED_IN_EDGE,
    R2_ACCESS_KEY_ID: NOT_USED_IN_EDGE,
    R2_SECRET_ACCESS_KEY: NOT_USED_IN_EDGE,
  });

  if (!result.success) {
    // Fail closed: every request gets a 503 (see app.ts). The messages name
    // variables and rules only — never values.
    console.error(["Invalid edge environment configuration:", ...result.errors.map((line) => ` - ${line}`)].join("\n"));
    cached = { ok: false };
    return cached;
  }

  cached = {
    ok: true,
    env: result.data,
    corsOrigins: result.data.CORS_ORIGIN.split(",").map((origin) => origin.trim()),
  };
  return cached;
}

/** Test seam only: forget the cached result. */
export function resetConfigForTests() {
  cached = undefined;
}
