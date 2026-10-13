import { Router } from "express";
import { z } from "zod";
import { requireInternalSecret } from "../middleware/internalAuth.js";
import { getIceServers } from "../services/iceServers.service.js";

export const iceServersRouter = Router();

iceServersRouter.use(requireInternalSecret);

// `userId` is always the Next.js server's own trusted session user id, never
// client input — same trust model as the matchmaking router.
const bodySchema = z.object({ userId: z.string().uuid() });

iceServersRouter.post("/", (req, res) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const { iceServers, turnConfigured } = getIceServers(parsed.data.userId);
  res.status(200).json({ iceServers, turnConfigured });
});
