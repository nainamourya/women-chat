import { Router } from "express";
import { z } from "zod";
import { AuthError, assertAdmin } from "../services/auth.service.js";
import {
  getSubmissionVideo,
  listSubmissions,
  recordReviewDecision,
  retryPendingDeletion,
} from "../services/videoVerification.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const adminVerificationRouter = Router();

adminVerificationRouter.use(requireInternalSecret);

const statusEnum = z.enum(["pending_review", "approved", "rejected", "resubmission_required"]);

const listQuerySchema = z.object({
  adminUserId: z.string().uuid(),
  status: statusEnum.optional(),
});

adminVerificationRouter.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await assertAdmin(parsed.data.adminUserId);
    const submissions = await listSubmissions(parsed.data.status);
    res.status(200).json({ submissions });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("list verification submissions error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const paramsWithIdSchema = z.object({ id: z.string().uuid() });
const adminQuerySchema = z.object({ adminUserId: z.string().uuid() });

// Binary passthrough of a submission's video — admin-only. Never logs the
// video bytes; only ever read back through this one authenticated endpoint.
adminVerificationRouter.get("/:id/video", async (req, res) => {
  const parsedParams = paramsWithIdSchema.safeParse(req.params);
  const parsedQuery = adminQuerySchema.safeParse(req.query);
  if (!parsedParams.success || !parsedQuery.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await assertAdmin(parsedQuery.data.adminUserId);
    const buffer = await getSubmissionVideo(parsedParams.data.id);
    res.setHeader("Content-Type", "video/mp4");
    // Never publicly cacheable — this is sensitive applicant media.
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).send(buffer);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return res.status(404).json({ error: "Video not found." });
    }
    console.error("get verification video error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const decisionSchema = z.object({
  adminUserId: z.string().uuid(),
  decision: z.enum(["approved", "rejected", "resubmission_required"]),
  rejectionReason: z
    .enum(["video_unclear_or_incomplete", "duration_or_format_invalid", "does_not_meet_guidelines", "other"])
    .optional(),
});

adminVerificationRouter.patch("/:id", async (req, res) => {
  const parsedParams = paramsWithIdSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  const parsedBody = decisionSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten().fieldErrors });
  }

  try {
    const admin = await assertAdmin(parsedBody.data.adminUserId);
    const result = await recordReviewDecision(
      parsedParams.data.id,
      admin.id,
      parsedBody.data.decision,
      parsedBody.data.rejectionReason,
    );
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("record verification decision error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

adminVerificationRouter.post("/:id/retry-deletion", async (req, res) => {
  const parsedParams = paramsWithIdSchema.safeParse(req.params);
  const parsedBody = adminQuerySchema.safeParse(req.body);
  if (!parsedParams.success || !parsedBody.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await assertAdmin(parsedBody.data.adminUserId);
    const result = await retryPendingDeletion(parsedParams.data.id);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("retry verification deletion error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
