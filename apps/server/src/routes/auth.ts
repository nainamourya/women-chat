import { Router } from "express";
import { z } from "zod";
import { AuthError, registerUser, verifyCredentials } from "../services/auth.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const authRouter = Router();

authRouter.use(requireInternalSecret);

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  displayName: z.string().min(2).max(50),
  ageConfirmed18: z.boolean(),
});

authRouter.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    const user = await registerUser(parsed.data);
    res.status(201).json({ user });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("register error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

authRouter.post("/login", async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    const user = await verifyCredentials(parsed.data.email, parsed.data.password);
    res.status(200).json({ user });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("login error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
