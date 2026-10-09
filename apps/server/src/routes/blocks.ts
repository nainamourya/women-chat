import { Router } from "express";
import { z } from "zod";
import { AuthError } from "../services/auth.service.js";
import { blockUser, unblockUser } from "../services/blocks.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const blocksRouter = Router();

blocksRouter.use(requireInternalSecret);

// `blockerUserId` is always the Next.js server's own trusted session user
// id, never client input — same trust model as the matchmaking router.
const blockBodySchema = z.object({
  blockerUserId: z.string().uuid(),
  blockedUserId: z.string().uuid(),
});

blocksRouter.post("/", async (req, res) => {
  const parsed = blockBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await blockUser(parsed.data.blockerUserId, parsed.data.blockedUserId);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("block user error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

blocksRouter.delete("/", async (req, res) => {
  const parsed = blockBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await unblockUser(parsed.data.blockerUserId, parsed.data.blockedUserId);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("unblock user error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
