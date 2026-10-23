import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The proxy decides WHO is acting (from the session), WHICH server paths a
// browser may reach, and which requests are accepted. The session and the
// upstream server are replaced so each rule can be checked on its own.
const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: authMock }));

import { DELETE, GET, POST, PUT } from "./route";

const USER_ID = "2f6b1f0a-1c1d-4f4e-9a55-0d6a0f1d2c3e";
const POST_ID = "7d0c3f2e-5b7a-4c1e-8f2a-9b3d4e5f6a7b";
const SECRET = "unit-test-internal-secret";

let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("SERVER_URL", "http://server.invalid");
  vi.stubEnv("INTERNAL_API_SECRET", SECRET);
  authMock.mockResolvedValue({ user: { id: USER_ID } });
  upstream = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } }));
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

type Handler = typeof GET;

async function call(handler: Handler, method: string, path: string, init: { headers?: Record<string, string>; body?: string; search?: string } = {}) {
  const req = new Request(`https://www.giigirl.com/api/social/${path}${init.search ?? ""}`, {
    method,
    headers: { host: "www.giigirl.com", ...init.headers },
    body: init.body,
  });
  return handler(req, { params: Promise.resolve({ path: path.split("/") }) });
}

describe("who is acting", () => {
  it("rejects a request with no session and never contacts the server", async () => {
    authMock.mockResolvedValue(null);
    const res = await call(GET, "GET", "me");
    expect(res.status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("sends the SESSION's user id to the server, plus the internal secret", async () => {
    await call(GET, "GET", "me");
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("http://server.invalid/api/social/me");
    expect(init.headers).toMatchObject({ "x-viewer-id": USER_ID, "x-internal-api-secret": SECRET });
  });

  it("ignores every actor the browser claims to be — headers, query and body", async () => {
    const forged = "11111111-1111-4111-8111-111111111111";
    await call(POST, "POST", `posts/${POST_ID}/comments`, {
      headers: { "x-viewer-id": forged, "x-internal-api-secret": "guess", cookie: "session=abc", authorization: "Bearer x", origin: "https://www.giigirl.com" },
      body: JSON.stringify({ content: "hi", userId: forged, viewerId: forged }),
      search: `?viewerId=${forged}`,
    });
    const [, init] = upstream.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(init.headers["x-viewer-id"]).toBe(USER_ID);
    expect(init.headers["x-internal-api-secret"]).toBe(SECRET);
    // Nothing else from the browser is forwarded.
    expect(Object.keys(init.headers).sort()).toEqual(["Content-Type", "x-internal-api-secret", "x-viewer-id"]);
  });

  it("passes the response status and safe headers back, not the server's other headers", async () => {
    upstream.mockResolvedValue(new Response("{}", { status: 429, headers: { "content-type": "application/json", "retry-after": "30", "set-cookie": "x=1", "x-secret-debug": "leak" } }));
    const res = await call(GET, "GET", "feed");
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(res.headers.get("x-secret-debug")).toBeNull();
  });

  it("reports an unreachable server as a 502 without leaking details", async () => {
    upstream.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.5:4000"));
    const res = await call(GET, "GET", "feed");
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.5");
  });
});

describe("which paths and methods are reachable", () => {
  it.each([
    ["GET", GET, "me"],
    ["GET", GET, "feed"],
    ["GET", GET, "search"],
    ["GET", GET, "blocked"],
    ["GET", GET, "users/ana_1"],
    ["GET", GET, "users/ana_1/posts"],
    ["GET", GET, "users/ana_1/followers"],
    ["POST", POST, "users/ana_1/follow"],
    ["DELETE", DELETE, "users/ana_1/follow"],
    ["POST", POST, "users/ana_1/block"],
    ["POST", POST, "users/ana_1/report"],
    ["PUT", PUT, "me/profile"],
    ["PUT", PUT, "me/avatar"],
    ["DELETE", DELETE, "me/avatar"],
    ["POST", POST, "posts"],
    ["GET", GET, `posts/${POST_ID}`],
    ["DELETE", DELETE, `posts/${POST_ID}`],
    ["POST", POST, `posts/${POST_ID}/like`],
    ["GET", GET, `posts/${POST_ID}/comments`],
    ["POST", POST, `posts/${POST_ID}/report`],
    ["DELETE", DELETE, `comments/${POST_ID}`],
    ["GET", GET, `media/posts/${POST_ID}`],
    ["GET", GET, "media/avatars/ana_1"],
    ["POST", POST, "conversations"],
    ["GET", GET, "conversations"],
    ["GET", GET, `conversations/${POST_ID}/messages`],
    ["POST", POST, `conversations/${POST_ID}/messages`],
    ["POST", POST, `conversations/${POST_ID}/read`],
    ["GET", GET, "notifications"],
    ["POST", POST, "notifications/read"],
    ["GET", GET, "unread-counts"],
  ])("allows %s %s", async (method, handler, path) => {
    const res = await call(handler, method, path, { body: method === "GET" || method === "DELETE" ? undefined : "{}" });
    expect(res.status).toBe(200);
    expect(upstream).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["GET", GET, "health"],
    ["GET", GET, "admin/users"],
    ["GET", GET, "../health"],
    ["GET", GET, "users/../me"],
    ["GET", GET, "users/ana_1/../../admin"],
    ["GET", GET, "./me"],
    ["GET", GET, "users/bad name"],
    ["GET", GET, "users/ana%2f..%2fadmin"],
    ["GET", GET, "posts/not-a-uuid"],
    ["GET", GET, "media/posts/not-a-uuid"],
    ["GET", GET, "conversations/not-a-uuid/messages"],
    ["GET", GET, `posts/${POST_ID}/anything`],
    ["POST", POST, "me"],
    ["DELETE", DELETE, "posts"],
    ["PUT", PUT, "posts"],
    ["POST", POST, "feed"],
    ["POST", POST, "search"],
    ["DELETE", DELETE, "me/profile"],
    ["GET", GET, "me/profile"],
    ["PUT", PUT, "users/ana_1/follow"],
    ["GET", GET, ""],
  ])("refuses %s %j with a 404 and never reaches the server", async (method, handler, path) => {
    const res = await call(handler, method, path, { body: method === "GET" || method === "DELETE" ? undefined : "{}" });
    expect(res.status).toBe(404);
    expect(upstream).not.toHaveBeenCalled();
  });
});

describe("state-changing requests", () => {
  it("refuses a different Origin", async () => {
    const res = await call(POST, "POST", `posts/${POST_ID}/like`, { headers: { origin: "https://evil.example" }, body: "{}" });
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("refuses an Origin whose host merely contains ours", async () => {
    for (const origin of ["https://www.giigirl.com.evil.example", "https://evil.example/www.giigirl.com", "null", "not a url"]) {
      const res = await call(DELETE, "DELETE", `posts/${POST_ID}`, { headers: { origin } });
      expect(res.status).toBe(403);
    }
    expect(upstream).not.toHaveBeenCalled();
  });

  it("accepts the site's own Origin, and requests without one", async () => {
    expect((await call(POST, "POST", `posts/${POST_ID}/like`, { headers: { origin: "https://www.giigirl.com" }, body: "{}" })).status).toBe(200);
    expect((await call(POST, "POST", `posts/${POST_ID}/like`, { body: "{}" })).status).toBe(200);
  });

  it("honours a forwarded host behind a proxy", async () => {
    const res = await call(POST, "POST", `posts/${POST_ID}/like`, { headers: { host: "internal:3000", "x-forwarded-host": "www.giigirl.com", origin: "https://www.giigirl.com" }, body: "{}" });
    expect(res.status).toBe(200);
  });

  it("does not apply the Origin rule to reads", async () => {
    expect((await call(GET, "GET", "feed", { headers: { origin: "https://evil.example" } })).status).toBe(200);
  });

  it("rejects an oversized body with 413 before contacting the server", async () => {
    const res = await call(POST, "POST", "posts", { body: "x".repeat(8 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("forwards a JSON body unchanged and keeps the query string", async () => {
    await call(POST, "POST", `posts/${POST_ID}/comments`, { body: '{"content":"nice"}' });
    const [, init] = upstream.mock.calls[0] as [string, RequestInit];
    expect(init.body).toBe('{"content":"nice"}');
    await call(GET, "GET", "feed", { search: "?cursor=abc&limit=5" });
    expect((upstream.mock.calls[1] as [string])[0]).toBe("http://server.invalid/api/social/feed?cursor=abc&limit=5");
  });
});
