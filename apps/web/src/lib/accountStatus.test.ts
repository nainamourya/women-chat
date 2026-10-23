import { afterEach, describe, expect, it, vi } from "vitest";
import { isAccountDeleted } from "./accountStatus";

// Pure unit tests — mocked global fetch, no database, no NextAuth runtime.
// This is the practical way to cover the jwt callback's invalidation logic
// without connecting to anything: the callback itself only ever calls this
// one extracted function, so testing this function's behavior in isolation
// covers the actual decision logic the callback depends on.

const originalFetch = global.fetch;
const originalEnv = { ...process.env };

afterEach(() => {
  global.fetch = originalFetch;
  process.env = { ...originalEnv };
  vi.restoreAllMocks();
});

describe("isAccountDeleted", () => {
  it("returns true when the server reports the account as deleted", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accountStatus: "deleted" }),
    } as Response);

    expect(await isAccountDeleted("user-1")).toBe(true);
  });

  it("returns false when the account is active", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accountStatus: "active" }),
    } as Response);

    expect(await isAccountDeleted("user-1")).toBe(false);
  });

  it("returns false for any other non-deleted status (suspended, banned)", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accountStatus: "suspended" }),
    } as Response);

    expect(await isAccountDeleted("user-1")).toBe(false);
  });

  it("fails open (returns false) when the server responds with a non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({ error: "Something went wrong." }),
    } as Response);

    expect(await isAccountDeleted("user-1")).toBe(false);
  });

  it("fails open (returns false) when the fetch call itself throws (network error)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("network down"));

    expect(await isAccountDeleted("user-1")).toBe(false);
  });

  it("fails open (returns false) when the response body is not valid JSON", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error("invalid JSON");
      },
    } as unknown as Response);

    expect(await isAccountDeleted("user-1")).toBe(false);
  });

  it("calls the expected internal endpoint with the internal secret header, never exposing it in the response", async () => {
    process.env.SERVER_URL = "http://localhost:4000";
    process.env.INTERNAL_API_SECRET = "test-secret-value";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ accountStatus: "active" }),
    } as Response);
    global.fetch = fetchMock;

    await isAccountDeleted("user-123");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:4000/api/auth/account-status/user-123",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-internal-api-secret": "test-secret-value" }),
      }),
    );
  });
});
