import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

// Synthetic configuration — the real env module (and any database or Redis
// target) is never loaded.
const SECRET = "k3Jp9xQ2vLm8Zt5Wd7Rb1Hn4Yc6Fa0Gs";
vi.mock("../config/env.js", () => ({ env: { INTERNAL_API_SECRET: "k3Jp9xQ2vLm8Zt5Wd7Rb1Hn4Yc6Fa0Gs" } }));

import { requireInternalSecret } from "./internalAuth.js";

function run(header: string | undefined) {
  const req = { header: (name: string) => (name.toLowerCase() === "x-internal-api-secret" ? header : undefined) } as unknown as Request;
  const json = vi.fn();
  const res = { status: vi.fn(() => ({ json })) } as unknown as Response;
  const next = vi.fn() as unknown as NextFunction;
  requireInternalSecret(req, res, next);
  return { next, status: (res.status as unknown as ReturnType<typeof vi.fn>), json };
}

describe("requireInternalSecret", () => {
  it("lets a request with the exact secret through", () => {
    const { next, status } = run(SECRET);
    expect(next).toHaveBeenCalledTimes(1);
    expect(status).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["wrong, same length", "X".repeat(SECRET.length)],
    ["wrong, differs only in the last character", SECRET.slice(0, -1) + "x"],
    ["a prefix of the real secret", SECRET.slice(0, 20)],
    ["the real secret plus extra characters", SECRET + "x"],
    ["the real secret with different case", SECRET.toUpperCase()],
    ["much longer than the real secret", "a".repeat(5000)],
  ])("rejects a %s secret with 401 and does not call next", (_label, header) => {
    const { next, status, json } = run(header);
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: "Unauthorized." });
  });
});
