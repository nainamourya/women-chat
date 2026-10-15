import { Router, json } from "express";
import { z } from "zod";
import { AuthError } from "../services/auth.service.js";
import { simulatePrototypeVerification } from "../services/verification.service.js";
import {
  getOwnLatestSubmission,
  submitVerificationVideo,
} from "../services/videoVerification.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";
import { checkLimitFailOpen, sendRateLimitedResponse } from "../redis/rateLimit.js";

export const verificationRouter = Router();

verificationRouter.use(requireInternalSecret);

const submitVideoSchema = z.object({
  userId: z.string().uuid(),
  videoBase64: z.string().min(1),
  mimeType: z.string().min(1),
  acknowledgedNotice: z.boolean(),
});

// `userId` is always the Next.js server's own trusted session user id,
// never client input — same trust model as every other internal route.
// Route-specific, larger body limit — a 25MB raw video is ~33MB once
// base64-encoded, well past the app-wide 8mb JSON limit (sized for report
// evidence images). Scoped to only this one route rather than raising the
// global default, so every other endpoint keeps the smaller limit.
const videoJsonParser = json({ limit: "40mb" });

verificationRouter.post("/video", videoJsonParser, async (req, res) => {
  const parsed = submitVideoSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  // Generous but present — uploads are infrequent by nature, this just
  // bounds a scripted retry loop.
  const limit = await checkLimitFailOpen(
    `ratelimit:verification:video:${parsed.data.userId}`,
    5,
    60 * 60,
    "verification:video",
  );
  if (!limit.allowed) return sendRateLimitedResponse(res, limit.retryAfterSeconds);

  try {
    const submission = await submitVerificationVideo(
      parsed.data.userId,
      parsed.data.videoBase64,
      parsed.data.mimeType,
      parsed.data.acknowledgedNotice,
    );
    res.status(201).json({ submission });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("submit verification video error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const statusParamsSchema = z.object({ userId: z.string().uuid() });

verificationRouter.get("/video/status/:userId", async (req, res) => {
  const parsed = statusParamsSchema.safeParse(req.params);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  try {
    const submission = await getOwnLatestSubmission(parsed.data.userId);
    res.status(200).json({ submission });
  } catch (err) {
    console.error("verification status error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const simulateSchema = z.object({
  userId: z.string().uuid(),
});

// PROTOTYPE ONLY — see verification.service.ts. Not a real identity/age check.
verificationRouter.post("/simulate", async (req, res) => {
  const parsed = simulateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    const user = await simulatePrototypeVerification(parsed.data.userId);
    res.status(200).json({ user });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("verification simulate error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
