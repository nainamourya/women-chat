import { Router } from "express";
import { z } from "zod";
import {
  AuthError,
  confirmAge18,
  findOrCreateGoogleUser,
  registerUser,
  verifyCredentials,
} from "../services/auth.service.js";
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

const oauthGoogleSchema = z.object({
  email: z.string().email(),
  googleId: z.string().min(1),
  displayName: z.string().min(1).max(50),
});

// Called only by the Next.js server (never the browser) from the NextAuth
// Google signIn callback, after Google itself has verified the account.
authRouter.post("/oauth/google", async (req, res) => {
  const parsed = oauthGoogleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.flatten().fieldErrors });
  }

  try {
    const user = await findOrCreateGoogleUser(parsed.data);
    res.status(200).json({ user });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("oauth google error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const confirmAgeSchema = z.object({
  userId: z.string().uuid(),
});

authRouter.post("/confirm-age", async (req, res) => {
  const parsed = confirmAgeSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  try {
    const user = await confirmAge18(parsed.data.userId);
    res.status(200).json({ user });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("confirm-age error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
