import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildMp4Buffer } from "../../server/src/testUtils/fakeVideo";
import { DEFAULT_TEST_VARS, TEST_INTERNAL_SECRET, TEST_ORIGIN, startLocalWorker, type RunningWorker } from "./localWorker";
import { Fixtures } from "./seed";

// Direct browser -> Worker verification video upload (src/directUpload.ts). Tokens
// are minted by the web app's real authorize route (apps/web/.../authorize/route.ts,
// only the session lookup is replaced), so the two sides' token formats are tested
// against each other. Runs on wrangler's local simulation and local Postgres, so it
// proves nothing about real Cloudflare behavior or about the browser.
let currentUser = "";
vi.mock("@/lib/auth", () => ({ auth: async () => (currentUser ? { user: { id: currentUser } } : null) }));

const UPLOAD_SECRET = "upload-signing-secret-for-tests-0123456789";
const SECRET_HEADER = { "x-internal-api-secret": TEST_INTERNAL_SECRET };
const SHARED = "one-secret-used-for-both-purposes-0123456789";
const MAX_BYTES = 5_000;
const VAR_BASE = { ...DEFAULT_TEST_VARS, VERIFICATION_VIDEO_MAX_BYTES: String(MAX_BYTES) };

let worker: RunningWorker;
let unconfigured: RunningWorker;
let reusedSecret: RunningWorker;
let fx: Fixtures;
let authorize: (req: Request) => Promise<Response>;

beforeAll(async () => {
  fx = new Fixtures();
  worker = await startLocalWorker(8870, { testHooks: true, vars: { ...VAR_BASE, UPLOAD_TOKEN_SECRET: UPLOAD_SECRET } });
  unconfigured = await startLocalWorker(8871, { vars: { ...VAR_BASE } });
  reusedSecret = await startLocalWorker(8872, { vars: { ...VAR_BASE, INTERNAL_API_SECRET: SHARED, UPLOAD_TOKEN_SECRET: SHARED } });
  process.env.SERVER_URL = worker.baseUrl;
  process.env.INTERNAL_API_SECRET = TEST_INTERNAL_SECRET;
  process.env.UPLOAD_TOKEN_SECRET = UPLOAD_SECRET;
  ({ POST: authorize } = await import("../../web/src/app/api/verification/video/authorize/route"));
}, 240_000);
afterAll(async () => {
  worker?.stop();
  unconfigured?.stop();
  reusedSecret?.stop();
  await fx?.cleanup();
});

type Auth = { uploadUrl: string; token: string; expiresAt: string };
async function authorization(userId: string, contentType: string, size: number): Promise<Auth> {
  currentUser = userId;
  const res = await authorize(new Request("http://web.invalid/a", { method: "POST", body: JSON.stringify({ contentType, size }) }));
  expect(res.status).toBe(200);
  return (await res.json()) as Auth;
}

// A hand-signed token, for forging expired / over-long / foreign ones.
function sign(claims: Record<string, unknown>, secret = UPLOAD_SECRET) {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const sig = createHmac("sha256", secret).update("giigirl-verification-upload.v1." + payload).digest("base64url");
  return `v1.${payload}.${sig}`;
}
const now = () => Math.floor(Date.now() / 1000);
const claimsFor = (sub: string, size: number, over: Record<string, unknown> = {}) => ({
  sub, jti: randomUUID(), iat: now(), exp: now() + 120, ct: "video/mp4", len: size, ...over,
});

async function put(
  token: string | null,
  body: Buffer,
  opts: { base?: string; type?: string; ack?: boolean; origin?: string | null; auth?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": opts.type ?? "video/mp4",
    "x-acknowledged-notice": opts.ack === false ? "false" : "true",
  };
  if (token) headers.authorization = opts.auth ?? `Bearer ${token}`;
  if (opts.origin !== null) headers.origin = opts.origin ?? TEST_ORIGIN;
  const res = await fetch(`${opts.base ?? worker.baseUrl}/api/verification/video-upload`, { method: "PUT", headers, body });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any, headers: res.headers };
}

const statusOf = async (userId: string) =>
  ((await (await fetch(`${worker.baseUrl}/api/verification/video/status/${userId}`, { headers: SECRET_HEADER })).json()) as any).submission;
const r2Objects = async () =>
  (((await (await fetch(`${worker.baseUrl}/__test__/r2/list`, { headers: SECRET_HEADER })).json()) as any).objects as Array<{ key: string }>).filter(
    (o) => /^[0-9a-f-]{36}\.(mp4|webm|mov)$/.test(o.key),
  ).length;

describe("authorization from the web app, then a direct upload", () => {
  it("uploads a real MP4 straight to the Worker and answers with CORS for the web origin only", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const auth = await authorization(member.id, "video/mp4", video.length);
    expect(auth.uploadUrl).toBe(`${worker.baseUrl}/api/verification/video-upload`);

    const before = await r2Objects();
    const res = await put(auth.token, video);
    expect(res.status).toBe(201);
    expect(res.body.submission.status).toBe("pending_review");
    expect(res.body.submission.videoStorageKey).toBeUndefined();
    expect(res.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
    expect(await r2Objects()).toBe(before + 1);
    expect((await statusOf(member.id)).status).toBe("pending_review");
  });

  it("a token is single use: replaying it fails and stores nothing more", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const auth = await authorization(member.id, "video/mp4", video.length);
    expect((await put(auth.token, video)).status).toBe(201);
    const objects = await r2Objects();
    expect((await put(auth.token, video)).status).toBe(401);
    expect(await r2Objects()).toBe(objects);
  });

  it("two simultaneous uses of one token: exactly one wins", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const auth = await authorization(member.id, "video/mp4", video.length);
    const before = await r2Objects();
    const results = await Promise.all([put(auth.token, video), put(auth.token, video), put(auth.token, video)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 401, 401]);
    expect(await r2Objects()).toBe(before + 1);
  });

  it("a token cannot upload as another user", async () => {
    const alice = await fx.member({ verificationStatus: "unverified" });
    const bob = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const auth = await authorization(alice.id, "video/mp4", video.length);

    // Swapping the user id inside the signed payload breaks the signature.
    const [v, payload, sig] = auth.token.split(".");
    const forged = JSON.parse(Buffer.from(payload, "base64url").toString());
    forged.sub = bob.id;
    expect((await put(`${v}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${sig}`, video)).status).toBe(401);

    // The genuine token only ever creates alice's submission.
    expect((await put(auth.token, video)).status).toBe(201);
    expect((await statusOf(alice.id)).status).toBe("pending_review");
    expect(await statusOf(bob.id)).toBeNull();
  });

  it("the web route authorizes the session user only, whatever the client sends", async () => {
    const real = await fx.member({ verificationStatus: "unverified" });
    const other = await fx.member({ verificationStatus: "unverified" });
    currentUser = real.id;
    const res = await authorize(
      new Request("http://web.invalid/a", { method: "POST", body: JSON.stringify({ contentType: "video/mp4", size: 100, userId: other.id }) }),
    );
    const claims = JSON.parse(Buffer.from(((await res.json()) as Auth).token.split(".")[1], "base64url").toString());
    expect(claims.sub).toBe(real.id);
  });
});

describe("what a token does not authorize", () => {
  it("rejects a different content type or length without spending the token", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const auth = await authorization(member.id, "video/mp4", video.length);
    expect((await put(auth.token, video, { type: "video/webm" })).status).toBe(400);
    expect((await put(auth.token, Buffer.concat([video, Buffer.from([0])]))).status).toBe(400);
    expect((await put(auth.token, video)).status).toBe(201); // the authorized upload still works
  });

  it("enforces the server's size limit even when the token declares a bigger length", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const big = Buffer.alloc(MAX_BYTES + 1, 7);
    const token = sign(claimsFor(member.id, big.length));
    const before = await r2Objects();
    const res = await put(token, big);
    expect(res.status).toBe(400);
    expect(await r2Objects()).toBe(before);
  });

  it("still requires the acknowledgement and still validates the video itself", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const noAck = await put(sign(claimsFor(member.id, video.length)), video, { ack: false });
    expect(noAck.status).toBe(400);
    const junk = Buffer.from("this is not a video at all, only text ".repeat(10));
    const bad = await put(sign(claimsFor(member.id, junk.length)), junk);
    expect(bad.status).toBe(400);
    expect(await statusOf(member.id)).toBeNull();
  });

  it("still refuses a second pending submission", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    expect((await put(sign(claimsFor(member.id, video.length)), video)).status).toBe(201);
    expect((await put(sign(claimsFor(member.id, video.length)), video)).status).toBe(409);
  });
});

describe("invalid authorizations", () => {
  const video = buildMp4Buffer(10);
  it.each([
    ["no Authorization header", () => null],
    ["an expired token", (u: string) => sign(claimsFor(u, video.length, { iat: now() - 400, exp: now() - 100 }))],
    ["a token that lives longer than any we issue", (u: string) => sign(claimsFor(u, video.length, { exp: now() + 3600 }))],
    ["a token issued in the future", (u: string) => sign(claimsFor(u, video.length, { iat: now() + 600, exp: now() + 700 }))],
    ["a token signed with another secret", (u: string) => sign(claimsFor(u, video.length), "another-secret-another-secret-another!")],
    ["a token signed with the internal secret", (u: string) => sign(claimsFor(u, video.length), TEST_INTERNAL_SECRET)],
    ["a token without a jti", (u: string) => sign({ sub: u, iat: now(), exp: now() + 60, ct: "video/mp4", len: video.length })],
    ["a token for a disallowed type", (u: string) => sign(claimsFor(u, video.length, { ct: "application/pdf" }))],
    ["garbage", () => "v1.not.a-token"],
    ["the internal secret itself", () => TEST_INTERNAL_SECRET],
  ])("401s for %s", async (_name, make) => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const token = make(member.id);
    const res = await put(token, video);
    expect(res.status).toBe(401);
    expect(await statusOf(member.id)).toBeNull();
  });

  it("401s for a token sent in the wrong scheme", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const token = sign(claimsFor(member.id, video.length));
    expect((await put(token, video, { auth: `Basic ${token}` })).status).toBe(401);
  });

  it("does not accept the internal secret header on this route", async () => {
    const res = await fetch(`${worker.baseUrl}/api/verification/video-upload`, {
      method: "PUT",
      headers: { ...SECRET_HEADER, "content-type": "video/mp4", "x-acknowledged-notice": "true" },
      body: video,
    });
    expect(res.status).toBe(401);
  });
});

describe("CORS", () => {
  const preflight = (origin: string | null) =>
    fetch(`${worker.baseUrl}/api/verification/video-upload`, {
      method: "OPTIONS",
      headers: { ...(origin ? { origin } : {}), "access-control-request-method": "PUT", "access-control-request-headers": "authorization,content-type" },
    });

  it("answers a preflight for the configured origin only, without credentials or a wildcard", async () => {
    const ok = await preflight(TEST_ORIGIN);
    expect(ok.status).toBe(204);
    expect(ok.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
    expect(ok.headers.get("access-control-allow-methods")).toBe("PUT");
    expect(ok.headers.get("access-control-allow-headers")).toContain("authorization");
    expect(ok.headers.get("access-control-allow-credentials")).toBeNull();
    expect(ok.headers.get("vary")).toContain("Origin");

    for (const origin of ["https://evil.example", "http://localhost:3001", TEST_ORIGIN + ".evil.example", null]) {
      const res = await preflight(origin);
      expect(res.status).toBe(403);
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    }
  });

  it("refuses a request from another origin even with a valid token, and does not spend it", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const auth = await authorization(member.id, "video/mp4", video.length);
    const bad = await put(auth.token, video, { origin: "https://evil.example" });
    expect(bad.status).toBe(403);
    expect(bad.headers.get("access-control-allow-origin")).toBeNull();
    expect((await put(auth.token, video)).status).toBe(201);
  });

  it("gives errors the CORS header too, so the browser can read them", async () => {
    const res = await put("v1.x.y", buildMp4Buffer(10));
    expect(res.status).toBe(401);
    expect(res.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
  });
});

describe("configuration", () => {
  it("fails closed (503) when UPLOAD_TOKEN_SECRET is not set", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const res = await put(sign(claimsFor(member.id, video.length)), video, { base: unconfigured.baseUrl });
    expect(res.status).toBe(503);
  });

  it("fails closed (503) when the signing secret is the internal secret", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const token = sign(claimsFor(member.id, video.length), SHARED);
    expect((await put(token, video, { base: reusedSecret.baseUrl })).status).toBe(503);
  });
});
