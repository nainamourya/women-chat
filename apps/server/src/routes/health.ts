import { Router } from "express";
import { pingRedis } from "../redis/client.js";
import { pingDb } from "../db/client.js";

export const healthRouter = Router();

// Liveness: confirms the process itself is up and responsive. Deliberately
// does not touch Redis/Postgres — platforms typically poll liveness very
// frequently, and a dependency outage is a readiness concern, not a "is this
// process alive" one, so hitting them here would add load for no benefit.
healthRouter.get("/", (_req, res) => {
  res.json({ status: "ok" });
});

const READINESS_CACHE_MS = 1000;
let cachedReadiness: { at: number; httpStatus: number; body: unknown } | null = null;

// Readiness: confirms this instance can actually serve traffic — safe to use
// as a load balancer/orchestrator readiness probe. Short-cached so a
// misconfigured monitor polling faster than this can't turn into repeated
// Redis/Postgres round-trips per request; never reports healthy if a
// dependency is down, and never leaks connection strings or raw error
// details in the response (those are logged server-side only).
healthRouter.get("/ready", async (_req, res) => {
  const now = Date.now();
  if (cachedReadiness && now - cachedReadiness.at < READINESS_CACHE_MS) {
    res.status(cachedReadiness.httpStatus).json(cachedReadiness.body);
    return;
  }

  const [redisOk, dbOk] = await Promise.all([pingRedis(), pingDb()]);
  const ok = redisOk && dbOk;
  const body = {
    status: ok ? "ok" : "error",
    dependencies: {
      redis: redisOk ? "ok" : "error",
      postgres: dbOk ? "ok" : "error",
    },
  };
  const httpStatus = ok ? 200 : 503;

  cachedReadiness = { at: now, httpStatus, body };
  res.status(httpStatus).json(body);
});
