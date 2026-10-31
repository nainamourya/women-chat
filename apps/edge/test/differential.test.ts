import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_INTERNAL_SECRET, TEST_ORIGIN, guardedTestDatabaseUrl, readServerTestTargets, startLocalWorker, type RunningWorker } from "./localWorker";
import { seedRows, type Seed } from "./seed";

// Runs the REAL Express server's routers in-process (against the same local
// test database) next to the edge Worker and compares what each answers to
// identical requests — status code and JSON body. This is the evidence that
// the Worker keeps the Express API contract, rather than just matching what
// the Worker tests expect.
describe("edge Worker vs the Express reference implementation", () => {
  let worker: RunningWorker;
  let express: { baseUrl: string; server: Server; close: () => Promise<void> };
  let seed: Seed;

  beforeAll(async () => {
    seed = await seedRows();

    // The server's config module validates the environment when first
    // imported, so provide exactly what it needs — local test targets only.
    const targets = readServerTestTargets();
    Object.assign(process.env, {
      NODE_ENV: "test",
      DATABASE_URL: guardedTestDatabaseUrl(),
      REDIS_URL: targets.redisUrl,
      ALLOW_TEST_DB_WRITES: "1",
      CORS_ORIGIN: TEST_ORIGIN,
      INTERNAL_API_SECRET: TEST_INTERNAL_SECRET,
      R2_ENDPOINT: "https://placeholder.r2.example",
      R2_BUCKET_NAME: "test-bucket",
      R2_ACCESS_KEY_ID: "test-access-key-id",
      R2_SECRET_ACCESS_KEY: "test-secret-access-key",
      METERED_TURN_APP_NAME: "",
      METERED_TURN_API_KEY: "",
      METERED_TURN_REGION: "",
      TURN_URLS: "",
      TURN_STATIC_AUTH_SECRET: "",
      TURN_STATIC_USERNAME: "",
      TURN_STATIC_CREDENTIAL: "",
    });

    const { default: expressLib } = await import("express");
    const { interestsRouter } = await import("../../server/src/routes/interests");
    const { profileRouter } = await import("../../server/src/routes/profile");
    const { iceServersRouter } = await import("../../server/src/routes/iceServers");
    const { adminStatsRouter } = await import("../../server/src/routes/adminStats");
    const { adminUsersRouter } = await import("../../server/src/routes/adminUsers");
    const { closeDb } = await import("../../server/src/db/client");

    const app = expressLib();
    app.use(expressLib.json({ limit: "8mb" }));
    app.use("/api/interests", interestsRouter);
    app.use("/api/profile", profileRouter);
    app.use("/api/ice-servers", iceServersRouter);
    app.use("/api/admin/stats", adminStatsRouter);
    app.use("/api/admin/users", adminUsersRouter);

    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    express = {
      server,
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      close: async () => {
        await new Promise((r) => server.close(r));
        await closeDb();
      },
    };

    worker = await startLocalWorker(8811);
  });

  afterAll(async () => {
    worker?.stop();
    await express?.close();
    await seed?.cleanup();
  });

  type Req = { name: string; method: string; path: () => string; headers?: Record<string, string>; body?: () => unknown; rawBody?: string };
  const secret = { "x-internal-api-secret": TEST_INTERNAL_SECRET };
  const json = { ...secret, "content-type": "application/json" };

  const requests: Req[] = [
    { name: "interests", method: "GET", path: () => "/api/interests", headers: secret },
    { name: "interests, no secret", method: "GET", path: () => "/api/interests" },
    { name: "profile read", method: "GET", path: () => `/api/profile/${seed.memberId}`, headers: secret },
    { name: "profile read, bad id", method: "GET", path: () => "/api/profile/nope", headers: secret },
    { name: "profile read, unknown user", method: "GET", path: () => "/api/profile/00000000-0000-4000-8000-00000000dead", headers: secret },
    { name: "profile update", method: "PUT", path: () => `/api/profile/${seed.memberId}`, headers: json, body: () => ({ bio: "Same bio", displayName: "Same Name" }) },
    { name: "profile update, bio too long", method: "PUT", path: () => `/api/profile/${seed.memberId}`, headers: json, body: () => ({ bio: "x".repeat(501) }) },
    { name: "profile update, unknown user", method: "PUT", path: () => "/api/profile/00000000-0000-4000-8000-00000000dead", headers: json, body: () => ({ displayName: "Ghost" }) },
    { name: "profile update, malformed JSON", method: "PUT", path: () => `/api/profile/${seed.memberId}`, headers: json, rawBody: "{oops" },
    { name: "set interests", method: "PUT", path: () => `/api/profile/${seed.memberId}/interests`, headers: json, body: () => ({ interestIds: seed.interestIds }) },
    { name: "set interests, invalid id", method: "PUT", path: () => `/api/profile/${seed.memberId}/interests`, headers: json, body: () => ({ interestIds: ["00000000-0000-4000-8000-00000000beef"] }) },
    { name: "set interests, too many", method: "PUT", path: () => `/api/profile/${seed.memberId}/interests`, headers: json, body: () => ({ interestIds: Array.from({ length: 16 }, (_, i) => `00000000-0000-4000-8000-0000000000${(10 + i).toString()}`) }) },
    { name: "ice servers", method: "POST", path: () => "/api/ice-servers", headers: json, body: () => ({ userId: seed.memberId }) },
    { name: "ice servers, bad body", method: "POST", path: () => "/api/ice-servers", headers: json, body: () => ({ userId: 5 }) },
    { name: "admin stats", method: "GET", path: () => `/api/admin/stats/overview?adminUserId=${seed.adminId}`, headers: secret },
    { name: "admin stats, non-admin", method: "GET", path: () => `/api/admin/stats/overview?adminUserId=${seed.memberId}`, headers: secret },
    { name: "admin stats, unknown admin", method: "GET", path: () => "/api/admin/stats/overview?adminUserId=00000000-0000-4000-8000-00000000dead", headers: secret },
    { name: "admin stats, missing param", method: "GET", path: () => "/api/admin/stats/overview", headers: secret },
    { name: "admin users search", method: "GET", path: () => `/api/admin/users?adminUserId=${seed.adminId}&search=${encodeURIComponent(seed.memberEmail)}`, headers: secret },
    { name: "admin users, non-admin", method: "GET", path: () => `/api/admin/users?adminUserId=${seed.memberId}`, headers: secret },
  ];

  async function send(base: string, r: Req) {
    const res = await fetch(`${base}${r.path()}`, {
      method: r.method,
      headers: r.headers,
      body: r.rawBody ?? (r.body ? JSON.stringify(r.body()) : undefined),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // keep the raw text
    }
    return { status: res.status, body: parsed };
  }

  // Stats and the admin user list are compared structurally but not on live
  // counters that other tests may be changing between the two calls.
  const volatile = new Set(["admin stats"]);

  for (const request of ["interests", "interests, no secret", "profile read", "profile read, bad id", "profile read, unknown user", "profile update", "profile update, bio too long", "profile update, unknown user", "profile update, malformed JSON", "set interests", "set interests, invalid id", "set interests, too many", "ice servers", "ice servers, bad body", "admin stats", "admin stats, non-admin", "admin stats, unknown admin", "admin stats, missing param", "admin users search", "admin users, non-admin"]) {
    it(`${request}: same status and body`, async () => {
      const r = requests.find((candidate) => candidate.name === request)!;
      const fromExpress = await send(express.baseUrl, r);
      const fromWorker = await send(worker.baseUrl, r);
      expect(fromWorker.status).toBe(fromExpress.status);
      if (volatile.has(request)) {
        expect(Object.keys(fromWorker.body as object).sort()).toEqual(Object.keys(fromExpress.body as object).sort());
      } else if (r.rawBody !== undefined) {
        // Express's default HTML error page for a body-parser failure — status
        // parity is the contract; the page text is the framework's.
        expect(typeof fromWorker.body).toBe(typeof fromExpress.body);
      } else {
        expect(fromWorker.body).toEqual(fromExpress.body);
      }
    });
  }
});
