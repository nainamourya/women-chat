import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { healthRouter } from "./health.js";

// Failed-dependency and timeout behavior for /ready is covered at the
// pingRedis/pingDb unit level (see redis/client.test.ts, db/client.test.ts) —
// forcing the shared singleton clients to fail here would need module
// mocking rather than a real request, so this file sticks to the common,
// everything-healthy path against the real dev Redis/Postgres, consistent
// with the rest of this project's test suite.

let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  const app = express();
  app.use("/api/health", healthRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

describe("GET /api/health", () => {
  it("reports liveness without checking dependencies", async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("GET /api/health/ready", () => {
  it("reports ready when Redis and Postgres are both reachable, without leaking internals", async () => {
    const res = await fetch(`${baseUrl}/api/health/ready`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", dependencies: { redis: "ok", postgres: "ok" } });
    expect(JSON.stringify(body)).not.toMatch(/postgres(ql)?:\/\/|rediss?:\/\//i);
  });
});
