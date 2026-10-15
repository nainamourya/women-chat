import { Router } from "express";
import { z } from "zod";
import { AuthError } from "../services/auth.service.js";
import { deleteAccount } from "../services/accountDeletion.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const accountRouter = Router();

accountRouter.use(requireInternalSecret);

// `userId` is always the Next.js server's own trusted session user id,
// never client input — same trust model as every other internal route.
const deleteAccountSchema = z.object({ userId: z.string().uuid() });

accountRouter.delete("/", async (req, res) => {
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid user id." });
  }

  try {
    const result = await deleteAccount(parsed.data.userId);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("delete account error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
