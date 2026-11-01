import { createHmac, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMp4Buffer } from "../../server/src/testUtils/fakeVideo";
import { DEFAULT_TEST_VARS, TEST_INTERNAL_SECRET, TEST_ORIGIN, guardedTestDatabaseUrl, startLocalWorker, type RunningWorker } from "./localWorker";
import { Fixtures } from "./seed";

// Security-hardening review of the direct upload flow: the limit on minting
// authorizations, the claim/validation lifecycle, cleanup, and what gets logged.
// Local wrangler simulation + local Postgres only; it says nothing about real
// Cloudflare behavior.
let currentUser = "";
vi.mock("@/lib/auth", () => ({ auth: async () => (currentUser ? { user: { id: currentUser } } : null) }));

const UPLOAD_SECRET = "hardening-upload-signing-secret-0123456789";
const SECRET_HEADER = { "x-internal-api-secret": TEST_INTERNAL_SECRET };
const MAX_BYTES = 5_000;
const CHECK = "/api/verification/video-authorization/check";

let worker: RunningWorker;
let fx: Fixtures;
let sql: ReturnType<typeof postgres>;
let authorize: (req: Request) => Promise<Response>;
const usedTokens: string[] = [];

beforeAll(async () => {
  fx = new Fixtures();
  sql = postgres(guardedTestDatabaseUrl(), { max: 1 });
  worker = await startLocalWorker(8873, {
    testHooks: true,
    captureLogs: true,
    vars: { ...DEFAULT_TEST_VARS, VERIFICATION_VIDEO_MAX_BYTES: String(MAX_BYTES), UPLOAD_TOKEN_SECRET: UPLOAD_SECRET },
  });
  process.env.SERVER_URL = worker.baseUrl;
  process.env.INTERNAL_API_SECRET = TEST_INTERNAL_SECRET;
  process.env.UPLOAD_TOKEN_SECRET = UPLOAD_SECRET;
  ({ POST: authorize } = await import("../../web/src/app/api/verification/video/authorize/route"));
}, 180_000);
afterAll(async () => {
  worker?.stop();
  await sql?.unsafe("drop trigger if exists edge_test_fail_user_update on users").catch(() => {});
  await sql?.unsafe("drop function if exists edge_test_fail_user_update()").catch(() => {});
  await sql?.end();
  await fx?.cleanup();
});

const now = () => Math.floor(Date.now() / 1000);
function sign(claims: Record<string, unknown>) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", UPLOAD_SECRET).update("giigirl-verification-upload.v1." + payload).digest("base64url");
  const token = `v1.${payload}.${sig}`;
  usedTokens.push(token);
  return token;
}
const claimsFor = (sub: string, len: number, over: Record<string, unknown> = {}) => ({
  sub, jti: randomUUID(), iat: now(), exp: now() + 120, ct: "video/mp4", len, ...over,
});

async function put(token: string, body: Buffer) {
  const res = await fetch(`${worker.baseUrl}/api/verification/video-upload`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, origin: TEST_ORIGIN, "content-type": "video/mp4", "x-acknowledged-notice": "true" },
    body,
  });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
}
const check = (payload: unknown, headers: Record<string, string> = SECRET_HEADER, method = "POST") =>
  fetch(`${worker.baseUrl}${CHECK}`, { method, headers: { "content-type": "application/json", ...headers }, body: method === "GET" ? undefined : JSON.stringify(payload) });
const statusOf = async (userId: string) =>
  ((await (await fetch(`${worker.baseUrl}/api/verification/video/status/${userId}`, { headers: SECRET_HEADER })).json()) as any).submission;
const objectKeys = async () =>
  (((await (await fetch(`${worker.baseUrl}/__test__/r2/list`, { headers: SECRET_HEADER })).json()) as any).objects as Array<{ key: string }>)
    .map((o) => o.key)
    .filter((k) => /^[0-9a-f-]{36}\.(mp4|webm|mov)$/.test(k));

describe("limit on minting upload authorizations (backend limiter)", () => {
  it("requires the internal secret and a POST", async () => {
    expect((await check({ userId: randomUUID() }, {})).status).toBe(401);
    expect((await check({ userId: randomUUID() }, { "x-internal-api-secret": "wrong" })).status).toBe(401);
    expect((await check({ userId: randomUUID() }, SECRET_HEADER, "GET")).status).toBe(405);
  });

  it.each([
    ["no body fields", {}],
    ["a non-uuid user", { userId: "not-a-user" }],
    ["a non-string user", { userId: 5 }],
    ["a malformed ip", { userId: randomUUID(), ip: "999.1.1.1" }],
    ["an ip with injected text", { userId: randomUUID(), ip: "1.1.1.1, 2.2.2.2" }],
    ["a non-string ip", { userId: randomUUID(), ip: 5 }],
  ])("400s for %s", async (_name, payload) => {
    expect((await check(payload)).status).toBe(400);
  });

  it("400s for an oversized body and for non-JSON", async () => {
    expect((await check({ userId: randomUUID(), pad: "x".repeat(2000) })).status).toBe(400);
    const res = await fetch(`${worker.baseUrl}${CHECK}`, { method: "POST", headers: SECRET_HEADER, body: "{nope" });
    expect(res.status).toBe(400);
  });

  it("allows 10 per user per hour, then 429 with a sensible Retry-After; other users are unaffected", async () => {
    const user = randomUUID();
    for (let i = 0; i < 10; i++) expect((await check({ userId: user })).status).toBe(200);
    const blocked = await check({ userId: user });
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get("retry-after"));
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(3600);
    expect(((await blocked.json()) as any).error).toMatch(/too many/i);
    expect((await check({ userId: randomUUID() })).status).toBe(200);
  });

  it("counts a user id case-insensitively (one counter, not two)", async () => {
    const user = randomUUID();
    for (let i = 0; i < 10; i++) expect((await check({ userId: i % 2 ? user.toUpperCase() : user })).status).toBe(200);
    expect((await check({ userId: user })).status).toBe(429);
  });

  it("allows 30 per address per hour across different users, counting the address case-insensitively", async () => {
    for (let i = 0; i < 30; i++) {
      const ip = i % 2 ? "2001:DB8::7" : "2001:db8::7";
      expect((await check({ userId: randomUUID(), ip })).status).toBe(200);
    }
    expect((await check({ userId: randomUUID(), ip: "2001:db8::7" })).status).toBe(429);
    expect((await check({ userId: randomUUID(), ip: "2001:db8::8" })).status).toBe(200); // a different address
    expect((await check({ userId: randomUUID() })).status).toBe(200); // no address supplied: user limit only
  });

  it("is enforced through the real web authorize route: the 11th request in the hour is a 429 and mints nothing", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    currentUser = member.id;
    const mint = () => authorize(new Request("http://web.invalid/a", { method: "POST", body: JSON.stringify({ contentType: "video/mp4", size: 100 }) }));
    for (let i = 0; i < 10; i++) expect((await mint()).status).toBe(200);
    const res = await mint();
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(((await res.json()) as any).token).toBeUndefined();
  });
});

describe("token lifecycle", () => {
  it("rejects a token whose expiry is before its issue time", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const token = sign(claimsFor(member.id, video.length, { iat: now() + 20, exp: now() + 10 }));
    expect((await put(token, video)).status).toBe(401);
    expect(await statusOf(member.id)).toBeNull();
  });

  it("every failure after the claim needs a fresh token (the claim is never refunded)", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const junk = Buffer.from("not a video at all, only text ".repeat(10));
    const token = sign(claimsFor(member.id, junk.length));
    expect((await put(token, junk)).status).toBe(400); // fails validation after the claim
    expect((await put(token, junk)).status).toBe(401); // same token: gone
  });
});

describe("cleanup and consistency after the upload", () => {
  it("leaves no object behind when the bytes are not a video or a second submission is refused", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const before = (await objectKeys()).length;
    const junk = Buffer.from("not a video at all, only text ".repeat(10));
    expect((await put(sign(claimsFor(member.id, junk.length)), junk)).status).toBe(400);
    expect((await objectKeys()).length).toBe(before);

    const video = buildMp4Buffer(10);
    expect((await put(sign(claimsFor(member.id, video.length)), video)).status).toBe(201);
    expect((await objectKeys()).length).toBe(before + 1);
    expect((await put(sign(claimsFor(member.id, video.length)), video)).status).toBe(409);
    expect((await objectKeys()).length).toBe(before + 1); // only the first video remains
  });

  it("keeps the video when the submission row exists but the status update fails (regression: it used to be deleted)", async () => {
    const email = `edge-trigger-${randomUUID().slice(0, 8)}@example.test`;
    const member = await fx.member({ verificationStatus: "unverified", email });
    await sql.unsafe(`
      create or replace function edge_test_fail_user_update() returns trigger as $$
      begin
        if new.email = '${email}' then raise exception 'edge test: forced failure'; end if;
        return new;
      end $$ language plpgsql`);
    await sql.unsafe("create trigger edge_test_fail_user_update before update on users for each row execute function edge_test_fail_user_update()");
    try {
      const before = (await objectKeys()).length;
      const video = buildMp4Buffer(10);
      const res = await put(sign(claimsFor(member.id, video.length)), video);
      expect(res.status).toBe(500);
      // The row references the object, so the object must still be there.
      expect((await statusOf(member.id)).status).toBe("pending_review");
      expect((await objectKeys()).length).toBe(before + 1);
    } finally {
      await sql.unsafe("drop trigger if exists edge_test_fail_user_update on users");
    }
  });
});

describe("what the Worker logs", () => {
  it("never contains a token, a secret, or a storage key", async () => {
    const logs = worker.logs();
    expect(logs.length).toBeGreaterThan(0); // capture works (wrangler's own output is there)
    for (const token of usedTokens) {
      expect(logs).not.toContain(token);
      expect(logs).not.toContain(token.split(".")[1]); // not even the payload
    }
    expect(logs).not.toContain(UPLOAD_SECRET);
    expect(logs).not.toContain(TEST_INTERNAL_SECRET);
    for (const key of await objectKeys()) expect(logs).not.toContain(key);
  });
});
