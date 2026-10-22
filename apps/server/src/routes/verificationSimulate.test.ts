import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";

// Fully synthetic configuration — the real env module (and any database or
// Redis target) is never loaded. `env` is one shared mutable object, so each
// test can pick NODE_ENV and every module in the router's import chain
// (developmentOnly, requireInternalSecret, videoStorage …) sees the same value
// at request time.
vi.mock("../config/env.js", () => ({
  env: {
    NODE_ENV: "development",
    INTERNAL_API_SECRET: "test-internal-api-secret-0123456789",
    R2_ENDPOINT: "https://placeholder.r2.example",
    R2_BUCKET_NAME: "test-bucket",
    R2_ACCESS_KEY_ID: "test-access-key-id",
    R2_SECRET_ACCESS_KEY: "test-secret-access-key",
    VERIFICATION_VIDEO_MAX_BYTES: 25 * 1024 * 1024,
    VERIFICATION_VIDEO_MAX_DURATION_SECONDS: 15,
  },
}));

// The router imports modules that build database and Redis clients. Neither
// is touched by the simulate route, so both are replaced with inert stubs.
vi.mock("../db/client.js", () => ({ db: {} }));
vi.mock("../redis/client.js", () => ({ redis: {} }));

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
