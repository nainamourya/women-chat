import { config as loadDotenv } from "dotenv";
import { parseEnv } from "./envSchema.js";
import { assertSafeTestTargets } from "./testTargetGuard.js";

// Every database/Redis client imports this module first, so everything that
// must happen before a connection can exist happens here, in this order:
//
// 1. Decide whether a local `.env` file may be read. It is a development
//    convenience only: never in tests (they get explicit, validated test
//    configuration instead) and never when NODE_ENV=production is already
//    set by the host. If NODE_ENV is absent altogether, .env is read purely
//    so a developer's NODE_ENV=development line can supply it.
// 2. In test mode, refuse to continue unless the database and Redis URLs are
//    explicit, opted-in, local test targets — see testTargetGuard.ts.
// 3. Validate the whole environment. NODE_ENV has no default, so a missing or
//    invalid value stops startup instead of silently becoming "development".
//
// A test runner is recognised by the runner itself (Vitest sets VITEST in every
// worker), not only by NODE_ENV: with the repo's vitest.config.ts bypassed and a
// stray NODE_ENV=development in the shell, relying on NODE_ENV alone would read
// `.env` and run tests against whatever it points at.
const underTestRunner = process.env.VITEST !== undefined;
const initialNodeEnv = process.env.NODE_ENV;

if (!underTestRunner && (initialNodeEnv === undefined || initialNodeEnv === "development")) {
  loadDotenv({ quiet: true });
}

// Decided after .env has been read, so a `.env` that sets NODE_ENV=test cannot
// switch the guard off by being read first.
const isTestMode = underTestRunner || process.env.NODE_ENV === "test";

if (isTestMode) {
  // Thrown (not process.exit) so the reasons show up as the test file's failure.
  assertSafeTestTargets({
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL,
    optIn: process.env.ALLOW_TEST_DB_WRITES,
  });
}

const result = parseEnv(process.env);

if (!result.success) {
  // Messages name variables and rules only — never values.
  const message = ["Invalid server environment configuration:", ...result.errors.map((line) => ` - ${line}`)].join("\n");
  if (isTestMode) {
    throw new Error(message);
  }
  console.error(message);
  process.exit(1);
}

export const env = result.data;

// Split (and trim) so a single Render env var can list multiple allowed
// origins, e.g. "https://women-chat.vercel.app,https://www.giigirl.com" —
// both cors() and the Socket.IO server accept an array here natively.
export const CORS_ORIGINS = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());
