import { describe, it, expect, beforeEach, vi } from "vitest";

const originalEnv = process.env;

// Baseline values for env.ts's required fields — provided explicitly rather
// than relying on dotenv having already populated process.env by the time
// this file loads (test file load order isn't guaranteed).
const REQUIRED_ENV_BASELINE = {
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379",
  CORS_ORIGIN: "http://localhost:3000",
  INTERNAL_API_SECRET: "test-internal-api-secret-value",
};

async function loadWithEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...REQUIRED_ENV_BASELINE, ...originalEnv, ...overrides };
  const mod = await import("./iceServers.service.js");
  return mod.getIceServers;
}

describe("getIceServers", () => {
  beforeEach(() => {
    process.env = { ...REQUIRED_ENV_BASELINE, ...originalEnv };
  });

  it("falls back to STUN-only when no TURN config is set", async () => {
    const getIceServers = await loadWithEnv({ TURN_URLS: undefined });
    const { iceServers, turnConfigured } = getIceServers("user-1");

    expect(turnConfigured).toBe(false);
    expect(iceServers).toHaveLength(1);
    expect(iceServers[0].urls).toBe("stun:stun.l.google.com:19302");
  });

  it("mints a short-lived HMAC credential when a shared secret is configured", async () => {
    const getIceServers = await loadWithEnv({
      TURN_URLS: "turn:relay.example.com:80",
      TURN_STATIC_AUTH_SECRET: "test-secret",
    });
    const { iceServers, turnConfigured } = getIceServers("user-1");

    expect(turnConfigured).toBe(true);
    expect(iceServers).toHaveLength(2);
    const turnServer = iceServers[1];
    expect(turnServer.urls).toEqual(["turn:relay.example.com:80"]);
    expect(turnServer.username).toMatch(/^\d+:user-1$/);
    expect(typeof turnServer.credential).toBe("string");
    expect(turnServer.credential!.length).toBeGreaterThan(0);
  });

  it("produces different credentials for different user labels", async () => {
    const getIceServers = await loadWithEnv({
      TURN_URLS: "turn:relay.example.com:80",
      TURN_STATIC_AUTH_SECRET: "test-secret",
    });

    const a = getIceServers("user-a").iceServers[1];
    const b = getIceServers("user-b").iceServers[1];
    expect(a.username).not.toBe(b.username);
    expect(a.credential).not.toBe(b.credential);
  });

  it("falls back to a static username/credential pair when no shared secret is set", async () => {
    const getIceServers = await loadWithEnv({
      TURN_URLS: "turn:relay.example.com:80",
      TURN_STATIC_AUTH_SECRET: undefined,
      TURN_STATIC_USERNAME: "static-user",
      TURN_STATIC_CREDENTIAL: "static-pass",
    });
    const { iceServers, turnConfigured } = getIceServers("user-1");

    expect(turnConfigured).toBe(true);
    expect(iceServers[1]).toMatchObject({
      urls: ["turn:relay.example.com:80"],
      username: "static-user",
      credential: "static-pass",
    });
  });

  it("treats TURN as unconfigured (STUN-only) when URLs are set but no credentials are", async () => {
    const getIceServers = await loadWithEnv({
      TURN_URLS: "turn:relay.example.com:80",
      TURN_STATIC_AUTH_SECRET: undefined,
      TURN_STATIC_USERNAME: undefined,
      TURN_STATIC_CREDENTIAL: undefined,
    });
    const { iceServers, turnConfigured } = getIceServers("user-1");

    expect(turnConfigured).toBe(false);
    expect(iceServers).toHaveLength(1);
  });
});
