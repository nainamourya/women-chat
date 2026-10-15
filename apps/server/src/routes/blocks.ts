import { Router } from "express";
import { z } from "zod";
import { AuthError } from "../services/auth.service.js";
import { blockUser, unblockUser } from "../services/blocks.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";
import { checkLimitFailOpen, sendRateLimitedResponse } from "../redis/rateLimit.js";

export const blocksRouter = Router();

blocksRouter.use(requireInternalSecret);

// `blockerUserId` is always the Next.js server's own trusted session user
// id, never client input — same trust model as the matchmaking router.
const blockBodySchema = z.object({
  blockerUserId: z.string().uuid(),
  blockedUserId: z.string().uuid(),
});

// Initial suggestion (Phase 3), not a measured requirement. Block and
// unblock share one bucket (managing your block list is one feature) keyed
// by blockerUserId — generous enough for normal use, a backstop against a
// scripted block/unblock loop.
const BLOCK_LIMIT = 20;
const BLOCK_WINDOW_SECONDS = 60 * 60;

blocksRouter.post("/", async (req, res) => {
  const parsed = blockBodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  const limit = await checkLimitFailOpen(
    `ratelimit:block:${parsed.data.blockerUserId}`,
    BLOCK_LIMIT,
    BLOCK_WINDOW_SECONDS,
    "block:create",
  );
  if (!limit.allowed) return sendRateLimitedResponse(res, limit.retryAfterSeconds);

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

  const limit = await checkLimitFailOpen(
    `ratelimit:block:${parsed.data.blockerUserId}`,
    BLOCK_LIMIT,
    BLOCK_WINDOW_SECONDS,
    "block:unblock",
  );
  if (!limit.allowed) return sendRateLimitedResponse(res, limit.retryAfterSeconds);

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
