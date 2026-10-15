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
import { checkLimitFailOpen, sendRateLimitedResponse } from "../redis/rateLimit.js";

export const authRouter = Router();

authRouter.use(requireInternalSecret);

// Keyed by whatever the request supplies (IP always; email only if present
// in the body) *before* full schema validation, so a malformed or garbage
// request still counts against the limiter rather than slipping through
// for free — see the rate-limiting audit this is based on.
const LOGIN_EMAIL_LIMIT = 5;
const LOGIN_EMAIL_WINDOW_SECONDS = 15 * 60;
const LOGIN_IP_LIMIT = 20;
const LOGIN_IP_WINDOW_SECONDS = 15 * 60;
const REGISTER_IP_LIMIT = 5;
const REGISTER_IP_WINDOW_SECONDS = 60 * 60;

function normalizeEmail(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim().toLowerCase() : null;
}


const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, "Password must be at least 8 characters."),
  displayName: z.string().min(2).max(50),
  ageConfirmed18: z.boolean(),
});

authRouter.post("/register", async (req, res) => {
  if (req.ip) {
    const check = await checkLimitFailOpen(
      `ratelimit:register:ip:${req.ip}`,
      REGISTER_IP_LIMIT,
      REGISTER_IP_WINDOW_SECONDS,
      "register:ip",
    );
    if (!check.allowed) return sendRateLimitedResponse(res, check.retryAfterSeconds);
  }

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
  // Checked before schema validation, keyed by whatever can be derived from
  // the raw body/request, so a malformed request still counts against the
  // limiter rather than bypassing it for free.
  const email = normalizeEmail((req.body as Record<string, unknown> | undefined)?.email);
  if (email) {
    const check = await checkLimitFailOpen(
      `ratelimit:login:email:${email}`,
      LOGIN_EMAIL_LIMIT,
      LOGIN_EMAIL_WINDOW_SECONDS,
      "login:email",
    );
    if (!check.allowed) return sendRateLimitedResponse(res, check.retryAfterSeconds);
  }
  if (req.ip) {
    const check = await checkLimitFailOpen(`ratelimit:login:ip:${req.ip}`, LOGIN_IP_LIMIT, LOGIN_IP_WINDOW_SECONDS, "login:ip");
    if (!check.allowed) return sendRateLimitedResponse(res, check.retryAfterSeconds);
  }

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
