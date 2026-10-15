import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { authRouter } from "./auth.js";
import { env } from "../config/env.js";

// Integration test against the real Express app/route (not a mock), mirroring
// production config (trust proxy) — this is the exact route both the
// NextAuth Credentials provider and the web app's /api/register proxy call,
// confirmed by inspecting apps/web/src/lib/auth.ts and
// apps/web/src/app/api/register/route.ts.
//
// Each test sends a distinct fake X-Forwarded-For so IP-bucket usage can't
// leak between tests — verified separately that, with trust proxy=1 (the
// same setting index.ts uses), Express resolves req.ip from a single
// supplied X-Forwarded-For exactly as it would behind Render's real proxy.

let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use("/api/auth", authRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  baseUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function fakeIp(): string {
  return `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
}

function login(email: string, ip: string, password = "wrong-password") {
  return fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-internal-api-secret": env.INTERNAL_API_SECRET,
      "X-Forwarded-For": ip,
    },
    body: JSON.stringify({ email, password }),
  });
}

describe("POST /api/auth/login rate limiting", () => {
  it("allows requests under the per-email limit", async () => {
    const email = `ratelimit-${randomUUID()}@example.com`;
    const ip = fakeIp();
    for (let i = 0; i < 5; i++) {
      const res = await login(email, ip);
      expect(res.status).toBe(401); // invalid credentials, not rate-limited
    }
  });

  it("blocks the 6th attempt for the same email with 429 and a Retry-After header, without revealing account existence", async () => {
    const email = `ratelimit-${randomUUID()}@example.com`;
    const ip = fakeIp();
    for (let i = 0; i < 5; i++) {
      await login(email, ip);
    }
    const res = await login(email, ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
    const body = await res.json();
    expect(body).toEqual({ error: "Too many attempts. Please try again later." });
  });

  it("does not block a different email sharing the same source IP", async () => {
    const ip = fakeIp();
    const blockedEmail = `ratelimit-${randomUUID()}@example.com`;
    for (let i = 0; i < 6; i++) {
      await login(blockedEmail, ip);
    }
    const blockedRes = await login(blockedEmail, ip);
    expect(blockedRes.status).toBe(429);

    const otherEmail = `ratelimit-${randomUUID()}@example.com`;
    const otherRes = await login(otherEmail, ip);
    expect(otherRes.status).toBe(401); // not rate-limited — different email, same IP
  });

  it(
    "blocks once the shared per-IP backup limit is exceeded, even across many different emails",
    async () => {
      const ip = fakeIp();
      for (let i = 0; i < 20; i++) {
        await login(`ratelimit-${randomUUID()}@example.com`, ip);
      }
      const res = await login(`ratelimit-${randomUUID()}@example.com`, ip);
      expect(res.status).toBe(429);
    },
    15_000,
  );

  it("counts a malformed request toward the limit instead of bypassing it", async () => {
    const email = `ratelimit-${randomUUID()}@example.com`;
    const ip = fakeIp();
    // Missing password entirely — fails schema validation, but the email is
    // still extractable, so it must still count.
    const malformed = () =>
      fetch(`${baseUrl}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-api-secret": env.INTERNAL_API_SECRET,
          "X-Forwarded-For": ip,
        },
        body: JSON.stringify({ email }),
      });

    for (let i = 0; i < 5; i++) {
      const res = await malformed();
      expect(res.status).toBe(400);
    }
    const res = await malformed();
    expect(res.status).toBe(429);
  });
});

describe("POST /api/auth/register rate limiting", () => {
  function register(ip: string) {
    return fetch(`${baseUrl}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-api-secret": env.INTERNAL_API_SECRET,
        "X-Forwarded-For": ip,
      },
      body: JSON.stringify({
        email: `ratelimit-${randomUUID()}@example.com`,
        password: "not-a-real-password",
        displayName: "Rate Limit Test",
        ageConfirmed18: true,
      }),
    });
  }

  it("blocks the 6th registration attempt from the same IP within the window", async () => {
    const ip = fakeIp();
    for (let i = 0; i < 5; i++) {
      const res = await register(ip);
      expect(res.status).not.toBe(429);
    }
    const res = await register(ip);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeTruthy();
  });

  it("does not block registration from a different IP", async () => {
    const ip = fakeIp();
    for (let i = 0; i < 6; i++) {
      await register(ip);
    }
    const blocked = await register(ip);
    expect(blocked.status).toBe(429);

    const otherIp = fakeIp();
    const res = await register(otherIp);
    expect(res.status).not.toBe(429);
  });
});
