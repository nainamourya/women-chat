// Safety boundary for automated tests: a test process may only be pointed at a
// disposable, local PostgreSQL database and Redis instance that were
// explicitly opted into. Pure functions with no I/O and no imports, so this
// can be used by the Vitest config, by config/env.ts (before any database or
// Redis client is constructed) and by the test-database migration script.
//
// This is an allow-list, not a deny-list: anything not positively identified
// as local-and-test-only is rejected, including hosts nobody has thought of.
// Messages deliberately never include the URL, host or credentials.

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

// Only used to give a clearer reason when someone points at a hosted service;
// the loopback allow-list above is what actually enforces the rule.
const HOSTED_PROVIDER_PATTERN =
  /neon\.(tech|build)|upstash\.io|(on)?render\.com|amazonaws\.com|supabase\.(co|com)|railway\.app|heroku|aiven|digitalocean|azure|cockroach|planetscale|elephantsql|redislabs|redis-cloud|redis\.com|fly\.(dev|io)|vercel/i;

export const TEST_OPT_IN_VAR = "ALLOW_TEST_DB_WRITES";
const SETUP_HINT = "See apps/server/.env.test.example for the required test-only configuration.";

export type TestTargets = {
  databaseUrl: string | undefined;
  redisUrl: string | undefined;
  // Value of ALLOW_TEST_DB_WRITES. Only the exact string "1" counts.
  optIn: string | undefined;
};

export class UnsafeTestTargetError extends Error {
  readonly reasons: string[];

  constructor(reasons: string[]) {
    super(
      [
        "Refusing to run tests: the database/Redis configuration is not a safe, explicitly opted-in test target.",
        ...reasons.map((reason) => ` - ${reason}`),
        SETUP_HINT,
      ].join("\n"),
    );
    this.name = "UnsafeTestTargetError";
    this.reasons = reasons;
  }
}

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function hostnameOf(url: URL): string {
  // URL keeps the brackets on IPv6 literals ("[::1]").
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function hostReason(label: string, url: URL): string | null {
  const host = hostnameOf(url);
  if (LOOPBACK_HOSTS.has(host)) return null;
  if (HOSTED_PROVIDER_PATTERN.test(host)) {
    return `${label} points at a hosted/production service; tests may only use a local instance`;
  }
  return `${label} host is not a loopback address (localhost, 127.0.0.1 or ::1)`;
}

// libpq-style parameters can override the host in the URL's authority part,
// so a loopback-looking URL could still connect elsewhere.
function hostOverrideReason(label: string, url: URL): string | null {
  for (const key of url.searchParams.keys()) {
    const name = key.toLowerCase();
    if (name === "host" || name === "hostaddr") {
      return `${label} must not override the host through a query parameter`;
    }
  }
  return null;
}

function checkDatabaseUrl(raw: string | undefined): string[] {
  const label = "Test database URL";
  if (!raw) return [`${label} is not configured (set TEST_DATABASE_URL)`];

  const url = parseUrl(raw);
  if (!url) return [`${label} is not a valid URL`];

  const reasons: string[] = [];
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    reasons.push(`${label} must use the postgres:// or postgresql:// scheme`);
  }
  const host = hostReason(label, url);
  if (host) reasons.push(host);
  const override = hostOverrideReason(label, url);
  if (override) reasons.push(override);

  // The database name must carry an explicit "test" token (womenchat_test,
  // giigirl-test-2 …) so a local development database can never be targeted.
  let dbName = "";
  try {
    dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));
  } catch {
    // leave empty → rejected below
  }
  if (!/(^|[^a-z0-9])test([^a-z0-9]|$)/i.test(dbName)) {
    reasons.push(`${label} database name must contain "test" as a separate word (for example womenchat_test)`);
  }
  return reasons;
}

function checkRedisUrl(raw: string | undefined): string[] {
  const label = "Test Redis URL";
  if (!raw) return [`${label} is not configured (set TEST_REDIS_URL)`];

  const url = parseUrl(raw);
  if (!url) return [`${label} is not a valid URL`];

  const reasons: string[] = [];
  // rediss:// (TLS) is what hosted services use; a local test Redis does not.
  if (url.protocol !== "redis:") {
    reasons.push(`${label} must use the plain redis:// scheme (hosted TLS services use rediss://)`);
  }
  const host = hostReason(label, url);
  if (host) reasons.push(host);
  const override = hostOverrideReason(label, url);
  if (override) reasons.push(override);

  // A non-zero logical database keeps tests away from local development data
  // (database 0 is where an unconfigured client would write).
  const dbIndex = /^\/(\d+)$/.exec(url.pathname)?.[1];
  const parsedIndex = dbIndex === undefined ? NaN : Number(dbIndex);
  if (!Number.isInteger(parsedIndex) || parsedIndex < 1 || parsedIndex > 15) {
    reasons.push(`${label} must select a dedicated logical database between 1 and 15 (for example /15)`);
  }
  return reasons;
}

export function checkTestTargets(targets: TestTargets): string[] {
  const reasons: string[] = [];
  if (targets.optIn !== "1") {
    reasons.push(`Explicit opt-in is missing (set ${TEST_OPT_IN_VAR}=1 in your test-only configuration)`);
  }
  reasons.push(...checkDatabaseUrl(targets.databaseUrl));
  reasons.push(...checkRedisUrl(targets.redisUrl));
  return reasons;
}

// Throws UnsafeTestTargetError unless both targets are local, test-only and
// the opt-in is present. Performs no I/O — safe to call before any client
// exists.
export function assertSafeTestTargets(targets: TestTargets): void {
  const reasons = checkTestTargets(targets);
  if (reasons.length > 0) {
    throw new UnsafeTestTargetError(reasons);
  }
}
