import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

// A mutable copy of the real parsed env so each test can pick NODE_ENV; every
// module in the router's import chain (including developmentOnly and
// requireInternalSecret) reads this same object at request time.
vi.mock("../config/env.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../config/env.js")>();
  return { ...actual, env: { ...actual.env } };
});

// The service writes to Postgres; the point here is whether the route lets
// the request reach it, so it is replaced with a spy and no DB is touched.
vi.mock("../services/verification.service.js", () => ({
  simulatePrototypeVerification: vi.fn(async (userId: string) => ({ id: userId, verificationStatus: "verified" })),
}));

import { env } from "../config/env.js";
import { simulatePrototypeVerification } from "../services/verification.service.js";
import { verificationRouter } from "./verification.js";

const USER_ID = "11111111-1111-4111-8111-111111111111";
let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/verification", verificationRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

beforeEach(() => {
  vi.mocked(simulatePrototypeVerification).mockClear();
});

function simulate(headers: Record<string, string> = { "x-internal-api-secret": env.INTERNAL_API_SECRET }) {
  return fetch(`${baseUrl}/api/verification/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ userId: USER_ID }),
  });
}

describe("POST /api/verification/simulate", () => {
  it("works in development (with the internal secret)", async () => {
    env.NODE_ENV = "development";
    const res = await simulate();
    expect(res.status).toBe(200);
    expect(simulatePrototypeVerification).toHaveBeenCalledWith(USER_ID);
  });

  it.each(["production", "test"] as const)("is a 404 and never verifies anyone when NODE_ENV=%s", async (nodeEnv) => {
    env.NODE_ENV = nodeEnv;
    const res = await simulate();
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found." });
    expect(simulatePrototypeVerification).not.toHaveBeenCalled();
  });

  it("still requires the internal secret in development", async () => {
    env.NODE_ENV = "development";
    const res = await simulate({});
    expect(res.status).toBe(401);
    expect(simulatePrototypeVerification).not.toHaveBeenCalled();
  });
});
