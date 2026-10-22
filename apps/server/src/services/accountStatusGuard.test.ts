import { describe, expect, it, vi } from "vitest";
import { AuthError, assertAccountActive, assertEligible } from "./auth.service.js";

// auth.service.ts imports the database client, but these tests only exercise
// pure functions — mocked so nothing here builds a connection.
vi.mock("../db/client.js", () => ({ db: {} }));

const eligible = { suspendedUntil: null, ageConfirmed18: true, verificationStatus: "verified" as const };

describe("deleted accounts", () => {
  it("assertAccountActive rejects a deleted account with a 403", () => {
    try {
      assertAccountActive({ accountStatus: "deleted", suspendedUntil: null });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthError);
      expect((err as AuthError).status).toBe(403);
    }
  });

  it("assertEligible (matchmaking, sockets, tickets) rejects a deleted account even if it was verified", () => {
    expect(() => assertEligible({ ...eligible, accountStatus: "deleted" })).toThrow(AuthError);
  });

  it("still lets an active, verified account through", () => {
    expect(() => assertEligible({ ...eligible, accountStatus: "active" })).not.toThrow();
  });
});
