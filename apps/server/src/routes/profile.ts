import { Router } from "express";
import { z } from "zod";
import { AuthError } from "../services/auth.service.js";
import { getProfile, upsertProfile } from "../services/profile.service.js";
import { setUserInterests } from "../services/interests.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const profileRouter = Router();

profileRouter.use(requireInternalSecret);

// `userId` is always trusted from the URL because only the Next.js server
// (holder of INTERNAL_API_SECRET) can call this router, and it only ever
// forwards the id of the currently signed-in session — never client input.
// There is intentionally no route to fetch another user's profile.
const userIdParamSchema = z.object({ userId: z.string().uuid() });

profileRouter.get("/:userId", async (req, res) => {
  const parsedParams = userIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  try {
    const profile = await getProfile(parsedParams.data.userId);
    res.status(200).json({ profile });
  } catch (err) {
    console.error("get profile error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const upsertProfileSchema = z.object({
  bio: z.string().max(500, "Bio must be 500 characters or fewer.").nullable().optional(),
  displayName: z.string().min(2).max(50).optional(),
});

profileRouter.put("/:userId", async (req, res) => {
  const parsedParams = userIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const parsedBody = upsertProfileSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten().fieldErrors });
  }

  try {
    const profile = await upsertProfile(parsedParams.data.userId, parsedBody.data);
    res.status(200).json({ profile });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("update profile error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const interestIdsSchema = z.object({
  interestIds: z.array(z.string().uuid()).max(15, "Choose up to 15 interests."),
});

profileRouter.put("/:userId/interests", async (req, res) => {
  const parsedParams = userIdParamSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  const parsedBody = interestIdsSchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten().fieldErrors });
  }

  try {
    const interests = await setUserInterests(parsedParams.data.userId, parsedBody.data.interestIds);
    res.status(200).json({ interests });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("update user interests error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
