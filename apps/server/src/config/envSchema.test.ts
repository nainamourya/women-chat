import { describe, expect, it } from "vitest";
import { PRODUCTION_INTERNAL_SECRET_MIN_LENGTH, parseEnv } from "./envSchema.js";

// Synthetic values only. A strong-looking, non-placeholder secret for the
// production cases; nothing here is a real credential.
const STRONG_SECRET = "k3Jp9xQ2vLm8Zt5Wd7Rb1Hn4Yc6Fa0Gs";

const base = {
  DATABASE_URL: "postgresql://u:p@db.example.invalid:5432/app",
  REDIS_URL: "redis://cache.example.invalid:6379/0",
  CORS_ORIGIN: "https://app.example.invalid",
  INTERNAL_API_SECRET: STRONG_SECRET,
  R2_ENDPOINT: "https://placeholder.r2.example",
  R2_BUCKET_NAME: "bucket",
  R2_ACCESS_KEY_ID: "key-id",
  R2_SECRET_ACCESS_KEY: "key-secret",
};

function parse(overrides: Record<string, string | undefined>) {
  return parseEnv({ ...base, ...overrides });
}

function errorsOf(overrides: Record<string, string | undefined>): string[] {
  const result = parse(overrides);
  if (result.success) throw new Error("expected parseEnv to fail");
  return result.errors;
}

describe("parseEnv — NODE_ENV is explicit and fail-closed", () => {
  it("rejects a missing NODE_ENV instead of defaulting to development", () => {
    const errors = errorsOf({ NODE_ENV: undefined });
    expect(errors.join("\n")).toMatch(/NODE_ENV: NODE_ENV must be set explicitly/);
  });

  it.each(["", "staging", "Production", "prod", " production", "dev"])("rejects invalid NODE_ENV %j", (value) => {
    expect(errorsOf({ NODE_ENV: value }).join("\n")).toMatch(/NODE_ENV/);
  });

  it.each(["development", "test", "production"] as const)("accepts NODE_ENV=%s", (value) => {
    const result = parse({ NODE_ENV: value });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.NODE_ENV).toBe(value);
  });
});

describe("parseEnv — INTERNAL_API_SECRET", () => {
  it("keeps the existing 16-character minimum for development and test", () => {
    for (const NODE_ENV of ["development", "test"]) {
      expect(parse({ NODE_ENV, INTERNAL_API_SECRET: "a".repeat(15) }).success).toBe(false);
      expect(parse({ NODE_ENV, INTERNAL_API_SECRET: "test-secret-value-ok" }).success).toBe(true);
    }
  });

  it("requires a longer secret in production", () => {
    const short = "k3Jp9xQ2vLm8Zt5Wd7Rb1Hn4Yc6F"; // 29 chars
    expect(short.length).toBeLessThan(PRODUCTION_INTERNAL_SECRET_MIN_LENGTH);
    expect(errorsOf({ NODE_ENV: "production", INTERNAL_API_SECRET: short }).join("\n")).toMatch(/at least 32 chars in production/);
    expect(parse({ NODE_ENV: "production", INTERNAL_API_SECRET: STRONG_SECRET }).success).toBe(true);
  });

  it("rejects repetitive and placeholder secrets in production, but not elsewhere", () => {
    const repetitive = "ab".repeat(20);
    const placeholder = "replace-with-a-long-random-string-xyz9";
    expect(errorsOf({ NODE_ENV: "production", INTERNAL_API_SECRET: repetitive }).join("\n")).toMatch(/too repetitive/);
    expect(errorsOf({ NODE_ENV: "production", INTERNAL_API_SECRET: placeholder }).join("\n")).toMatch(/looks like a placeholder/);
    expect(parse({ NODE_ENV: "development", INTERNAL_API_SECRET: placeholder }).success).toBe(true);
  });

  it("never echoes the secret in an error message", () => {
    const bad = "replace-with-a-long-random-string-xyz9";
    const joined = errorsOf({ NODE_ENV: "production", INTERNAL_API_SECRET: bad }).join("\n");
    expect(joined).not.toContain(bad);
    const short = errorsOf({ NODE_ENV: "development", INTERNAL_API_SECRET: "tiny-secret" }).join("\n");
    expect(short).not.toContain("tiny-secret");
  });
});

describe("parseEnv — MEDIA_LOCAL_DIR (local-disk image storage)", () => {
  it("is accepted in development", () => {
    expect(parse({ NODE_ENV: "development", MEDIA_LOCAL_DIR: "./local-media" }).success).toBe(true);
  });

  it.each(["production", "test"])("is rejected when NODE_ENV=%s, so it can never be active there", (NODE_ENV) => {
    expect(errorsOf({ NODE_ENV, MEDIA_LOCAL_DIR: "./local-media" }).join(" ")).toMatch(/MEDIA_LOCAL_DIR is only allowed when NODE_ENV=development/);
  });

  it("is optional", () => {
    expect(parse({ NODE_ENV: "production" }).success).toBe(true);
  });
});

describe("parseEnv — hosting platform", () => {
  it("refuses to start on Render unless NODE_ENV=production", () => {
    for (const NODE_ENV of ["development", "test", undefined]) {
      expect(errorsOf({ RENDER: "true", NODE_ENV }).join("\n")).toMatch(/requires NODE_ENV=production/);
    }
    expect(parse({ RENDER: "true", NODE_ENV: "production" }).success).toBe(true);
  });

  it("is unaffected when not on a hosting platform", () => {
    expect(parse({ NODE_ENV: "development" }).success).toBe(true);
  });
});

describe("parseEnv — other required settings still enforced", () => {
  it("reports missing required variables by name without values", () => {
    const errors = errorsOf({ NODE_ENV: "development", DATABASE_URL: undefined, R2_ENDPOINT: "" });
    const joined = errors.join("\n");
    expect(joined).toMatch(/DATABASE_URL/);
    expect(joined).toMatch(/R2_ENDPOINT/);
  });
});
