import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { matchmakingRouter } from "./matchmaking.js";
import { env } from "../config/env.js";

// Integration test against the real Express route (not a mock). `userId` in
// every request below is a fresh random UUID that doesn't correspond to a
// real user — fine for testing the limiter itself, since the rate-limit
// check runs before the service layer touches the database, so a
// non-existent user still proves allow/block behavior (status 429 vs.
// anything else) without needing to seed real data.

let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/matchmaking", matchmakingRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function call(path: string, method: "GET" | "POST", userId: string) {
  const url = method === "GET" ? `${baseUrl}/api/matchmaking/${path}/${userId}` : `${baseUrl}/api/matchmaking/${path}`;
  return fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-secret": env.INTERNAL_API_SECRET,
    },
    body: method === "POST" ? JSON.stringify({ userId }) : undefined,
  });
}

describe("matchmaking rate limiting", () => {
  it("allows join attempts under the limit, blocks the one after", async () => {
    const userId = randomUUID();
    for (let i = 0; i < 5; i++) {
      const res = await call("join", "POST", userId);
      expect(res.status).not.toBe(429);
    }
    const res = await call("join", "POST", userId);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("allows leave attempts under the limit, blocks the one after", async () => {
    const userId = randomUUID();
    for (let i = 0; i < 5; i++) {
      const res = await call("leave", "POST", userId);
      expect(res.status).not.toBe(429);
    }
    const res = await call("leave", "POST", userId);
    expect(res.status).toBe(429);
  });

  it("allows status polling comfortably beyond the real 4s client interval, blocks a runaway poller", async () => {
    const userId = randomUUID();
    for (let i = 0; i < 30; i++) {
      const res = await call("status", "GET", userId);
      expect(res.status).not.toBe(429);
    }
    const res = await call("status", "GET", userId);
    expect(res.status).toBe(429);
  }, 15_000);

  it("limits socket-ticket minting to 10/minute per user", async () => {
    const userId = randomUUID();
    for (let i = 0; i < 10; i++) {
      const res = await call("socket-ticket", "POST", userId);
      expect(res.status).not.toBe(429);
    }
    const res = await call("socket-ticket", "POST", userId);
    expect(res.status).toBe(429);
  });

  it("keeps limits independent per user", async () => {
    const userA = randomUUID();
    const userB = randomUUID();
    for (let i = 0; i < 6; i++) {
      await call("join", "POST", userA);
    }
    const blockedA = await call("join", "POST", userA);
    expect(blockedA.status).toBe(429);

    const allowedB = await call("join", "POST", userB);
    expect(allowedB.status).not.toBe(429);
  });
});
