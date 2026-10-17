import { afterEach, describe, expect, it, vi } from "vitest";

// Never reached in the non-development cases; in development it stands in for
// a signed-in session so the proxy path can be exercised.
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => ({ user: { id: "user-1" } })) }));

import { POST } from "./route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/verification/simulate (web proxy)", () => {
  it.each(["production", "test"])("returns 404 without calling the server when NODE_ENV=%s", async (nodeEnv) => {
    vi.stubEnv("NODE_ENV", nodeEnv);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST();

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("proxies to the server in development", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SERVER_URL", "http://server.invalid");
    vi.stubEnv("INTERNAL_API_SECRET", "test-secret");
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ user: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const res = await POST();

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
