import { Router } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { AuthError, assertEligible } from "../services/auth.service.js";
import { getMatchmakingStatus, joinMatchmaking, leaveMatchmaking } from "../services/matchmaking.service.js";
import { mintSocketTicket } from "../redis/socketTickets.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";
import { checkLimitFailOpen, sendRateLimitedResponse } from "../redis/rateLimit.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";

export const matchmakingRouter = Router();

matchmakingRouter.use(requireInternalSecret);

// `userId` is always the Next.js server's own trusted session user id, never
// client input — same trust model as the profile router. All limits below
// are keyed by this same trusted id, not anything client-supplied.
const userIdBodySchema = z.object({ userId: z.string().uuid() });
const userIdParamSchema = z.object({ userId: z.string().uuid() });

// Initial suggestions (Phase 2), not measured requirements — see the
// rate-limiting audit this is based on.
const JOIN_LIMIT = 5;
const JOIN_WINDOW_SECONDS = 10; // burst allowance so retrying after a cancel/leave isn't blocked
const LEAVE_LIMIT = 5;
const LEAVE_WINDOW_SECONDS = 10;
const STATUS_LIMIT = 30;
const STATUS_WINDOW_SECONDS = 30; // ~1/sec average — comfortably covers the real 4s client poll interval
const SOCKET_TICKET_LIMIT = 10;
const SOCKET_TICKET_WINDOW_SECONDS = 60;

matchmakingRouter.post("/join", async (req, res) => {
  const parsed = userIdBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const limit = await checkLimitFailOpen(
    `ratelimit:mm:join:${parsed.data.userId}`,
    JOIN_LIMIT,
    JOIN_WINDOW_SECONDS,
    "mm:join",
  );
  if (!limit.allowed) return sendRateLimitedResponse(res, limit.retryAfterSeconds);

  try {
    const status = await joinMatchmaking(parsed.data.userId);
    res.status(200).json(status);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("matchmaking join error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

matchmakingRouter.post("/leave", async (req, res) => {
  const parsed = userIdBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const limit = await checkLimitFailOpen(
    `ratelimit:mm:leave:${parsed.data.userId}`,
    LEAVE_LIMIT,
    LEAVE_WINDOW_SECONDS,
    "mm:leave",
  );
  if (!limit.allowed) return sendRateLimitedResponse(res, limit.retryAfterSeconds);

  try {
    const status = await leaveMatchmaking(parsed.data.userId);
    res.status(200).json(status);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("matchmaking leave error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

matchmakingRouter.get("/status/:userId", async (req, res) => {
  const parsed = userIdParamSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const limit = await checkLimitFailOpen(
    `ratelimit:mm:status:${parsed.data.userId}`,
    STATUS_LIMIT,
    STATUS_WINDOW_SECONDS,
    "mm:status",
  );
  if (!limit.allowed) return sendRateLimitedResponse(res, limit.retryAfterSeconds);

  try {
    const status = await getMatchmakingStatus(parsed.data.userId);
    res.status(200).json(status);
  } catch (err) {
    console.error("matchmaking status error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

matchmakingRouter.post("/socket-ticket", async (req, res) => {
  const parsed = userIdBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const limit = await checkLimitFailOpen(
    `ratelimit:socket-ticket:${parsed.data.userId}`,
    SOCKET_TICKET_LIMIT,
    SOCKET_TICKET_WINDOW_SECONDS,
    "socket-ticket",
  );
  if (!limit.allowed) return sendRateLimitedResponse(res, limit.retryAfterSeconds);

  // Defense in depth: authenticateSocket (socket/index.ts) already enforces
  // this on every connection, but failing fast here means a pending/
  // rejected user never even gets a ticket, let alone has to reach the
  // socket handshake to be turned away.
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
    console.error("socket-ticket eligibility check error:", err);
    return res.status(500).json({ error: "Something went wrong." });
  }

  const ticket = await mintSocketTicket(parsed.data.userId);
  res.status(200).json({ ticket });
});
