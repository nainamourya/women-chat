import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests import config/env.ts and the database/Redis clients under
// controlled process.env values. dotenv, postgres and ioredis are replaced
// with spies, so nothing here can read a .env file or open a connection — the
// point of several tests is precisely that, on a bad target, no client is
// ever built and no query or command is ever issued.
const { dotenvConfig, postgresFactory, redisConstructor, postgresQuery, redisCommand } = vi.hoisted(() => {
  const postgresQuery = vi.fn();
  const redisCommand = vi.fn();
  return {
    dotenvConfig: vi.fn(() => ({ parsed: {} })),
    postgresQuery,
    redisCommand,
    postgresFactory: vi.fn(() => Object.assign(postgresQuery, { end: vi.fn(), options: { parsers: {}, serializers: {} } })),
    redisConstructor: vi.fn(function RedisMock() {
      return { on: vi.fn(), ping: redisCommand, quit: redisCommand, disconnect: vi.fn() };
    }),
  };
});

vi.mock("dotenv", () => ({ config: dotenvConfig }));
vi.mock("postgres", () => ({ default: postgresFactory }));
vi.mock("ioredis", () => ({ Redis: redisConstructor }));

const realEnv = process.env;

// Synthetic, complete environment. The safe test targets satisfy the guard;
// production-style hosts below are made up and never contacted.
const SAFE_TEST_TARGETS = {
  DATABASE_URL: "postgresql://womenchat:womenchat@localhost:5432/womenchat_test",
  REDIS_URL: "redis://localhost:6379/15",
  ALLOW_TEST_DB_WRITES: "1",
};
const FAKE_NEON = "postgresql://appuser:s3cretpw@ep-example-123456.ap-southeast-1.aws.neon.tech/neondb?sslmode=require";
const FAKE_UPSTASH = "rediss://default:s3cretpw@example-12345.upstash.io:6379";
const REST = {
  CORS_ORIGIN: "http://localhost:3000",
  INTERNAL_API_SECRET: "k3Jp9xQ2vLm8Zt5Wd7Rb1Hn4Yc6Fa0Gs",
  R2_ENDPOINT: "https://placeholder.r2.example",
  R2_BUCKET_NAME: "bucket",
  R2_ACCESS_KEY_ID: "key-id",
  R2_SECRET_ACCESS_KEY: "key-secret",
};

function useEnv(vars: Record<string, string | undefined>) {
  // Replace (not mutate) process.env so each test starts from nothing that the
  // surrounding shell or Vitest config exported.
  process.env = { ...vars } as NodeJS.ProcessEnv;
}

async function loadEnv() {
  vi.resetModules();
  return import("./env.js");
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
});

afterEach(() => {
  process.env = realEnv;
  vi.restoreAllMocks();
});

function loggedText(): string {
  return errorSpy.mock.calls.flat().join("\n");
}

describe("config/env — test mode (NODE_ENV=test)", () => {
  it("never reads a .env file", async () => {
    useEnv({ NODE_ENV: "test", ...SAFE_TEST_TARGETS, ...REST });
    await loadEnv();
    expect(dotenvConfig).not.toHaveBeenCalled();
  });

  it("accepts a local, opted-in test database and Redis", async () => {
    useEnv({ NODE_ENV: "test", ...SAFE_TEST_TARGETS, ...REST });
    const { env } = await loadEnv();
    expect(env.NODE_ENV).toBe("test");
  });

  it.each([
    ["no opt-in", { ...SAFE_TEST_TARGETS, ALLOW_TEST_DB_WRITES: undefined }, /opt-in is missing/],
    ["no database URL", { ...SAFE_TEST_TARGETS, DATABASE_URL: undefined }, /database URL is not configured/],
    ["no Redis URL", { ...SAFE_TEST_TARGETS, REDIS_URL: "" }, /Redis URL is not configured/],
    ["production-style Neon URL", { ...SAFE_TEST_TARGETS, DATABASE_URL: FAKE_NEON }, /hosted\/production service/],
    ["production-style Upstash URL", { ...SAFE_TEST_TARGETS, REDIS_URL: FAKE_UPSTASH }, /hosted\/production service/],
  ])("is rejected with a readable message: %s", async (_label, targets, expected) => {
    useEnv({ NODE_ENV: "test", ...targets, ...REST });
    await expect(loadEnv()).rejects.toThrow(expected);
    expect(dotenvConfig).not.toHaveBeenCalled();
  });

  it("does not put supplied URLs or credentials in the rejection", async () => {
    useEnv({ NODE_ENV: "test", ...SAFE_TEST_TARGETS, DATABASE_URL: FAKE_NEON, REDIS_URL: FAKE_UPSTASH, ...REST });
    const message = await loadEnv().then(
      () => "",
      (err: Error) => err.message,
    );
    expect(message).not.toBe("");
    for (const supplied of [FAKE_NEON, FAKE_UPSTASH, "s3cretpw", "appuser", "neon.tech", "upstash.io"]) {
      expect(message).not.toContain(supplied);
    }
  });
});

describe("config/env — a test runner is recognised even when NODE_ENV says otherwise", () => {
  it("under Vitest with NODE_ENV=development and a production-style URL: guarded, and .env is never read", async () => {
    // The repo's vitest.config.ts forces NODE_ENV=test; this is the case where
    // it was bypassed and the shell exported NODE_ENV=development.
    useEnv({ VITEST: "true", NODE_ENV: "development", ...SAFE_TEST_TARGETS, DATABASE_URL: FAKE_NEON, REDIS_URL: FAKE_UPSTASH, ...REST });
    await expect(loadEnv()).rejects.toThrow(/Refusing to run tests/);
    expect(dotenvConfig).not.toHaveBeenCalled();
  });

  it("under Vitest with no NODE_ENV and nothing configured: guarded, and .env is never read", async () => {
    useEnv({ VITEST: "true", ...REST });
    await expect(loadEnv()).rejects.toThrow(/Refusing to run tests/);
    expect(dotenvConfig).not.toHaveBeenCalled();
  });

  it("a .env that sets NODE_ENV=test cannot disable the guard by being read first", async () => {
    useEnv({ ...REST });
    dotenvConfig.mockImplementationOnce(() => {
      process.env.NODE_ENV = "test";
      process.env.DATABASE_URL = FAKE_NEON;
      process.env.REDIS_URL = FAKE_UPSTASH;
      return { parsed: {} };
    });
    await expect(loadEnv()).rejects.toThrow(/Refusing to run tests/);
    expect(dotenvConfig).toHaveBeenCalledTimes(1);
  });

  it("under Vitest with safe, opted-in targets it still starts", async () => {
    useEnv({ VITEST: "true", NODE_ENV: "development", ...SAFE_TEST_TARGETS, ...REST });
    const { env } = await loadEnv();
    expect(env.DATABASE_URL).toBe(SAFE_TEST_TARGETS.DATABASE_URL);
    expect(dotenvConfig).not.toHaveBeenCalled();
  });
});

describe("failed validation opens nothing — zero queries, zero Redis commands", () => {
  const unsafe = { NODE_ENV: "test", ...SAFE_TEST_TARGETS, DATABASE_URL: FAKE_NEON, REDIS_URL: FAKE_UPSTASH, ...REST };

  it("importing the database client against a production-style URL builds no client and runs no query", async () => {
    useEnv(unsafe);
    vi.resetModules();
    await expect(import("../db/client.js")).rejects.toThrow(/Refusing to run tests/);
    expect(postgresFactory).not.toHaveBeenCalled();
    expect(postgresQuery).not.toHaveBeenCalled();
  });

  it("importing the Redis client against a production-style URL builds no client and sends no command", async () => {
    useEnv(unsafe);
    vi.resetModules();
    await expect(import("../redis/client.js")).rejects.toThrow(/Refusing to run tests/);
    expect(redisConstructor).not.toHaveBeenCalled();
    expect(redisCommand).not.toHaveBeenCalled();
  });

  it("the shared Socket.IO Redis adapter is blocked the same way", async () => {
    useEnv(unsafe);
    vi.resetModules();
    await expect(import("../socket/redisAdapter.js")).rejects.toThrow(/Refusing to run tests/);
    expect(redisConstructor).not.toHaveBeenCalled();
  });

  it("with a safe target, the clients are built from the validated URLs (and only then)", async () => {
    useEnv({ NODE_ENV: "test", ...SAFE_TEST_TARGETS, ...REST });
    vi.resetModules();
    await import("../db/client.js");
    await import("../redis/client.js");
    expect(postgresFactory).toHaveBeenCalledWith(SAFE_TEST_TARGETS.DATABASE_URL);
    expect(redisConstructor).toHaveBeenCalledWith(SAFE_TEST_TARGETS.REDIS_URL);
  });
});

describe("config/env — NODE_ENV is explicit", () => {
  it("exits at startup when NODE_ENV is missing", async () => {
    useEnv({ ...SAFE_TEST_TARGETS, ...REST });
    await expect(loadEnv()).rejects.toThrow("process.exit(1)");
    expect(loggedText()).toMatch(/NODE_ENV must be set explicitly/);
  });

  it("exits at startup when NODE_ENV is invalid", async () => {
    useEnv({ NODE_ENV: "staging", ...SAFE_TEST_TARGETS, ...REST });
    await expect(loadEnv()).rejects.toThrow("process.exit(1)");
    expect(loggedText()).toMatch(/NODE_ENV/);
    expect(dotenvConfig).not.toHaveBeenCalled();
  });

  it("only reads .env when NODE_ENV is unset or development — so development can supply it", async () => {
    useEnv({ ...REST, DATABASE_URL: "postgresql://u:p@localhost/app", REDIS_URL: "redis://localhost:6379" });
    await expect(loadEnv()).rejects.toThrow("process.exit(1)");
    expect(dotenvConfig).toHaveBeenCalledTimes(1);
  });

  it("reads .env for an explicit NODE_ENV=development", async () => {
    useEnv({ NODE_ENV: "development", ...REST, DATABASE_URL: "postgresql://u:p@localhost/app", REDIS_URL: "redis://localhost:6379" });
    const { env } = await loadEnv();
    expect(env.NODE_ENV).toBe("development");
    expect(dotenvConfig).toHaveBeenCalledTimes(1);
  });

  it("never reads a .env file when NODE_ENV=production", async () => {
    useEnv({ NODE_ENV: "production", ...REST, DATABASE_URL: "postgresql://u:p@db.example.invalid/app", REDIS_URL: "redis://cache.example.invalid:6379" });
    const { env } = await loadEnv();
    expect(env.NODE_ENV).toBe("production");
    expect(dotenvConfig).not.toHaveBeenCalled();
  });

  it("refuses to start on Render with anything but NODE_ENV=production", async () => {
    useEnv({ RENDER: "true", NODE_ENV: "development", ...REST, DATABASE_URL: "postgresql://u:p@localhost/app", REDIS_URL: "redis://localhost:6379" });
    await expect(loadEnv()).rejects.toThrow("process.exit(1)");
    expect(loggedText()).toMatch(/requires NODE_ENV=production/);
  });

  it("rejects a weak production INTERNAL_API_SECRET without printing it", async () => {
    const weak = "replace-with-a-long-random-string-xyz9";
    useEnv({
      NODE_ENV: "production",
      ...REST,
      INTERNAL_API_SECRET: weak,
      DATABASE_URL: "postgresql://u:p@db.example.invalid/app",
      REDIS_URL: "redis://cache.example.invalid:6379",
    });
    await expect(loadEnv()).rejects.toThrow("process.exit(1)");
    expect(loggedText()).toMatch(/INTERNAL_API_SECRET/);
    expect(loggedText()).not.toContain(weak);
  });
});
