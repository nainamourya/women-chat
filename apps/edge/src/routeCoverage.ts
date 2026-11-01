// Single source of truth for which Express routes the edge Worker serves in
// Stage B. app.ts answers 501 for everything marked "blocked"; the coverage
// test (test/routeCoverage.test.ts) fails if any route in apps/server is
// missing from this table, so a route cannot be forgotten.
//
// Matching: `path` may contain `:param` segments. A `prefix` entry covers that
// path and everything beneath it.

export type RouteStatus = "ported" | "partial" | "blocked";

export type CoverageEntry = {
  method: string; // "GET", "PUT", … or "*" for any method
  path: string;
  prefix?: boolean;
  status: RouteStatus;
  /** What exactly stops this route (blocked/partial) — shown in the report. */
  blocker?: string;
  /** Stage expected to unblock it. */
  unblockedBy?: string;
};

export const ROUTE_COVERAGE: CoverageEntry[] = [
  // --- Ported -------------------------------------------------------------
  { method: "GET", path: "/api/health", status: "ported" },
  // Readiness reports Postgres and the real-time Durable Objects. It has no
  // `redis` entry on purpose: Redis was replaced, not reproduced (Stage C).
  { method: "GET", path: "/api/health/ready", status: "ported" },
  { method: "GET", path: "/api/interests", status: "ported" },
  { method: "GET", path: "/api/profile/:userId", status: "ported" },
  { method: "PUT", path: "/api/profile/:userId", status: "ported" },
  { method: "PUT", path: "/api/profile/:userId/interests", status: "ported" },
  { method: "POST", path: "/api/ice-servers", status: "ported" },
  { method: "GET", path: "/api/admin/stats/overview", status: "ported" },
  { method: "GET", path: "/api/admin/users", status: "ported" },
  // Stage C: disconnectUser now reaches the user's live sockets (UserHub).
  { method: "PATCH", path: "/api/admin/users/:id", status: "ported" },
  { method: "DELETE", path: "/api/admin/users/:id", status: "ported" },
  // Stage C: only the socket-ticket route of the matchmaking router — it is
  // real-time transport (the browser needs a ticket to open a socket). The rest
  // of that router is matchmaking and stays blocked below. Listed before the
  // prefix entry so it wins.
  { method: "POST", path: "/api/matchmaking/socket-ticket", status: "ported" },

  // --- Blocked ------------------------------------------------------------
  {
    method: "*",
    path: "/api/auth",
    prefix: true,
    status: "blocked",
    blocker: "The routes import the Redis rate limiter (checkLimitFailOpen) and key on the client IP. The Durable Object limiter now exists but is not wired to the HTTP routes yet. bcrypt CPU cost on Workers is also unmeasured.",
    unblockedBy: "A later stage (limiter shim for HTTP routes, CF-Connecting-IP)",
  },
  {
    method: "*",
    path: "/api/verification",
    prefix: true,
    status: "blocked",
    blocker: "Redis rate limits plus verification video upload (R2, music-metadata, large bodies).",
    unblockedBy: "A later stage (limiter shim) and Stage E (video upload)",
  },
  {
    method: "*",
    path: "/api/admin/verification",
    prefix: true,
    status: "blocked",
    blocker: "Reads and deletes verification videos through the R2 S3 client and music-metadata (videoVerification.service).",
    unblockedBy: "Stage E (storage)",
  },
  {
    method: "*",
    path: "/api/social",
    prefix: true,
    status: "blocked",
    blocker: "Redis rate limits, R2 media storage, image sanitising CPU, and Socket.IO pushes (dm:message, notification:new).",
    unblockedBy: "A later stage (limiter shim) and Stage E",
  },
  {
    method: "*",
    path: "/api/account",
    prefix: true,
    status: "blocked",
    blocker: "Redis rate limit, matchmaking-queue removal and socket disconnect on deletion, plus R2 media deletion.",
    unblockedBy: "Stages D and E",
  },
  {
    method: "*",
    path: "/api/matchmaking",
    prefix: true,
    status: "blocked",
    blocker: "Redis matchmaking queue and matchmaking rate limits (join, leave, status). Only socket-ticket is ported.",
    unblockedBy: "Stage D",
  },
  {
    method: "*",
    path: "/api/reports",
    prefix: true,
    status: "blocked",
    blocker: "Redis rate limits and evidence image storage (local disk in the Express server).",
    unblockedBy: "A later stage (limiter shim) and Stage E",
  },
  {
    method: "*",
    path: "/api/blocks",
    prefix: true,
    status: "blocked",
    blocker: "Imports the Redis rate limiter (checkLimitFailOpen). The Durable Object limiter now exists but is not wired to the HTTP routes yet; nothing else blocks this router.",
    unblockedBy: "A later stage (limiter shim for HTTP routes)",
  },
];

function segments(p: string): string[] {
  return p.split("/").filter(Boolean);
}

function pathMatches(entry: CoverageEntry, requestPath: string): boolean {
  const want = segments(entry.path);
  const got = segments(requestPath);
  if (entry.prefix ? got.length < want.length : got.length !== want.length) return false;
  return want.every((segment, i) => segment.startsWith(":") || segment === got[i]);
}

export function findCoverage(method: string, requestPath: string): CoverageEntry | undefined {
  return ROUTE_COVERAGE.find(
    (entry) => (entry.method === "*" || entry.method === method.toUpperCase()) && pathMatches(entry, requestPath),
  );
}

/** Blocked routes are answered 501 by the Worker; nothing is stubbed. */
export function findBlocked(method: string, requestPath: string): CoverageEntry | undefined {
  const entry = findCoverage(method, requestPath);
  return entry?.status === "blocked" ? entry : undefined;
}
