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

describe("assertSafeTestTargets — accepted", () => {
  it("accepts a dedicated local test database and Redis with explicit opt-in", () => {
    expect(() => assertSafeTestTargets(safe)).not.toThrow();
  });

  it.each(["postgresql://u:p@127.0.0.1:5432/giigirl_test", "postgres://u:p@[::1]:5432/test", "postgresql://u@localhost/ci-test-2"])(
    "accepts loopback database %s",
    (databaseUrl) => {
      expect(reasonsFor({ databaseUrl })).toEqual([]);
    },
  );

  it("accepts loopback Redis on any logical database from 1 to 15", () => {
    expect(reasonsFor({ redisUrl: "redis://127.0.0.1:6380/1" })).toEqual([]);
    expect(reasonsFor({ redisUrl: "redis://:pw@[::1]:6379/15" })).toEqual([]);
  });
});

describe("assertSafeTestTargets — rejected", () => {
  it("rejects when the explicit opt-in is missing or not exactly 1", () => {
    for (const optIn of [undefined, "", "0", "true", "yes"]) {
      expect(reasonsFor({ optIn }).join("\n")).toMatch(/opt-in is missing/);
    }
  });

  it("rejects missing database or Redis configuration", () => {
    expect(reasonsFor({ databaseUrl: undefined }).join("\n")).toMatch(/database URL is not configured/);
    expect(reasonsFor({ redisUrl: undefined }).join("\n")).toMatch(/Redis URL is not configured/);
    expect(reasonsFor({ databaseUrl: "" , redisUrl: "" })).toHaveLength(2);
  });

  it("rejects a production-style Neon URL", () => {
    const reasons = reasonsFor({ databaseUrl: FAKE_NEON });
    expect(reasons.join("\n")).toMatch(/hosted\/production service/);
  });

  it("rejects a production-style Upstash URL", () => {
    const reasons = reasonsFor({ redisUrl: FAKE_UPSTASH }).join("\n");
    expect(reasons).toMatch(/hosted\/production service/);
    expect(reasons).toMatch(/plain redis:\/\/ scheme/);
  });

  it("does not trust the word 'localhost' appearing elsewhere in the URL", () => {
    expect(reasonsFor({ databaseUrl: "postgresql://localhost:x@evil.example/womenchat_test" }).join("\n")).toMatch(/not a loopback/);
    expect(reasonsFor({ databaseUrl: "postgresql://u:p@localhost.attacker.example/womenchat_test" }).join("\n")).toMatch(/not a loopback/);
    expect(reasonsFor({ databaseUrl: "postgresql://u:p@db.example/womenchat_test?note=localhost" }).join("\n")).toMatch(/not a loopback/);
    expect(reasonsFor({ redisUrl: "redis://localhost.attacker.example:6379/15" }).join("\n")).toMatch(/not a loopback/);
  });

  it("rejects a loopback database that is not clearly a test database", () => {
    for (const name of ["womenchat", "contest", "testdb", "latest"]) {
      expect(reasonsFor({ databaseUrl: `postgresql://u:p@localhost:5432/${name}` }).join("\n")).toMatch(/must contain "test"/);
    }
  });

  it("rejects Redis database 0, a missing database index, or one out of range", () => {
    for (const redisUrl of ["redis://localhost:6379", "redis://localhost:6379/", "redis://localhost:6379/0", "redis://localhost:6379/16", "redis://localhost:6379/abc"]) {
      expect(reasonsFor({ redisUrl }).join("\n")).toMatch(/dedicated logical database/);
    }
  });

  it("rejects a host override smuggled in through query parameters", () => {
    expect(reasonsFor({ databaseUrl: `${SAFE_DB}?host=db.example` }).join("\n")).toMatch(/query parameter/);
    expect(reasonsFor({ databaseUrl: `${SAFE_DB}?hostaddr=10.0.0.5` }).join("\n")).toMatch(/query parameter/);
    expect(reasonsFor({ redisUrl: `${SAFE_REDIS}?host=cache.example` }).join("\n")).toMatch(/query parameter/);
  });

  it("rejects multi-host, non-URL and wrong-scheme values", () => {
    expect(reasonsFor({ databaseUrl: "postgresql://u:p@localhost,db.example:5432/womenchat_test" }).join("\n")).toMatch(/not a loopback/);
    expect(reasonsFor({ databaseUrl: "not a url" }).join("\n")).toMatch(/not a valid URL/);
    expect(reasonsFor({ databaseUrl: "mysql://u:p@localhost/womenchat_test" }).join("\n")).toMatch(/postgres/);
    expect(reasonsFor({ redisUrl: "http://localhost/15" }).join("\n")).toMatch(/redis:\/\//);
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
