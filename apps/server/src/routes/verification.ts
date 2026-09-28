import { Router } from "express";
import { z } from "zod";
import { AuthError } from "../services/auth.service.js";
import { simulatePrototypeVerification } from "../services/verification.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const verificationRouter = Router();

verificationRouter.use(requireInternalSecret);

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
