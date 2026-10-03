import { Router } from "express";
import { z } from "zod";
import { AuthError } from "../services/auth.service.js";
import { getMatchmakingStatus, joinMatchmaking, leaveMatchmaking } from "../services/matchmaking.service.js";
import { mintSocketTicket } from "../redis/socketTickets.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const matchmakingRouter = Router();

matchmakingRouter.use(requireInternalSecret);

// `userId` is always the Next.js server's own trusted session user id, never
// client input — same trust model as the profile router.
const userIdBodySchema = z.object({ userId: z.string().uuid() });
const userIdParamSchema = z.object({ userId: z.string().uuid() });

matchmakingRouter.post("/join", async (req, res) => {
  const parsed = userIdBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

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

  const ticket = await mintSocketTicket(parsed.data.userId);
  res.status(200).json({ ticket });
});
