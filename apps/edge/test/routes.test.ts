import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  DEFAULT_TEST_VARS,
  TEST_INTERNAL_SECRET,
  TEST_ORIGIN,
  startLocalWorker,
  type RunningWorker,
} from "./localWorker";
import { readUser, seedRows, type Seed } from "./seed";

const SECRET = { "x-internal-api-secret": TEST_INTERNAL_SECRET };
const JSON_HEADERS = { ...SECRET, "content-type": "application/json" };

async function call(worker: RunningWorker, method: string, path: string, init: { headers?: Record<string, string>; body?: unknown; rawBody?: string } = {}) {
  const res = await fetch(`${worker.baseUrl}${path}`, {
    method,
    headers: init.headers,
    body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  const text = await res.text();
  let json: unknown = undefined;
  try {
    json = JSON.parse(text);
  } catch {
    // not JSON
  }
  return { status: res.status, json, text, headers: res.headers };
}

describe("ported REST routes on the edge Worker (local Docker Postgres)", () => {
  let worker: RunningWorker;
  let seed: Seed;

  beforeAll(async () => {
    seed = await seedRows();
    worker = await startLocalWorker(8801);
  });
  afterAll(async () => {
    worker?.stop();
    await seed?.cleanup();
  });

  // ---- internal API authentication (must match Express: 401, same body) ----
  describe("internal API authentication", () => {
    const protectedRoutes: Array<[string, string, unknown?]> = [
      ["GET", "/api/interests"],
      ["GET", "/api/profile/00000000-0000-4000-8000-000000000001"],
      ["PUT", "/api/profile/00000000-0000-4000-8000-000000000001", { bio: "x" }],
      ["PUT", "/api/profile/00000000-0000-4000-8000-000000000001/interests", { interestIds: [] }],
      ["POST", "/api/ice-servers", { userId: "00000000-0000-4000-8000-000000000001" }],
      ["GET", "/api/admin/stats/overview?adminUserId=00000000-0000-4000-8000-000000000001"],
      ["GET", "/api/admin/users?adminUserId=00000000-0000-4000-8000-000000000001"],
    ];

    for (const [method, path, body] of protectedRoutes) {
      it(`${method} ${path.split("?")[0]} rejects a missing secret`, async () => {
        const res = await call(worker, method, path, { headers: { "content-type": "application/json" }, body });
        expect(res.status).toBe(401);
        expect(res.json).toEqual({ error: "Unauthorized." });
      });

      it(`${method} ${path.split("?")[0]} rejects a wrong secret`, async () => {
        const res = await call(worker, method, path, { headers: { "content-type": "application/json", "x-internal-api-secret": "wrong-secret-value-0123456789" }, body });
        expect(res.status).toBe(401);
        expect(res.json).toEqual({ error: "Unauthorized." });
      });
    }

    it("a wrong secret is rejected before any database work (no rows change)", async () => {
      const before = await readUser(seed.memberId);
      await call(worker, "PUT", `/api/profile/${seed.memberId}`, { headers: { "content-type": "application/json" }, body: { displayName: "Hijacked" } });
      expect((await readUser(seed.memberId))?.displayName).toBe(before?.displayName);
    });
  });

  // ---- validation failures ----
  describe("validation failures", () => {
    it("profile: non-uuid user id -> 400", async () => {
      const res = await call(worker, "GET", "/api/profile/not-a-uuid", { headers: SECRET });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: "Invalid user id." });
    });

    it("profile: bio over 500 chars -> 400 with field errors", async () => {
      const res = await call(worker, "PUT", `/api/profile/${seed.memberId}`, { headers: JSON_HEADERS, body: { bio: "x".repeat(501) } });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: { bio: ["Bio must be 500 characters or fewer."] } });
    });

    it("profile: display name too short -> 400", async () => {
      const res = await call(worker, "PUT", `/api/profile/${seed.memberId}`, { headers: JSON_HEADERS, body: { displayName: "a" } });
      expect(res.status).toBe(400);
      expect(res.json).toHaveProperty("error.displayName");
    });

    it("profile interests: more than 15 -> 400", async () => {
      const ids = Array.from({ length: 16 }, () => crypto.randomUUID());
      const res = await call(worker, "PUT", `/api/profile/${seed.memberId}/interests`, { headers: JSON_HEADERS, body: { interestIds: ids } });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: { interestIds: ["Choose up to 15 interests."] } });
    });

    it("profile interests: unknown interest id -> 400 from the service", async () => {
      const res = await call(worker, "PUT", `/api/profile/${seed.memberId}/interests`, { headers: JSON_HEADERS, body: { interestIds: [crypto.randomUUID()] } });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: "One or more interests are invalid." });
    });

    it("ice-servers: invalid user id -> 400", async () => {
      const res = await call(worker, "POST", "/api/ice-servers", { headers: JSON_HEADERS, body: { userId: "nope" } });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: "Invalid user id." });
    });

    it("admin stats: missing adminUserId -> 400", async () => {
      const res = await call(worker, "GET", "/api/admin/stats/overview", { headers: SECRET });
      expect(res.status).toBe(400);
      expect(res.json).toEqual({ error: "Invalid request." });
    });

    it("admin users: overlong search -> 400", async () => {
      const res = await call(worker, "GET", `/api/admin/users?adminUserId=${seed.adminId}&search=${"x".repeat(201)}`, { headers: SECRET });
      expect(res.status).toBe(400);
    });

    it("malformed JSON body is rejected with 400 and changes nothing", async () => {
      const res = await call(worker, "PUT", `/api/profile/${seed.memberId}`, { headers: JSON_HEADERS, rawBody: "{not json" });
      expect(res.status).toBe(400);
    });
  });

  // ---- authorization ----
  describe("authorization", () => {
    it("admin stats: a non-admin is refused (403)", async () => {
      const res = await call(worker, "GET", `/api/admin/stats/overview?adminUserId=${seed.memberId}`, { headers: SECRET });
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ error: "Admin access required." });
    });

    it("admin users: a non-admin is refused (403)", async () => {
      const res = await call(worker, "GET", `/api/admin/users?adminUserId=${seed.memberId}`, { headers: SECRET });
      expect(res.status).toBe(403);
      expect(res.json).toEqual({ error: "Admin access required." });
    });

    it("admin stats: an unknown admin id is refused", async () => {
      const res = await call(worker, "GET", `/api/admin/stats/overview?adminUserId=${crypto.randomUUID()}`, { headers: SECRET });
      expect([403, 404]).toContain(res.status);
    });
  });

  // ---- happy paths (real database through the request-scoped client) ----
  describe("successful requests", () => {
    it("GET /api/interests lists the catalog", async () => {
      const res = await call(worker, "GET", "/api/interests", { headers: SECRET });
      expect(res.status).toBe(200);
      const names = (res.json as { interests: Array<{ id: string }> }).interests.map((i) => i.id);
      for (const id of seed.interestIds) expect(names).toContain(id);
    });

    it("PUT profile updates bio and display name; GET reads them back", async () => {
      const put = await call(worker, "PUT", `/api/profile/${seed.memberId}`, { headers: JSON_HEADERS, body: { bio: "Edge bio", displayName: "Edge Renamed" } });
      expect(put.status).toBe(200);
      const get = await call(worker, "GET", `/api/profile/${seed.memberId}`, { headers: SECRET });
      expect(get.status).toBe(200);
      expect(get.json).toMatchObject({ profile: { userId: seed.memberId, bio: "Edge bio", displayName: "Edge Renamed", email: seed.memberEmail } });
      expect((await readUser(seed.memberId))?.displayName).toBe("Edge Renamed");
    });

    it("PUT interests (transaction) replaces the selection", async () => {
      const res = await call(worker, "PUT", `/api/profile/${seed.memberId}/interests`, { headers: JSON_HEADERS, body: { interestIds: seed.interestIds } });
      expect(res.status).toBe(200);
      expect((res.json as { interests: unknown[] }).interests).toHaveLength(2);
      const cleared = await call(worker, "PUT", `/api/profile/${seed.memberId}/interests`, { headers: JSON_HEADERS, body: { interestIds: [] } });
      expect((cleared.json as { interests: unknown[] }).interests).toHaveLength(0);
    });

    it("POST /api/ice-servers returns STUN-only when no TURN is configured", async () => {
      const res = await call(worker, "POST", "/api/ice-servers", { headers: JSON_HEADERS, body: { userId: seed.memberId } });
      expect(res.status).toBe(200);
      expect(res.json).toEqual({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }], turnConfigured: false });
    });

    it("GET /api/admin/stats/overview works for an admin", async () => {
      const res = await call(worker, "GET", `/api/admin/stats/overview?adminUserId=${seed.adminId}`, { headers: SECRET });
      expect(res.status).toBe(200);
      expect(res.json).toHaveProperty("stats");
    });

    it("GET /api/admin/users finds a seeded member by search", async () => {
      const res = await call(worker, "GET", `/api/admin/users?adminUserId=${seed.adminId}&search=${encodeURIComponent(seed.memberEmail)}`, { headers: SECRET });
      expect(res.status).toBe(200);
      const users = (res.json as { users: Array<{ id: string; passwordHash?: unknown }> }).users;
      expect(users.map((u) => u.id)).toEqual([seed.memberId]);
      expect(users[0]).not.toHaveProperty("passwordHash");
    });
  });

  // ---- CORS parity ----
  describe("CORS", () => {
    it("reflects an allow-listed origin with credentials", async () => {
      const res = await call(worker, "GET", "/api/health", { headers: { origin: TEST_ORIGIN } });
      expect(res.headers.get("access-control-allow-origin")).toBe(TEST_ORIGIN);
      expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    });

    it("sends no CORS headers to an unlisted origin", async () => {
      const res = await call(worker, "GET", "/api/health", { headers: { origin: "https://evil.example" } });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    });
  });

  // ---- routes that are NOT served yet must fail loudly, never succeed ----
  describe("blocked routes answer 501 (after the secret check) and do nothing", () => {
    const blocked: Array<[string, string]> = [
      ["POST", "/api/auth/login"],
      ["POST", "/api/auth/register"],
      ["POST", "/api/matchmaking/join"],
      ["GET", "/api/social/feed"],
      ["POST", "/api/reports"],
      ["POST", "/api/blocks"],
      ["POST", "/api/account/delete"],
      ["POST", "/api/verification/video"],
      ["GET", "/api/admin/verification"],
    ];
    for (const [method, path] of blocked) {
      it(`${method} ${path}: 401 without the secret, 501 with it`, async () => {
        const noSecret = await call(worker, method, path, { headers: { "content-type": "application/json" }, rawBody: method === "GET" ? undefined : "{}" });
        expect(noSecret.status).toBe(401);
        const withSecret = await call(worker, method, path, { headers: JSON_HEADERS, rawBody: method === "GET" ? undefined : "{}" });
        expect(withSecret.status).toBe(501);
        expect(withSecret.json).toEqual({ error: "Not available on the edge backend yet." });
      });
    }

    it("PATCH /api/admin/users/:id (ban) is refused and the user stays active", async () => {
      const res = await call(worker, "PATCH", `/api/admin/users/${seed.targetId}`, { headers: JSON_HEADERS, body: { adminUserId: seed.adminId, action: "ban" } });
      expect(res.status).toBe(501);
      expect((await readUser(seed.targetId))?.accountStatus).toBe("active");
    });

    it("DELETE /api/admin/users/:id is refused and the user still exists", async () => {
      const res = await call(worker, "DELETE", `/api/admin/users/${seed.targetId}?adminUserId=${seed.adminId}`, { headers: SECRET });
      expect(res.status).toBe(501);
      expect(await readUser(seed.targetId)).toBeDefined();
    });
  });
});

describe("database failure", () => {
  let worker: RunningWorker;
  beforeAll(async () => {
    // A closed local port that still passes the test-target guard.
    worker = await startLocalWorker(8802, { databaseUrl: "postgresql://u:p@127.0.0.1:1/unreachable_test" });
  });
  afterAll(() => worker?.stop());

  it("a route whose query fails answers the generic 500 and leaks nothing", async () => {
    const res = await call(worker, "GET", "/api/interests", { headers: SECRET });
    expect(res.status).toBe(500);
    expect(res.json).toEqual({ error: "Something went wrong." });
    expect(res.text).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|postgres|u:p/i);
  });

  it("a route that never queries still works (no connection is opened for it)", async () => {
    const res = await call(worker, "POST", "/api/ice-servers", { headers: JSON_HEADERS, body: { userId: crypto.randomUUID() } });
    expect(res.status).toBe(200);
  });

  it("readiness reports the database as down with 503", async () => {
    const res = await call(worker, "GET", "/api/health/ready");
    expect(res.status).toBe(503);
    expect(res.json).toEqual({ status: "error", dependencies: { postgres: "error" } });
  });
});

describe("configuration fails closed", () => {
  const cases: Array<[string, number, Record<string, string>]> = [
    ["production with a short internal secret", 8803, { ...DEFAULT_TEST_VARS, NODE_ENV: "production", INTERNAL_API_SECRET: "short-secret-0123456789" }],
    ["production with a placeholder-looking secret", 8804, { ...DEFAULT_TEST_VARS, NODE_ENV: "production", INTERNAL_API_SECRET: "replace-me-with-a-long-random-value-9f8e7d6c" }],
    ["NODE_ENV missing", 8805, { CORS_ORIGIN: TEST_ORIGIN, INTERNAL_API_SECRET: TEST_INTERNAL_SECRET }],
    ["INTERNAL_API_SECRET missing", 8806, { NODE_ENV: "test", CORS_ORIGIN: TEST_ORIGIN }],
  ];
  const running: RunningWorker[] = [];

  for (const [name, port, vars] of cases) {
    it(`${name}: every request is 503, including health and protected routes`, async () => {
      const w = await startLocalWorker(port, { vars, anyResponseCountsAsUp: true });
      running.push(w);
      for (const path of ["/api/health", "/api/interests", "/api/health/ready"]) {
        const res = await call(w, "GET", path, { headers: SECRET });
        expect(res.status, path).toBe(503);
        expect(res.json).toEqual({ error: "Service unavailable." });
      }
    });
  }

  it("a valid production configuration is accepted", async () => {
    const strong = "k9Xv2mQpL7wRtB4nZc8YhJdF3sGaU6eN5xVbM1qWoP0iT";
    const w = await startLocalWorker(8807, { vars: { NODE_ENV: "production", CORS_ORIGIN: TEST_ORIGIN, INTERNAL_API_SECRET: strong } });
    running.push(w);
    const live = await call(w, "GET", "/api/health");
    expect(live.status).toBe(200);
    const authed = await call(w, "GET", "/api/interests", { headers: { "x-internal-api-secret": strong } });
    expect(authed.status).toBe(200);
    const test = await call(w, "GET", "/api/interests", { headers: SECRET });
    expect(test.status).toBe(401);
  });

  afterAll(() => running.forEach((w) => w.stop()));
});
