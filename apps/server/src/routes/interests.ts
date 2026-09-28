import { Router } from "express";
import { listInterests } from "../services/interests.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const interestsRouter = Router();

interestsRouter.use(requireInternalSecret);

// Fixed catalog, same list for every user — not user- or profile-specific.
interestsRouter.get("/", async (_req, res) => {
  try {
    const interests = await listInterests();
    res.status(200).json({ interests });
  } catch (err) {
    console.error("list interests error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
