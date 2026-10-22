// Safety boundary for automated tests: a test process may only be pointed at a
// disposable, local PostgreSQL database and Redis instance that were
// explicitly opted into. Pure functions with no I/O and no imports, so this
// can be used by the Vitest config, by config/env.ts (before any database or
// Redis client is constructed) and by the test-database migration script.
//
// This is an allow-list, not a deny-list: anything not positively identified
// as local-and-test-only is rejected, including hosts nobody has thought of.
// Messages deliberately never include the URL, host or credentials.

// Per service, because the drivers differ: postgres.js mis-parses bracketed
// IPv6 literals ("[::1]" becomes the host "["), so a Postgres URL that looks
// like loopback to this guard would not mean what it says to the driver.
const POSTGRES_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1"]);
const REDIS_LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

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

function hostReason(label: string, url: URL, loopbackHosts: Set<string>): string | null {
  const host = hostnameOf(url);
  if (loopbackHosts.has(host)) return null;
  if (HOSTED_PROVIDER_PATTERN.test(host)) {
    return `${label} points at a hosted/production service; tests may only use a local instance`;
  }
  return `${label} host is not a loopback address (localhost, 127.0.0.1 or ::1)`;
}

// The drivers copy query parameters into their own connection options (ioredis
// accepts `?path=` for a Unix socket, `?port=`, `?db=` …; libpq-style URLs
// accept `?host=`), and not always the way WHATWG URL parsing suggests. The
// only way to be sure the validated target is the real target is to allow
// none of them. The same goes for fragments, whitespace and control
// characters, which different parsers trim or interpret differently.
function rawFormReason(label: string, raw: string): string | null {
  if (/[\s\x00-\x1f\x7f]/.test(raw)) {
    return `${label} must not contain whitespace or control characters`;
  }
  if (/[?#]/.test(raw)) {
    return `${label} must not contain a query string or fragment (use a plain host/port/database URL)`;
  }
  return null;
}

function checkDatabaseUrl(raw: string | undefined): string[] {
  const label = "Test database URL";
  if (!raw) return [`${label} is not configured (set TEST_DATABASE_URL)`];

  const reasons: string[] = [];
  const rawForm = rawFormReason(label, raw);
  if (rawForm) reasons.push(rawForm);

  const url = parseUrl(raw);
  if (!url) return [...reasons, `${label} is not a valid URL`];

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    reasons.push(`${label} must use the postgres:// or postgresql:// scheme`);
  }
  const host = hostReason(label, url, POSTGRES_LOOPBACK_HOSTS);
  if (host) reasons.push(host);

  // The raw path (never percent-decoded: the driver uses it as written) must be
  // exactly one plain database name, and that name must carry an explicit
  // "test" token (womenchat_test, giigirl-test-2 …) so a local development
  // database can never be targeted.
  const dbName = /^\/([A-Za-z0-9_-]+)$/.exec(url.pathname)?.[1];
  if (!dbName) {
    reasons.push(`${label} must end in a single plain database name (letters, digits, "_" or "-")`);
  } else if (!/(^|[^a-z0-9])test([^a-z0-9]|$)/i.test(dbName)) {
    reasons.push(`${label} database name must contain "test" as a separate word (for example womenchat_test)`);
  }
  return reasons;
}

function checkRedisUrl(raw: string | undefined): string[] {
  const label = "Test Redis URL";
  if (!raw) return [`${label} is not configured (set TEST_REDIS_URL)`];

  const reasons: string[] = [];
  const rawForm = rawFormReason(label, raw);
  if (rawForm) reasons.push(rawForm);

  const url = parseUrl(raw);
  if (!url) return [...reasons, `${label} is not a valid URL`];

  // rediss:// (TLS) is what hosted services use; a local test Redis does not.
  if (url.protocol !== "redis:") {
    reasons.push(`${label} must use the plain redis:// scheme (hosted TLS services use rediss://)`);
  }
  const host = hostReason(label, url, REDIS_LOOPBACK_HOSTS);
  if (host) reasons.push(host);

  // A non-zero logical database keeps tests away from local development data
  // (database 0 is where an unconfigured client would write). Matched against
  // the raw path, so leading zeros, signs and percent-encoding are rejected.
  if (!/^\/([1-9]|1[0-5])$/.test(url.pathname)) {
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
