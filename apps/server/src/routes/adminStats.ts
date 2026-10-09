import { Router } from "express";
import { z } from "zod";
import { AuthError, assertAdmin } from "../services/auth.service.js";
import { getAdminOverviewStats } from "../services/adminStats.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const adminStatsRouter = Router();

adminStatsRouter.use(requireInternalSecret);

const queryParamsSchema = z.object({ adminUserId: z.string().uuid() });

adminStatsRouter.get("/overview", async (req, res) => {
  const parsed = queryParamsSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await assertAdmin(parsed.data.adminUserId);
    const stats = await getAdminOverviewStats();
    res.status(200).json({ stats });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("admin overview stats error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
