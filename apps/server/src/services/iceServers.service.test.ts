import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const originalEnv = process.env;

// Baseline values for env.ts's required fields — provided explicitly rather
// than relying on dotenv having already populated process.env by the time
// this file loads (test file load order isn't guaranteed).
const REQUIRED_ENV_BASELINE = {
  NODE_ENV: "test",
  // Synthetic, loopback-only targets that satisfy the test-target guard; this
  // file only imports the env module, so no connection is ever opened.
  ALLOW_TEST_DB_WRITES: "1",
  DATABASE_URL: "postgresql://test:test@localhost:5432/test",
  REDIS_URL: "redis://localhost:6379/15",
  CORS_ORIGIN: "http://localhost:3000",
  INTERNAL_API_SECRET: "test-internal-api-secret-value",
  R2_ENDPOINT: "https://placeholder.r2.cloudflarestorage.com",
  R2_BUCKET_NAME: "test-bucket",
  R2_ACCESS_KEY_ID: "test-access-key-id",
  R2_SECRET_ACCESS_KEY: "test-secret-access-key",
};

async function loadWithEnv(overrides: Record<string, string | undefined>) {
  vi.resetModules();
  process.env = { ...originalEnv, ...REQUIRED_ENV_BASELINE, ...overrides };
  const mod = await import("./iceServers.service.js");
  return mod.getIceServers;
}

describe("getIceServers", () => {
  beforeEach(() => {
    process.env = { ...originalEnv, ...REQUIRED_ENV_BASELINE };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("falls back to STUN-only when no TURN config is set", async () => {
    const getIceServers = await loadWithEnv({ TURN_URLS: undefined });
    const { iceServers, turnConfigured } = await getIceServers("user-1");

    expect(turnConfigured).toBe(false);
    expect(iceServers).toHaveLength(1);
    expect(iceServers[0].urls).toBe("stun:stun.l.google.com:19302");
  });

  it("mints a short-lived HMAC credential when a shared secret is configured", async () => {
    const getIceServers = await loadWithEnv({
      TURN_URLS: "turn:relay.example.com:80",
      TURN_STATIC_AUTH_SECRET: "test-secret",
    });
    const { iceServers, turnConfigured } = await getIceServers("user-1");

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

    const a = (await getIceServers("user-a")).iceServers[1];
    const b = (await getIceServers("user-b")).iceServers[1];
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
    const { iceServers, turnConfigured } = await getIceServers("user-1");

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
    const { iceServers, turnConfigured } = await getIceServers("user-1");

    expect(turnConfigured).toBe(false);
    expect(iceServers).toHaveLength(1);
  });

  it("uses metered.ca credentials when configured, taking precedence over TURN_URLS", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { urls: "stun:example.metered.live:80" },
        { urls: "turn:example.metered.live:80", username: "metered-user", credential: "metered-pass" },
      ],
    });
    vi.stubGlobal("fetch", fetchMock);

    const getIceServers = await loadWithEnv({
      METERED_TURN_APP_NAME: "example",
      METERED_TURN_API_KEY: "test-api-key",
      TURN_URLS: "turn:relay.example.com:80",
      TURN_STATIC_AUTH_SECRET: "test-secret",
    });
    const { iceServers, turnConfigured } = await getIceServers("user-1");

    expect(turnConfigured).toBe(true);
    // Our own STUN entry, plus metered's two entries — never the
    // TURN_URLS-based server, confirming metered.ca took precedence.
    expect(iceServers).toHaveLength(3);
    expect(iceServers.some((s) => s.username === "metered-user")).toBe(true);
    expect(iceServers.some((s) => Array.isArray(s.urls) && s.urls.includes("turn:relay.example.com:80"))).toBe(false);

    const requestedUrl = fetchMock.mock.calls[0][0] as URL;
    expect(requestedUrl.toString()).toContain("example.metered.live");
    expect(requestedUrl.searchParams.get("apiKey")).toBe("test-api-key");
  });

  it("falls back to TURN_URLS when the metered.ca request fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));

    const getIceServers = await loadWithEnv({
      METERED_TURN_APP_NAME: "example",
      METERED_TURN_API_KEY: "bad-key",
      TURN_URLS: "turn:relay.example.com:80",
      TURN_STATIC_AUTH_SECRET: "test-secret",
    });
    const { iceServers, turnConfigured } = await getIceServers("user-1");

    expect(turnConfigured).toBe(true);
    expect(iceServers[1].urls).toEqual(["turn:relay.example.com:80"]);
  });
});
