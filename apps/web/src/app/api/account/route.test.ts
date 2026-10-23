import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth", () => ({ auth: authMock }));

import { DELETE } from "./route";

const USER_ID = "2f6b1f0a-1c1d-4f4e-9a55-0d6a0f1d2c3e";
let upstream: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv("SERVER_URL", "http://server.invalid");
  vi.stubEnv("INTERNAL_API_SECRET", "unit-secret");
  authMock.mockResolvedValue({ user: { id: USER_ID } });
  upstream = vi.fn(async () => new Response(JSON.stringify({ alreadyDeleted: false }), { status: 200 }));
  vi.stubGlobal("fetch", upstream);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const call = (body: unknown, headers: Record<string, string> = {}) =>
  DELETE(new Request("https://www.giigirl.com/api/account", { method: "DELETE", headers: { host: "www.giigirl.com", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));

describe("DELETE /api/account (web proxy)", () => {
  it("requires a session and never contacts the server without one", async () => {
    authMock.mockResolvedValue(null);
    expect((await call({ confirmation: "DELETE" })).status).toBe(401);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("deletes only the SESSION's account: any user id in the body is ignored", async () => {
    await call({ confirmation: "DELETE", password: "pw", userId: "11111111-1111-4111-8111-111111111111", id: "x" });
    const [url, init] = upstream.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }];
    expect(url).toBe("http://server.invalid/api/account");
    expect(JSON.parse(init.body as string)).toEqual({ userId: USER_ID, confirmation: "DELETE", password: "pw" });
    expect(init.headers["x-internal-api-secret"]).toBe("unit-secret");
  });

  it("refuses a request from another site", async () => {
    const res = await call({ confirmation: "DELETE" }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("accepts the site's own origin", async () => {
    expect((await call({ confirmation: "DELETE" }, { origin: "https://www.giigirl.com" })).status).toBe(200);
  });

  it.each(["not json", "{}", { confirmation: 5 }, { confirmation: "DELETE", password: 12 }])("rejects a malformed body %j", async (body) => {
    expect((await call(body)).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it("passes the server's refusal and Retry-After through, without leaking anything else", async () => {
    upstream.mockResolvedValue(new Response(JSON.stringify({ error: "That password isn't correct." }), { status: 403, headers: { "retry-after": "60", "set-cookie": "x=1" } }));
    const res = await call({ confirmation: "DELETE", password: "bad" });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "That password isn't correct." });
    expect(res.headers.get("retry-after")).toBe("60");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("reports an unreachable server as a 502", async () => {
    upstream.mockRejectedValue(new Error("ECONNREFUSED 10.0.0.9"));
    const res = await call({ confirmation: "DELETE" });
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("10.0.0.9");
  });
});
