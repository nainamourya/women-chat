import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_TEST_VARS, TEST_INTERNAL_SECRET, startLocalWorker, type RunningWorker } from "./localWorker";
import { Fixtures } from "./seed";

// Web Push subscription endpoints on the Worker (local test database only).
// Nothing here contacts a real push service.
const SECRET = { "x-internal-api-secret": TEST_INTERNAL_SECRET };

// A throwaway VAPID pair generated only for these tests.
async function testVapidVars() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  const pub = Buffer.from((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer).toString("base64url");
  const d = ((await crypto.subtle.exportKey("jwk", pair.privateKey)) as JsonWebKey).d!;
  return { VAPID_PUBLIC_KEY: pub, VAPID_PRIVATE_KEY: d, VAPID_SUBJECT: "mailto:support@giigirl.com" };
}

async function browserKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    p256dh: Buffer.from((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer).toString("base64url"),
    auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("base64url"),
  };
}

const fcmEndpoint = () => `https://fcm.googleapis.com/fcm/send/edge-test-${randomUUID()}`;

let configured: RunningWorker;
let unconfigured: RunningWorker;
let fx: Fixtures;
let publicKey: string;

beforeAll(async () => {
  fx = new Fixtures();
  const vapid = await testVapidVars();
  publicKey = vapid.VAPID_PUBLIC_KEY;
  configured = await startLocalWorker(8870, { vars: { ...DEFAULT_TEST_VARS, ...vapid } });
  unconfigured = await startLocalWorker(8871);
});
afterAll(async () => {
  configured?.stop();
  unconfigured?.stop();
  await fx?.cleanup();
});

async function call(worker: RunningWorker, method: string, path: string, opts: { viewer?: string; secret?: boolean; body?: unknown } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.secret !== false) Object.assign(headers, SECRET);
  if (opts.viewer) headers["x-viewer-id"] = opts.viewer;
  const res = await fetch(`${worker.baseUrl}/api/push${path}`, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
}

describe("GET /api/push/public-key", () => {
  it("needs the internal secret", async () => {
    expect((await call(configured, "GET", "/public-key", { secret: false })).status).toBe(401);
  });

  it("returns the configured public key", async () => {
    const res = await call(configured, "GET", "/public-key");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ publicKey });
  });

  it("is 404 when push is not configured (the app then hides the option)", async () => {
    expect((await call(unconfigured, "GET", "/public-key")).status).toBe(404);
  });
});

describe("POST /api/push/subscribe and /unsubscribe", () => {
  it("needs the internal secret and a viewer id", async () => {
    const body = { endpoint: fcmEndpoint(), keys: await browserKeys() };
    expect((await call(configured, "POST", "/subscribe", { secret: false, body })).status).toBe(401);
    expect((await call(configured, "POST", "/subscribe", { body })).status).toBe(401);
    expect((await call(configured, "POST", "/subscribe", { viewer: "not-a-uuid", body })).status).toBe(401);
  });

  it("refuses endpoints that are not a real push service, and malformed keys", async () => {
    const member = await fx.member();
    const keys = await browserKeys();
    for (const endpoint of ["https://evil.example/push", "http://fcm.googleapis.com/x", "https://fcm.googleapis.com.evil.example/x"]) {
      expect((await call(configured, "POST", "/subscribe", { viewer: member.id, body: { endpoint, keys } })).status).toBe(400);
    }
    const endpoint = fcmEndpoint();
    expect((await call(configured, "POST", "/subscribe", { viewer: member.id, body: { endpoint, keys: { ...keys, p256dh: "AAAA" } } })).status).toBe(400);
    expect((await call(configured, "POST", "/subscribe", { viewer: member.id, body: { endpoint, keys: { ...keys, auth: "AA" } } })).status).toBe(400);
    expect(await fx.pushEndpoints(member.id)).toEqual([]);
  });

  it("saves a device once (re-subscribing is idempotent) and removes it on unsubscribe", async () => {
    const member = await fx.member();
    const endpoint = fcmEndpoint();
    const keys = await browserKeys();
    expect((await call(configured, "POST", "/subscribe", { viewer: member.id, body: { endpoint, keys } })).status).toBe(201);
    expect((await call(configured, "POST", "/subscribe", { viewer: member.id, body: { endpoint, keys } })).status).toBe(201);
    expect(await fx.pushEndpoints(member.id)).toEqual([endpoint]);

    expect((await call(configured, "POST", "/unsubscribe", { viewer: member.id, body: { endpoint } })).status).toBe(200);
    expect(await fx.pushEndpoints(member.id)).toEqual([]);
  });

  it("a shared device moves to whoever subscribed last, and nobody can remove another member's device", async () => {
    const alice = await fx.member();
    const bea = await fx.member();
    const endpoint = fcmEndpoint();
    const keys = await browserKeys();

    await call(configured, "POST", "/subscribe", { viewer: alice.id, body: { endpoint, keys } });
    await call(configured, "POST", "/subscribe", { viewer: bea.id, body: { endpoint, keys } });
    expect(await fx.pushEndpoints(alice.id)).toEqual([]);
    expect(await fx.pushEndpoints(bea.id)).toEqual([endpoint]);

    // Alice cannot unsubscribe Bea's device.
    await call(configured, "POST", "/unsubscribe", { viewer: alice.id, body: { endpoint } });
    expect(await fx.pushEndpoints(bea.id)).toEqual([endpoint]);
  });

  it("keeps at most 10 devices per member (the newest)", async () => {
    const member = await fx.member();
    const endpoints: string[] = [];
    for (let i = 0; i < 12; i++) {
      const endpoint = fcmEndpoint();
      endpoints.push(endpoint);
      await call(configured, "POST", "/subscribe", { viewer: member.id, body: { endpoint, keys: await browserKeys() } });
    }
    const saved = await fx.pushEndpoints(member.id);
    expect(saved).toHaveLength(10);
    expect(saved).toEqual(endpoints.slice(2).sort());
  });
});
