import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { TEST_INTERNAL_SECRET, TEST_ORIGIN, guardedTestDatabaseUrl, readServerTestTargets, startLocalWorker, type RunningWorker } from "./localWorker";
import { seedRows, type Seed } from "./seed";

// The Express reference runs in this process without a Socket.IO server (which
// would need its own Redis adapter and HTTP server), so its real-time pushes are
// stubbed here — on the Express side only. Event delivery is covered by
// realtime.test.ts and matchmaking.test.ts against the Worker.
vi.mock("../../server/src/socket/index", () => ({
  emitToUser: () => {},
  disconnectUser: () => {},
  initSocketServer: async () => undefined,
  closeSocketServer: async () => undefined,
}));

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
    const { matchmakingRouter } = await import("../../server/src/routes/matchmaking");
    const { closeDb } = await import("../../server/src/db/client");
    const { closeRedis } = await import("../../server/src/redis/client");

    const app = expressLib();
    app.use(expressLib.json({ limit: "8mb" }));
    app.use("/api/interests", interestsRouter);
    app.use("/api/profile", profileRouter);
    app.use("/api/ice-servers", iceServersRouter);
    app.use("/api/admin/stats", adminStatsRouter);
    app.use("/api/admin/users", adminUsersRouter);
    app.use("/api/matchmaking", matchmakingRouter);

    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    express = {
      server,
      baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      close: async () => {
        await new Promise((r) => server.close(r));
        await closeDb();
        await closeRedis();
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

  // ---- matchmaking: the real Express router (with real Redis) vs the Worker ----
  //
  // The two systems have separate queues, so each gets its own pair of people.
  // Ids differ by construction; they are replaced by labels before comparing.
  async function mmCall(base: string, method: string, path: string, body?: unknown, headers: Record<string, string> = json) {
    const res = await fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json().catch(() => undefined) };
  }

  const label = (value: any, names: Record<string, string>): any =>
    JSON.parse(JSON.stringify(value ?? null), (_key, v) => (typeof v === "string" && names[v] ? names[v] : v));

  it("matchmaking validation, auth and eligibility errors are identical", async () => {
    const { Fixtures } = await import("./seed");
    const f = new Fixtures();
    try {
      const unverified = await f.member({ verificationStatus: "unverified" });
      const banned = await f.member({ accountStatus: "banned" });
      const unknown = "00000000-0000-4000-8000-00000000dead";
      const cases: Array<[string, string, unknown, Record<string, string>]> = [
        ["POST", "/api/matchmaking/join", { userId: "nope" }, json],
        ["POST", "/api/matchmaking/join", {}, json],
        ["POST", "/api/matchmaking/join", { userId: unknown }, json],
        ["POST", "/api/matchmaking/join", { userId: unverified.id }, json],
        ["POST", "/api/matchmaking/join", { userId: banned.id }, json],
        ["POST", "/api/matchmaking/join", { userId: unknown }, { "content-type": "application/json" }],
        ["POST", "/api/matchmaking/leave", { userId: "nope" }, json],
        ["POST", "/api/matchmaking/leave", { userId: unknown }, json],
        ["GET", "/api/matchmaking/status/not-a-uuid", undefined, secret],
        ["GET", `/api/matchmaking/status/${unknown}`, undefined, secret],
        ["POST", "/api/matchmaking/socket-ticket", { userId: unknown }, json],
        ["POST", "/api/matchmaking/socket-ticket", { userId: unverified.id }, json],
        ["POST", "/api/matchmaking/socket-ticket", { userId: "nope" }, json],
      ];
      for (const [method, path, body, headers] of cases) {
        const names = { [unverified.id]: "<unverified>", [banned.id]: "<banned>" };
        const e = await mmCall(express.baseUrl, method, path, body, headers);
        const w = await mmCall(worker.baseUrl, method, path, body, headers);
        expect(w.status, `${method} ${path}`).toBe(e.status);
        expect(label(w.body, names), `${method} ${path}`).toEqual(label(e.body, names));
      }
    } finally {
      await f.cleanup();
    }
  });

  it("matchmaking flows give the same answers: waiting, status, leave, match, rejoin, leave-while-matched", async () => {
    const { Fixtures } = await import("./seed");
    const f = new Fixtures();
    try {
      const exA = await f.member({ displayName: "Asha" });
      const exB = await f.member({ displayName: "Bela" });
      const wkA = await f.member({ displayName: "Asha" });
      const wkB = await f.member({ displayName: "Bela" });
      await f.setBio(exA.id, "Likes hiking");
      await f.setBio(wkA.id, "Likes hiking");

      const run = async (base: string, a: string, b: string) => {
        const names: Record<string, string> = { [a]: "<A>", [b]: "<B>" };
        const out: unknown[] = [];
        const step = async (method: string, path: string, body?: unknown, headers: Record<string, string> = json) => {
          const r = await mmCall(base, method, path, body, headers);
          out.push({ status: r.status, body: label(r.body, names) });
          return r;
        };
        await step("GET", `/api/matchmaking/status/${a}`, undefined, secret); // idle
        await step("POST", "/api/matchmaking/join", { userId: a }); // waiting
        await step("POST", "/api/matchmaking/join", { userId: a }); // duplicate: still waiting
        await step("GET", `/api/matchmaking/status/${a}`, undefined, secret); // waiting
        await step("POST", "/api/matchmaking/leave", { userId: a }); // idle
        await step("GET", `/api/matchmaking/status/${a}`, undefined, secret); // idle
        await step("POST", "/api/matchmaking/join", { userId: a }); // waiting again
        const matched = await step("POST", "/api/matchmaking/join", { userId: b }); // matched with A
        const matchId = (matched.body as any).matchId as string;
        names[matchId] = "<match>";
        out[out.length - 1] = { status: matched.status, body: label(matched.body, names) };
        const seenByA = await step("GET", `/api/matchmaking/status/${a}`, undefined, secret);
        out[out.length - 1] = { status: seenByA.status, body: label(seenByA.body, names) };
        await step("POST", "/api/matchmaking/join", { userId: b }); // existing match returned
        await step("POST", "/api/matchmaking/leave", { userId: b }); // 409
        return out;
      };

      const fromExpress = await run(express.baseUrl, exA.id, exB.id);
      const fromWorker = await run(worker.baseUrl, wkA.id, wkB.id);
      expect(fromWorker).toEqual(fromExpress);
      // And the sequence really did exercise a match (not two identical failures).
      expect(JSON.stringify(fromWorker)).toContain('"state":"matched"');
      expect(JSON.stringify(fromWorker)).toContain("Cannot leave matchmaking");
    } finally {
      await f.cleanup();
    }
  }, 60_000);
});
