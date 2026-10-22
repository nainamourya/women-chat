import { afterEach, describe, expect, it } from "vitest";
import postgres from "postgres";
import { Redis } from "ioredis";
import { checkTestTargets } from "./testTargetGuard.js";

// The guard's value depends on it reading a connection string the same way the
// drivers will. This file feeds adversarial strings to the REAL postgres.js and
// ioredis parsers (no connection is ever opened: postgres.js connects lazily on
// the first query and ioredis is created with lazyConnect) and asserts the
// property that matters: whenever the guard ACCEPTS a URL, the driver's actual
// target is the loopback host, the intended database, and nothing else.
//
// If a driver upgrade changes how it parses URLs, this is the test that fails.

const SAFE_REDIS = "redis://localhost:6379/15";
const SAFE_DB = "postgresql://u:p@localhost:5432/womenchat_test";

const opened: Array<{ close: () => void }> = [];
afterEach(() => {
  for (const handle of opened.splice(0)) handle.close();
});

type PgOptions = { host: string[]; port: number[]; database: string };
function postgresTarget(url: string): PgOptions {
  const client = postgres(url, { max: 1 });
  opened.push({ close: () => void client.end({ timeout: 0 }) });
  const options = client.options as unknown as PgOptions;
  return { host: options.host, port: options.port, database: options.database };
}

type RedisOptions = { host?: string; db?: number; path?: string; port?: number };
function redisTarget(url: string): RedisOptions {
  const client = new Redis(url, { lazyConnect: true, retryStrategy: () => null });
  client.on("error", () => {});
  opened.push({ close: () => client.disconnect() });
  const options = client.options as unknown as RedisOptions;
  return { host: options.host, db: options.db, path: options.path, port: options.port };
}

const POSTGRES_CORPUS = [
  SAFE_DB,
  "postgres://u:p@127.0.0.1:5432/giigirl-test",
  "postgresql://u:p@LOCALHOST/womenchat_test",
  "postgresql://u:p@localhost:5432@evil.example/womenchat_test",
  "postgresql://u:p@localhost\\@evil.example/womenchat_test",
  "postgresql://u:p@localhost%2f@evil.example/womenchat_test",
  "postgresql://u:p@localhost,evil.example/womenchat_test",
  "postgresql://u:p@localhost:5432,evil.example:5432/womenchat_test",
  "postgresql://u:p@[::1]:5432/womenchat_test",
  "postgresql://u:p@[::ffff:127.0.0.1]/womenchat_test",
  "postgresql://u:p@0x7f.0.0.1/womenchat_test",
  "postgresql://u:p@2130706433/womenchat_test",
  "postgresql://u:p@127.1/womenchat_test",
  "postgresql://u:p@%6cocalhost/womenchat_test",
  "postgresql://u:p@localhost./womenchat_test",
  "postgresql:///womenchat_test",
  "postgresql://u:p@localhost/womenchat_test#@evil.example",
  "postgresql://u:p@localhost/womenchat_test?host=evil.example",
  "postgresql://u:p@localhost/womenchat_test?HOST=evil.example",
  "postgresql://u:p@localhost/womenchat_test?%68ost=evil.example",
  "postgresql://u:p@localhost/womenchat_test?hostaddr=10.0.0.9",
  "postgresql://u:p@localhost/womenchat_test?database=womenchat",
  "postgresql://u:p@localhost/womenchat_test?port=6543",
  "postgresql://u:p@localhost/womenchat%5Ftest",
  "postgresql://u:p@localhost/womenchat_test%00",
  "postgresql://u:p@localhost//womenchat_test",
  "postgresql://u:p@localhost/womenchat_test/../womenchat",
  " postgresql://u:p@localhost/womenchat_test",
  "postgresql://u:p@localhost/womenchat_test\nhost=evil.example",
];

const REDIS_CORPUS = [
  SAFE_REDIS,
  "redis://127.0.0.1/1",
  "redis://:pw@[::1]:6379/15",
  "REDIS://LOCALHOST:6379/15",
  "redis://u:p@localhost:6379@evil.example/15",
  "redis://localhost:6379@evil.example/15",
  "redis://localhost\\@evil.example/15",
  "redis://evil.example#@localhost:6379/15",
  "redis://localhost,evil.example:6379/15",
  "redis://%6cocalhost:6379/15",
  "redis://0x7f.0.0.1/15",
  "redis://localhost./15",
  "redis://localhost:6379/15?db=0",
  "redis://localhost:6379/15?host=evil.example",
  "redis://localhost:6379/15?path=/tmp/redis.sock",
  "redis://localhost:6379/15?port=7777",
  "redis://localhost:6379/15?tls=1",
  "redis://localhost:6379/15#frag",
  "redis://localhost:6379/15/",
  "redis://localhost:6379//15",
  "redis://localhost:6379/15/../0",
  "redis://localhost:6379/%31%35",
  "redis://localhost:6379/015",
  "redis://localhost:6379/+15",
  "redis://localhost:6379/1e1",
  "redis://localhost:6379/0x0F",
  "redis://localhost:6379/15abc",
  "rediss://localhost:6379/15",
  "redis+sentinel://localhost:26379/15",
  "redis+unix:///tmp/redis.sock",
];

describe("guard vs. the real postgres.js parser", () => {
  it("accepts at least the plain local URL (the corpus is not vacuous)", () => {
    expect(checkTestTargets({ databaseUrl: SAFE_DB, redisUrl: SAFE_REDIS, optIn: "1" })).toEqual([]);
  });

  it.each(POSTGRES_CORPUS)("an accepted URL means the driver connects to loopback and the test database: %j", (url) => {
    const accepted = checkTestTargets({ databaseUrl: url, redisUrl: SAFE_REDIS, optIn: "1" }).length === 0;
    if (!accepted) return;

    const target = postgresTarget(url);
    expect(target.host.length).toBe(1);
    expect(["localhost", "127.0.0.1"]).toContain(target.host[0]!.toLowerCase());
    expect(target.database).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(target.database).toMatch(/(^|[^a-z0-9])test([^a-z0-9]|$)/i);
  });
});

describe("guard vs. the real ioredis parser", () => {
  it.each(REDIS_CORPUS)("an accepted URL means the client connects to loopback on a dedicated database: %j", (url) => {
    const accepted = checkTestTargets({ databaseUrl: SAFE_DB, redisUrl: url, optIn: "1" }).length === 0;
    if (!accepted) return;

    const target = redisTarget(url);
    expect(["localhost", "127.0.0.1", "::1"]).toContain((target.host ?? "").toLowerCase());
    expect(target.path).toBeUndefined();
    expect(target.db).toBeGreaterThanOrEqual(1);
    expect(target.db).toBeLessThanOrEqual(15);
  });
});

describe("the driver parsers really do behave the way the guard assumes", () => {
  // Pins down the driver behaviours the stricter rules were written for, so a
  // future driver change that removes the hazard (or adds a new one) is noticed.
  it("ioredis lets ?path= redirect a loopback URL to a Unix socket", () => {
    expect(redisTarget("redis://localhost:6379/15?path=/tmp/redis.sock").path).toBe("/tmp/redis.sock");
  });

  it("postgres.js uses the raw, undecoded database name", () => {
    expect(postgresTarget("postgresql://u:p@localhost/womenchat%5Ftest").database).toBe("womenchat%5Ftest");
  });

  it("postgres.js does not understand bracketed IPv6 hosts", () => {
    expect(postgresTarget("postgresql://u:p@[::1]:5432/womenchat_test").host).toEqual(["["]);
  });

  it("both drivers take the host after the LAST @ in the authority", () => {
    expect(postgresTarget("postgresql://u:p@localhost:5432@evil.example/womenchat_test").host).toEqual(["evil.example"]);
    expect(redisTarget("redis://localhost:6379@evil.example/15").host).toBe("evil.example");
  });
});
