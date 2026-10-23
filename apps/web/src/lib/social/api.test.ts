import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, errorMessage, query, social, timeAgo } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

// The rejection of a call that is expected to fail, typed as what social() throws.
async function failure(call: Promise<unknown>): Promise<ApiError> {
  return call.then(
    () => {
      throw new Error("expected the call to fail");
    },
    (error: unknown) => error as ApiError,
  );
}

function respond(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status })));
}

describe("social()", () => {
  it("returns the parsed body on success and sends no actor identity", async () => {
    respond(200, { ok: 1 });
    await expect(social("/feed")).resolves.toEqual({ ok: 1 });
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/social/feed");
    expect(init.method).toBe("GET");
    expect(init.headers).toBeUndefined();
  });

  it("sends a JSON body with the method given", async () => {
    respond(201, { ok: 1 });
    await social("/posts", { method: "POST", body: { caption: "hi" } });
    const [, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(init).toMatchObject({ method: "POST", body: '{"caption":"hi"}', headers: { "Content-Type": "application/json" } });
  });

  it("turns an error response into an ApiError carrying the status and code", async () => {
    respond(403, { error: "Choose a username to use this feature.", code: "username_required" });
    const err = await failure(social("/feed"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ message: "Choose a username to use this feature.", status: 403, code: "username_required" });
  });

  it("explains rate limiting and unexpected bodies without exposing raw output", async () => {
    respond(429, {});
    expect((await failure(social("/x"))).message).toMatch(/too quickly/);
    respond(500, "<html>stack trace</html>");
    const err = await failure(social("/x"));
    expect(err.message).toBe("Something went wrong. Please try again.");
    expect(err.message).not.toContain("stack trace");
  });

  it("reports a network failure as a connection problem", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))));
    const err = await failure(social("/feed"));
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(0);
    expect(err.message).toMatch(/connection/);
  });
});

describe("helpers", () => {
  it("builds query strings, skipping empty values and encoding the rest", () => {
    expect(query({ q: "a b&c", cursor: undefined, limit: 5, empty: "" })).toBe("?q=a+b%26c&limit=5");
    expect(query({})).toBe("");
  });

  it("errorMessage falls back to a generic message", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
    expect(errorMessage("weird")).toBe("Something went wrong. Please try again.");
  });

  it("timeAgo is relative, then a date", () => {
    const now = Date.parse("2026-10-24T12:00:00Z");
    const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
    expect(timeAgo(ago(10), now)).toBe("just now");
    expect(timeAgo(ago(5 * 60), now)).toBe("5m");
    expect(timeAgo(ago(3 * 3600), now)).toBe("3h");
    expect(timeAgo(ago(2 * 86400), now)).toBe("2d");
    expect(timeAgo(ago(30 * 86400), now)).toMatch(/\w/);
    expect(timeAgo(new Date(now + 60_000).toISOString(), now)).toBe("just now");
  });
});
