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
  /** What a blocked route answers with (501), when the generic text would mislead. */
  message?: string;
  /** Exists only on the Worker: a replacement for an Express route that cannot run there. */
  edgeOnly?: boolean;
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
  // Stages C and D: the whole matchmaking router. socket-ticket came first (it is
  // real-time transport); join, leave and status arrived with the Matchmaker
  // Durable Object, which replaced the Redis queue.
  { method: "POST", path: "/api/matchmaking/socket-ticket", status: "ported" },
  { method: "POST", path: "/api/matchmaking/join", status: "ported" },
  { method: "POST", path: "/api/matchmaking/leave", status: "ported" },
  { method: "GET", path: "/api/matchmaking/status/:userId", status: "ported" },

  // --- Stage E: the rest of the server's routers --------------------------------
  // Served by the server's own routers and services, unchanged. Underneath, the
  // rate limiter is the Durable Object limiter and storage is R2 (src/shims).
  { method: "*", path: "/api/auth", prefix: true, status: "ported" },
  { method: "*", path: "/api/blocks", prefix: true, status: "ported" },
  { method: "*", path: "/api/reports", prefix: true, status: "ported" },
  { method: "*", path: "/api/social", prefix: true, status: "ported" },
  { method: "*", path: "/api/account", prefix: true, status: "ported" },
  { method: "*", path: "/api/admin/verification", prefix: true, status: "ported" },

  // Verification: the base64-in-JSON video upload cannot run in a Worker, so it is
  // blocked and replaced by a streaming upload. Everything else on the router is
  // served. The exact blocked entry must come before the router's prefix entry.
  {
    method: "POST",
    path: "/api/verification/video",
    status: "blocked",
    blocker:
      "The video arrives as a base64 string inside a JSON body (~33 MB for 25 MB of video). A Worker has 128 MB of memory and that path holds the raw body, the string, the parsed copy and the decoded bytes at once, so it is not safe. Replaced by PUT /api/verification/video/:userId (raw bytes streamed into R2).",
    unblockedBy: "Replaced: browsers upload directly with PUT /api/verification/video-upload (signed one-time authorization); see STORAGE.md",
    message: "Base64 video upload is not available on the edge backend. Use PUT /api/verification/video/:userId with the raw video.",
  },
  {
    method: "PUT",
    path: "/api/verification/video/:userId",
    status: "ported",
    edgeOnly: true,
  },
  {
    method: "PUT",
    path: "/api/verification/video-upload",
    status: "ported",
    edgeOnly: true,
  },
  {
    method: "POST",
    path: "/api/verification/video-authorization/check",
    status: "ported",
    edgeOnly: true,
  },
  { method: "*", path: "/api/verification", prefix: true, status: "ported" },
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
