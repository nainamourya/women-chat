import { Router } from "express";
import { z } from "zod";
import { AuthError, assertAdmin } from "../services/auth.service.js";
import {
  createReport,
  getReportById,
  getReportEvidencePath,
  listReports,
  updateReportDecision,
} from "../services/reports.service.js";
import { readEvidence } from "../services/evidenceStorage.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const reportsRouter = Router();

// Express payload limit must cover a base64-encoded 5MB image (~6.7MB) plus
// JSON overhead — see evidenceStorage.ts for the real byte-size validation.
reportsRouter.use(requireInternalSecret);

const reasonEnum = z.enum([
  "harassment",
  "sexual_inappropriate",
  "not_eligible",
  "fake_profile",
  "spam_scam",
  "threatening_unsafe",
  "other",
]);

const createReportSchema = z.object({
  reporterUserId: z.string().uuid(),
  reportedUserId: z.string().uuid(),
  reason: reasonEnum,
  description: z.string().max(1000).nullable().optional(),
  matchId: z.string().uuid().nullable().optional(),
  evidenceBase64: z.string().nullable().optional(),
  evidenceMimeType: z.string().nullable().optional(),
});

reportsRouter.post("/", async (req, res) => {
  const parsed = createReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    const report = await createReport(parsed.data);
    res.status(201).json({ report });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("create report error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const adminQuerySchema = z.object({
  adminUserId: z.string().uuid(),
  status: z.enum(["pending", "under_review", "resolved", "dismissed"]).optional(),
});

reportsRouter.get("/", async (req, res) => {
  const parsed = adminQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await assertAdmin(parsed.data.adminUserId);
    const list = await listReports(parsed.data.status ? { status: parsed.data.status } : undefined);
    res.status(200).json({ reports: list });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("list reports error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const adminParamsWithIdSchema = z.object({ id: z.string().uuid() });

reportsRouter.get("/:id", async (req, res) => {
  const parsedParams = adminParamsWithIdSchema.safeParse(req.params);
  const parsedQuery = z.object({ adminUserId: z.string().uuid() }).safeParse(req.query);
  if (!parsedParams.success || !parsedQuery.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await assertAdmin(parsedQuery.data.adminUserId);
    const report = await getReportById(parsedParams.data.id);
    res.status(200).json({ report });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("get report error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

reportsRouter.get("/:id/evidence", async (req, res) => {
  const parsedParams = adminParamsWithIdSchema.safeParse(req.params);
  const parsedQuery = z.object({ adminUserId: z.string().uuid() }).safeParse(req.query);
  if (!parsedParams.success || !parsedQuery.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await assertAdmin(parsedQuery.data.adminUserId);
    const report = await getReportById(parsedParams.data.id);
    const filename = await getReportEvidencePath(parsedParams.data.id);
    const buffer = await readEvidence(filename);
    res.setHeader("Content-Type", report.evidenceMimeType ?? "application/octet-stream");
    // Never publicly cacheable — this is sensitive user-submitted evidence.
    res.setHeader("Cache-Control", "private, no-store");
    res.status(200).send(buffer);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return res.status(404).json({ error: "Evidence file not found." });
    }
    console.error("get report evidence error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const updateReportSchema = z.object({
  adminUserId: z.string().uuid(),
  status: z.enum(["under_review", "resolved", "dismissed"]),
  adminAction: z.enum(["none", "warn", "suspend", "ban"]).default("none"),
  adminNote: z.string().max(1000).nullable().optional(),
  suspendUntil: z.string().datetime().nullable().optional(),
});

reportsRouter.patch("/:id", async (req, res) => {
  const parsedParams = adminParamsWithIdSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  const parsedBody = updateReportSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten().fieldErrors });
  }

  try {
    const admin = await assertAdmin(parsedBody.data.adminUserId);
    const report = await updateReportDecision(parsedParams.data.id, {
      status: parsedBody.data.status,
      adminAction: parsedBody.data.adminAction,
      adminNote: parsedBody.data.adminNote,
      suspendUntil: parsedBody.data.suspendUntil ? new Date(parsedBody.data.suspendUntil) : null,
      reviewedBy: admin.id,
    });
    res.status(200).json({ report });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("update report error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
