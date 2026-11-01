import express from "express";
import cors from "cors";
import { z } from "zod";
import { eq, sql } from "drizzle-orm";
import { getConfig } from "./config";
import { db } from "./db";
import { findBlocked } from "./routeCoverage";
// The Express server's own routers, reused unchanged: same validation, status
// codes, error handling and internal-secret check. (Their imports of the
// database client, environment and socket modules are redirected at build time
// — see scripts/build.mjs.)
import { requireInternalSecret } from "../../server/src/middleware/internalAuth";
import { AuthError, assertEligible } from "../../server/src/services/auth.service";
import { users } from "../../server/src/db/schema";
import { checkLimitFailOpen } from "./realtime/limiter";
import {
  SOCKET_TICKET_LIMIT,
  SOCKET_TICKET_TTL_MS,
  SOCKET_TICKET_WINDOW_SECONDS,
  getRequestContext,
  limiterFor,
  ticketStoreFor,
} from "./realtime/env";
import { registerTestHooks } from "./testHooks";
import { interestsRouter } from "../../server/src/routes/interests";
import { profileRouter } from "../../server/src/routes/profile";
import { iceServersRouter } from "../../server/src/routes/iceServers";
import { adminStatsRouter } from "../../server/src/routes/adminStats";
import { adminUsersRouter } from "../../server/src/routes/adminUsers";

export const app = express();

// Fail closed: with invalid configuration (see config.ts) nothing is served,
// not even liveness — the Express server refuses to start in the same case.
app.use((_req, res, next) => {
  if (!getConfig().ok) {
    return res.status(503).json({ error: "Service unavailable." });
  }
  next();
});

// Same policy as apps/server/src/index.ts (cors with an allow-list and
// credentials). A callback is used only because the list comes from
// configuration that is validated per isolate rather than at import time.
// Missing or unlisted origins get no CORS headers, exactly like the array form.
app.use(
  cors({
    origin: (origin, callback) => {
      const config = getConfig();
      callback(null, config.ok && origin !== undefined && config.corsOrigins.includes(origin));
    },
    credentials: true,
  }),
);

// Routes that cannot run in a Worker yet (see routeCoverage.ts) answer 501 —
// after the internal-secret check, so an unauthenticated caller still gets the
// same 401 as on Express and learns nothing about the route table. Placed
// before body parsing so an oversized body for a route we do not serve is never
// read. Nothing here pretends to succeed.
app.use((req, res, next) => {
  if (!findBlocked(req.method, req.path)) return next();
  requireInternalSecret(req, res, () => {
    res.status(501).json({ error: "Not available on the edge backend yet." });
  });
});

app.use(express.json({ limit: "8mb" }));

// Liveness: process is up. Same shape as the Express health router.
app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

// Readiness reports only dependencies the Worker really has: Postgres (through
// Hyperdrive) and the real-time Durable Objects (tickets, rate limiter). There
// is deliberately no `redis` entry — Redis was replaced, not reproduced, and
// claiming it here would be wrong. Never reports healthy when something is
// down, and never leaks connection details.
async function withTimeout<T>(work: Promise<T>, label: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      work,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} ping timed out`)), 2000);
      }),
    ]);
    return true;
  } catch (err) {
    // Error type only — the message could carry a host or connection string.
    console.error(`${label} health check failed:`, err instanceof Error ? err.name : "unknown error");
    return false;
  } finally {
    clearTimeout(timer);
  }
}

app.get("/api/health/ready", async (_req, res) => {
  const { env } = getRequestContext();
  const [dbOk, realtimeOk] = await Promise.all([
    withTimeout(db.execute(sql`select 1`), "Postgres"),
    // A throwaway key: proves the Durable Object namespaces answer without
    // touching anything real (the window expires on its own).
    withTimeout(limiterFor(env, "health:readiness").hit(1_000_000, 1), "Real-time"),
  ]);
  const ok = dbOk && realtimeOk;
  res.status(ok ? 200 : 503).json({
    status: ok ? "ok" : "error",
    dependencies: { postgres: dbOk ? "ok" : "error", realtime: realtimeOk ? "ok" : "error" },
  });
});

// Port of POST /socket-ticket from apps/server/src/routes/matchmaking.ts: same
// validation, same per-user limit (10 per 60 s, fail-open like the Express
// server), same eligibility check, same status codes and bodies. Only the
// ticket store changed (Redis -> TicketStore Durable Object). The rest of the
// matchmaking router (join/leave/status) is not part of this stage.
const userIdBodySchema = z.object({ userId: z.string().uuid() });

app.post("/api/matchmaking/socket-ticket", requireInternalSecret, async (req, res) => {
  const parsed = userIdBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }
  const { env } = getRequestContext();

  const limit = await checkLimitFailOpen(
    env,
    `ratelimit:socket-ticket:${parsed.data.userId}`,
    SOCKET_TICKET_LIMIT,
    SOCKET_TICKET_WINDOW_SECONDS,
    "socket-ticket",
  );
  if (!limit.allowed) {
    // Same generic 429 as sendRateLimitedResponse in the Express server.
    res.setHeader("Retry-After", String(Math.max(1, Math.ceil(limit.retryAfterSeconds))));
    return res.status(429).json({ error: "Too many attempts. Please try again later." });
  }

  // Defense in depth: socket authentication checks this again on every connection.
  try {
    const user = await db.query.users.findFirst({ where: eq(users.id, parsed.data.userId) });
    if (!user) {
      return res.status(404).json({ error: "User not found." });
    }
    assertEligible(user);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("socket-ticket eligibility check error:", err instanceof Error ? err.name : "unknown error");
    return res.status(500).json({ error: "Something went wrong." });
  }

  const ticket = crypto.randomUUID();
  try {
    await ticketStoreFor(env, ticket).mint(ticket, parsed.data.userId, SOCKET_TICKET_TTL_MS);
  } catch {
    // Fail closed: no ticket store means no ticket (the Express version throws here too).
    console.error("socket-ticket mint error: ticket store unavailable");
    return res.status(500).json({ error: "Something went wrong." });
  }
  res.status(200).json({ ticket });
});

registerTestHooks(app);

app.use("/api/interests", interestsRouter);
app.use("/api/profile", profileRouter);
app.use("/api/ice-servers", iceServersRouter);
app.use("/api/admin/stats", adminStatsRouter);
app.use("/api/admin/users", adminUsersRouter);
