import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "vitest/config";
import { assertSafeTestTargets } from "./src/config/testTargetGuard.js";

// Tests never read the application's `.env` (which may hold production
// credentials). The only database/Redis targets a test process can receive
// are the dedicated TEST_* values below, from a separate, gitignored
// `.env.test` or the shell — and only after they pass the guard.
loadDotenv({ path: path.resolve(import.meta.dirname, ".env.test"), quiet: true });

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;
const optIn = process.env.ALLOW_TEST_DB_WRITES;

// If anything test-related is configured, it must be entirely valid or
// nothing runs — a half-configured or unsafe setup fails here, before any
// worker starts. If nothing is configured, tests that need no live service
// still run, while any test that imports a database/Redis client fails early
// with a readable message from config/env.ts.
const hasLiveTargets = Boolean(databaseUrl || redisUrl || optIn);
if (hasLiveTargets) {
  assertSafeTestTargets({ databaseUrl, redisUrl, optIn });
}

export default defineConfig({
  test: {
    // Without this, vitest's default glob also picks up compiled test files
    // under dist/ (a local, gitignored `npm run build` artifact) alongside
    // the real src/ tests — running both against the same database and
    // causing spurious unique-constraint collisions in the integration test.
    exclude: ["dist/**", "node_modules/**"],
    // These override whatever the shell or CI already exported, so ambient
    // production DATABASE_URL / REDIS_URL / API keys can never reach a test.
    // Everything that is not a database or Redis target is a harmless
    // synthetic value (the R2 client is mocked in tests).
    env: {
      NODE_ENV: "test",
      DATABASE_URL: hasLiveTargets ? databaseUrl! : "",
      REDIS_URL: hasLiveTargets ? redisUrl! : "",
      ALLOW_TEST_DB_WRITES: hasLiveTargets ? "1" : "",
      CORS_ORIGIN: "http://localhost:3000",
      INTERNAL_API_SECRET: "test-internal-api-secret-0123456789abcdef",
      R2_ENDPOINT: "https://placeholder.r2.example",
      R2_BUCKET_NAME: "test-bucket",
      R2_ACCESS_KEY_ID: "test-access-key-id",
      R2_SECRET_ACCESS_KEY: "test-secret-access-key",
      METERED_TURN_APP_NAME: "",
      METERED_TURN_API_KEY: "",
      METERED_TURN_REGION: "",
      TURN_URLS: "",
      TURN_STATIC_AUTH_SECRET: "",
      TURN_STATIC_USERNAME: "",
      TURN_STATIC_CREDENTIAL: "",
    },
  },
});
