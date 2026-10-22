import { describe, expect, it } from "vitest";
import { UnsafeTestTargetError, assertSafeTestTargets, checkTestTargets } from "./testTargetGuard.js";

// Every URL here is synthetic. The "production-like" ones are made-up hosts
// on the providers' real domains, not real credentials, and are only ever
// parsed — nothing in this file opens a connection.
const SAFE_DB = "postgresql://womenchat:womenchat@localhost:5432/womenchat_test";
const SAFE_REDIS = "redis://localhost:6379/15";
const FAKE_NEON = "postgresql://appuser:s3cretpw@ep-example-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const FAKE_UPSTASH = "rediss://default:s3cretpw@example-12345.upstash.io:6379";

const safe = { databaseUrl: SAFE_DB, redisUrl: SAFE_REDIS, optIn: "1" };

function reasonsFor(overrides: Partial<typeof safe>) {
  return checkTestTargets({ ...safe, ...overrides });
}

function joined(overrides: Partial<typeof safe>) {
  return reasonsFor(overrides).join("\n");
}

describe("assertSafeTestTargets — accepted", () => {
  it("accepts a dedicated local test database and Redis with explicit opt-in", () => {
    expect(() => assertSafeTestTargets(safe)).not.toThrow();
  });

  it.each(["postgresql://u:p@127.0.0.1:5432/giigirl_test", "postgres://u:p@localhost:5432/test", "postgresql://u@localhost/ci-test-2"])(
    "accepts loopback database %s",
    (databaseUrl) => {
      expect(reasonsFor({ databaseUrl })).toEqual([]);
    },
  );

  it("accepts IPv6 loopback for Redis (ioredis parses it correctly) but not for Postgres (postgres.js does not)", () => {
    expect(reasonsFor({ redisUrl: "redis://[::1]:6379/15" })).toEqual([]);
    expect(joined({ databaseUrl: "postgresql://u:p@[::1]:5432/womenchat_test" })).toMatch(/not a loopback/);
  });

  it("accepts loopback Redis on any logical database from 1 to 15", () => {
    expect(reasonsFor({ redisUrl: "redis://127.0.0.1:6380/1" })).toEqual([]);
    expect(reasonsFor({ redisUrl: "redis://:pw@[::1]:6379/15" })).toEqual([]);
  });
});

describe("assertSafeTestTargets — rejected", () => {
  it("rejects when the explicit opt-in is missing or not exactly 1", () => {
    for (const optIn of [undefined, "", "0", "true", "yes"]) {
      expect(joined({ optIn })).toMatch(/opt-in is missing/);
    }
  });

  it("rejects missing database or Redis configuration", () => {
    expect(joined({ databaseUrl: undefined })).toMatch(/database URL is not configured/);
    expect(joined({ redisUrl: undefined })).toMatch(/Redis URL is not configured/);
    expect(reasonsFor({ databaseUrl: "", redisUrl: "" })).toHaveLength(2);
  });

  it("rejects a production-style Neon URL", () => {
    expect(joined({ databaseUrl: FAKE_NEON })).toMatch(/hosted\/production service/);
  });

  it("rejects a production-style Upstash URL", () => {
    const reasons = joined({ redisUrl: FAKE_UPSTASH });
    expect(reasons).toMatch(/hosted\/production service/);
    expect(reasons).toMatch(/plain redis:\/\/ scheme/);
  });

  it("does not trust the word 'localhost' appearing elsewhere in the URL", () => {
    expect(joined({ databaseUrl: "postgresql://localhost:x@evil.example/womenchat_test" })).toMatch(/not a loopback/);
    expect(joined({ databaseUrl: "postgresql://u:p@localhost.attacker.example/womenchat_test" })).toMatch(/not a loopback/);
    expect(joined({ databaseUrl: "postgresql://u:p@localhost:5432@evil.example/womenchat_test" })).toMatch(/not a loopback/);
    expect(joined({ redisUrl: "redis://localhost.attacker.example:6379/15" })).toMatch(/not a loopback/);
    expect(joined({ redisUrl: "redis://localhost:6379@evil.example/15" })).toMatch(/not a loopback/);
  });

  it("rejects a loopback database that is not clearly a test database", () => {
    for (const name of ["womenchat", "contest", "testdb", "latest"]) {
      expect(joined({ databaseUrl: `postgresql://u:p@localhost:5432/${name}` })).toMatch(/must contain "test"/);
    }
  });

  it("rejects Redis database 0, a missing database index, or one out of range", () => {
    for (const redisUrl of ["redis://localhost:6379", "redis://localhost:6379/", "redis://localhost:6379/0", "redis://localhost:6379/16", "redis://localhost:6379/abc"]) {
      expect(joined({ redisUrl })).toMatch(/dedicated logical database/);
    }
  });

  // Found by comparing this guard against what postgres.js and ioredis really
  // do with the same strings (see testTargetGuard.drivers.test.ts): the drivers
  // copy query parameters into their own options, so the validated host is not
  // necessarily the host (or socket, or database) that gets used.
  it("rejects any query string or fragment", () => {
    for (const suffix of ["?host=db.example", "?hostaddr=10.0.0.5", "?HOST=db.example", "?%68ost=db.example", "?sslmode=disable", "?", "#frag", "#@evil.example"]) {
      expect(joined({ databaseUrl: SAFE_DB + suffix })).toMatch(/query string or fragment/);
    }
    for (const suffix of ["?host=cache.example", "?path=/tmp/redis.sock", "?db=0", "?port=7777", "?keyPrefix=x", "#frag"]) {
      expect(joined({ redisUrl: SAFE_REDIS + suffix })).toMatch(/query string or fragment/);
    }
  });

  it("rejects whitespace and control characters anywhere in the URL", () => {
    const nul = String.fromCharCode(0);
    for (const databaseUrl of [" " + SAFE_DB, SAFE_DB + " ", SAFE_DB + "\n", SAFE_DB + nul]) {
      expect(joined({ databaseUrl })).toMatch(/whitespace or control/);
    }
    expect(joined({ redisUrl: " " + SAFE_REDIS })).toMatch(/whitespace or control/);
  });

  it("validates the raw database name: percent-encoding, extra slashes and path tricks are rejected", () => {
    for (const path of ["womenchat%5Ftest", "womenchat_test%00", "/womenchat_test", "womenchat_test/", "womenchat_test/../womenchat", "womenchat/test", ""]) {
      // "../" is collapsed by the URL parser into a different (non-test) name, so
      // that one is rejected for the name rather than the shape — rejected either way.
      expect(joined({ databaseUrl: `postgresql://u:p@localhost/${path}` })).toMatch(/single plain database name|must contain "test"/);
    }
  });

  it("validates the raw Redis database index: leading zeros, signs, encoding and extra segments are rejected", () => {
    for (const path of ["/015", "/+15", "/%31%35", "/15/", "//15", "/15/../0", "/1e1", "/0x0F", "/15abc"]) {
      expect(joined({ redisUrl: `redis://localhost:6379${path}` })).toMatch(/dedicated logical database/);
    }
  });

  it("rejects multi-host, non-URL and wrong-scheme values", () => {
    expect(joined({ databaseUrl: "postgresql://u:p@localhost,db.example:5432/womenchat_test" })).toMatch(/not a loopback/);
    expect(joined({ databaseUrl: "not a url" })).toMatch(/not a valid URL/);
    expect(joined({ databaseUrl: "mysql://u:p@localhost/womenchat_test" })).toMatch(/postgres/);
    expect(joined({ redisUrl: "http://localhost/15" })).toMatch(/redis:\/\//);
  });

  it("throws UnsafeTestTargetError listing every problem", () => {
    let error: unknown;
    try {
      assertSafeTestTargets({ databaseUrl: FAKE_NEON, redisUrl: FAKE_UPSTASH, optIn: undefined });
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(UnsafeTestTargetError);
    expect((error as UnsafeTestTargetError).reasons.length).toBeGreaterThanOrEqual(4);
  });
});

describe("assertSafeTestTargets — never leaks what it was given", () => {
  it("keeps hosts, usernames, passwords and URLs out of every message", () => {
    let message = "";
    try {
      assertSafeTestTargets({ databaseUrl: FAKE_NEON, redisUrl: FAKE_UPSTASH, optIn: "1" });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).not.toBe("");
    // Generic advice such as "use redis://" is fine; anything taken from the
    // values that were supplied is not.
    for (const supplied of [FAKE_NEON, FAKE_UPSTASH, "s3cretpw", "appuser", "ep-example-123456", "neon.tech", "example-12345", "upstash.io"]) {
      expect(message).not.toContain(supplied);
    }
  });
});
