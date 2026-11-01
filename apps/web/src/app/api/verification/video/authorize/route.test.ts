import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.fn();
vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));

import { POST } from "./route";

const USER = "11111111-1111-4111-8111-111111111111";
const SECRET = "u".repeat(40);

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("http://web.invalid/x", { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) }));

// The backend limiter the route consults (a Durable Object on the Worker).
const limiter = vi.fn<typeof fetch>();
const allow = () => limiter.mockImplementation(async () => Response.json({ allowed: true }));
const calls = () => limiter.mock.calls as unknown as Array<[string, RequestInit]>;

beforeEach(() => {
  vi.stubEnv("SERVER_URL", "https://worker.invalid/");
  vi.stubEnv("INTERNAL_API_SECRET", "i".repeat(40));
  vi.stubEnv("UPLOAD_TOKEN_SECRET", SECRET);
  authMock.mockResolvedValue({ user: { id: USER } });
  limiter.mockReset();
  allow();
  vi.stubGlobal("fetch", limiter);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  authMock.mockReset();
});

describe("POST /api/verification/video/authorize", () => {
  it("401s without a session", async () => {
    authMock.mockResolvedValue(null);
    expect((await post({ contentType: "video/mp4", size: 100 })).status).toBe(401);
  });

  it("returns only the upload URL, a signed short-lived token and its expiry, bound to the session user, type and size", async () => {
    const res = await post({ contentType: "video/mp4; codecs=avc1", size: 1234, userId: "attacker" });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["expiresAt", "token", "uploadUrl"]);
    expect(body.uploadUrl).toBe("https://worker.invalid/api/verification/video-upload");

    const [v, payload, sig] = body.token.split(".");
    expect(v).toBe("v1");
    expect(sig).toBe(createHmac("sha256", SECRET).update("giigirl-verification-upload.v1." + payload).digest("base64url"));
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString());
    expect(claims.sub).toBe(USER);
    expect(claims.ct).toBe("video/mp4");
    expect(claims.len).toBe(1234);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
    expect(claims.jti).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.stringify(body)).not.toContain("i".repeat(40)); // never the internal secret
  });

  it("issues a different jti every time", async () => {
    const a = (await (await post({ contentType: "video/webm", size: 10 })).json()).token;
    const b = (await (await post({ contentType: "video/webm", size: 10 })).json()).token;
    expect(a).not.toBe(b);
  });

  it.each([
    [{ contentType: "application/pdf", size: 10 }],
    [{ contentType: "video/mp4", size: 0 }],
    [{ contentType: "video/mp4", size: -5 }],
    [{ contentType: "video/mp4", size: 1.5 }],
    [{ contentType: "video/mp4", size: "10" }],
    [{ contentType: "video/mp4", size: 25 * 1024 * 1024 + 1 }],
    [{ size: 10 }],
  ])("rejects an invalid request %j", async (body) => {
    expect((await post(body)).status).toBe(400);
  });

  it("accepts exactly 25 MB", async () => {
    expect((await post({ contentType: "video/mp4", size: 25 * 1024 * 1024 })).status).toBe(200);
  });

  it("rejects malformed JSON", async () => {
    expect((await post("{nope")).status).toBe(400);
  });

  it.each([
    ["missing", undefined],
    ["too short", "short"],
    ["the internal secret reused", "i".repeat(40)],
  ])("fails closed (503) when the signing secret is %s", async (_label, value) => {
    if (value === undefined) vi.stubEnv("UPLOAD_TOKEN_SECRET", "");
    else vi.stubEnv("UPLOAD_TOKEN_SECRET", value);
    expect((await post({ contentType: "video/mp4", size: 10 })).status).toBe(503);
  });
});

describe("authorization rate limit", () => {
  const ok = { contentType: "video/mp4", size: 100 };

  it("asks the backend limiter about the session user, with the internal secret, before minting", async () => {
    expect((await post({ ...ok, userId: "attacker" })).status).toBe(200);
    expect(calls()).toHaveLength(1);
    const [url, init] = calls()[0];
    expect(url).toBe("https://worker.invalid/api/verification/video-authorization/check");
    expect((init.headers as Record<string, string>)["x-internal-api-secret"]).toBe("i".repeat(40));
    expect(JSON.parse(init.body as string)).toEqual({ userId: USER });
  });

  it("returns 429 with Retry-After and mints nothing when the limit is hit", async () => {
    limiter.mockImplementation(async () => Response.json({ error: "x" }, { status: 429, headers: { "Retry-After": "1234" } }));
    const res = await post(ok);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("1234");
    const body = await res.json();
    expect(body.error).toMatch(/too many/i);
    expect(body.token).toBeUndefined();
  });

  it("does not forward an unusable Retry-After", async () => {
    limiter.mockImplementation(async () => Response.json({}, { status: 429, headers: { "Retry-After": "soon" } }));
    expect((await post(ok)).headers.get("retry-after")).toBeNull();
  });

  it("recovers once the window has reset (the backend allows again)", async () => {
    limiter.mockImplementationOnce(async () => Response.json({}, { status: 429, headers: { "Retry-After": "5" } }));
    expect((await post(ok)).status).toBe(429);
    expect((await post(ok)).status).toBe(200);
  });

  it("fails closed (503, no token) when the limiter is unreachable or answers with an error", async () => {
    limiter.mockImplementation(async () => {
      throw new Error("network");
    });
    expect((await post(ok)).status).toBe(503);
    limiter.mockImplementation(async () => new Response("boom", { status: 500 }));
    const res = await post(ok);
    expect(res.status).toBe(503);
    expect((await res.json()).token).toBeUndefined();
  });

  it("does not consult the limiter for requests that are rejected first", async () => {
    authMock.mockResolvedValue(null);
    await post(ok);
    authMock.mockResolvedValue({ user: { id: USER } });
    await post({ contentType: "application/pdf", size: 1 });
    await post({ contentType: "video/mp4", size: 0 });
    expect(limiter).not.toHaveBeenCalled();
  });

  it.each([["missing id", { user: {} }], ["empty id", { user: { id: "" } }], ["not a uuid", { user: { id: "../../x" } }], ["uppercase/odd", { user: { id: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" } }]])(
    "401s and mints nothing for a session with a %s",
    async (_label, session) => {
      authMock.mockResolvedValue(session);
      expect((await post(ok)).status).toBe(401);
      expect(limiter).not.toHaveBeenCalled();
    },
  );

  describe("client address", () => {
    it("is not sent when the app is not on Vercel, even if a header is supplied", async () => {
      await post(ok, { "x-forwarded-for": "203.0.113.9", "x-vercel-forwarded-for": "203.0.113.9" });
      expect(JSON.parse(calls()[0][1].body as string).ip).toBeUndefined();
    });

    it("is sent on Vercel, from the first x-vercel-forwarded-for entry", async () => {
      vi.stubEnv("VERCEL", "1");
      await post(ok, { "x-vercel-forwarded-for": "203.0.113.9, 10.0.0.1", "x-forwarded-for": "198.51.100.1" });
      expect(JSON.parse(calls()[0][1].body as string).ip).toBe("203.0.113.9");
    });

    it.each([["garbage", "not-an-ip"], ["empty", ""], ["injection", "1.1.1.1 x"]])("ignores a malformed one (%s) on Vercel", async (_l, value) => {
      vi.stubEnv("VERCEL", "1");
      await post(ok, { "x-vercel-forwarded-for": value });
      expect(JSON.parse(calls()[0][1].body as string).ip).toBeUndefined();
    });
  });
});
