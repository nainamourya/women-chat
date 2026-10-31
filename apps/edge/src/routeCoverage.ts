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
  {
    method: "GET",
    path: "/api/health/ready",
    status: "partial",
    blocker: "Reports Postgres only. The Express version also pings Redis, which does not exist in the Worker yet.",
    unblockedBy: "Stage C (Redis replacement)",
  },
  { method: "GET", path: "/api/interests", status: "ported" },
  { method: "GET", path: "/api/profile/:userId", status: "ported" },
  { method: "PUT", path: "/api/profile/:userId", status: "ported" },
  { method: "PUT", path: "/api/profile/:userId/interests", status: "ported" },
  { method: "POST", path: "/api/ice-servers", status: "ported" },
  { method: "GET", path: "/api/admin/stats/overview", status: "ported" },
  { method: "GET", path: "/api/admin/users", status: "ported" },

  // --- Blocked ------------------------------------------------------------
  {
    method: "PATCH",
    path: "/api/admin/users/:id",
    status: "blocked",
    blocker: "Suspending or banning must disconnect the user's live sockets (disconnectUser, Socket.IO). Skipping that would weaken the action.",
    unblockedBy: "Stage C (Durable Object real-time)",
  },
  {
    method: "DELETE",
    path: "/api/admin/users/:id",
    status: "blocked",
    blocker: "Deleting a user must disconnect their live sockets (disconnectUser, Socket.IO).",
    unblockedBy: "Stage C (Durable Object real-time)",
  },
  {
    method: "*",
    path: "/api/auth",
    prefix: true,
    status: "blocked",
    blocker: "Login/registration rate limits use Redis (checkLimitFailOpen) and the client IP. bcrypt CPU cost also needs checking on Workers.",
    unblockedBy: "Stage C (rate-limit replacement)",
  },
  {
    method: "*",
    path: "/api/verification",
    prefix: true,
    status: "blocked",
    blocker: "Redis rate limits plus verification video upload (R2, music-metadata, large bodies).",
    unblockedBy: "Stage C (rate limits), Stage E (video upload)",
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
    unblockedBy: "Stages C and E",
  },
  {
    method: "*",
    path: "/api/account",
    prefix: true,
    status: "blocked",
    blocker: "Redis rate limit, matchmaking-queue removal and socket disconnect on deletion, plus R2 media deletion.",
    unblockedBy: "Stages C, D and E",
  },
  {
    method: "*",
    path: "/api/matchmaking",
    prefix: true,
    status: "blocked",
    blocker: "Redis matchmaking queue, one-time socket tickets and rate limits.",
    unblockedBy: "Stages C and D",
  },
  {
    method: "*",
    path: "/api/reports",
    prefix: true,
    status: "blocked",
    blocker: "Redis rate limits and evidence image storage (local disk in the Express server).",
    unblockedBy: "Stages C and E",
  },
  {
    method: "*",
    path: "/api/blocks",
    prefix: true,
    status: "blocked",
    blocker: "Redis rate limits (checkLimitFailOpen).",
    unblockedBy: "Stage C (rate-limit replacement)",
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
