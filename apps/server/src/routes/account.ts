import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { Router } from "express";
import { z } from "zod";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";
import { checkLimitFailOpen, sendRateLimitedResponse } from "../redis/rateLimit.js";
import { leaveQueue } from "../redis/matchmakingQueue.js";
import { disconnectUser } from "../socket/index.js";
import { deleteAccount } from "../services/accountDeletion.service.js";
import { AuthError } from "../services/auth.service.js";

export const accountRouter = Router();

accountRouter.use(requireInternalSecret);

// Deleting an account is irreversible, so it needs more than a signed-in
// session: the member must type the confirmation word, and an account that
// has a password must also supply it (so a session left open on a shared or
// stolen device cannot erase an account). Accounts created through Google
// have no password; for those the typed confirmation is the check.
//
// `userId` is the Next.js server's own trusted session user id, never client
// input — same trust model as every other internal route.
export const DELETE_CONFIRMATION = "DELETE";

const deleteAccountSchema = z.object({
  userId: z.string().uuid(),
  confirmation: z.string().max(20),
  password: z.string().max(200).optional(),
});

// A wrong password counts against the same budget as a real deletion so the
// endpoint cannot be used to guess passwords.
const DELETE_ATTEMPT_LIMIT = 5;
const DELETE_ATTEMPT_WINDOW_SECONDS = 60 * 60;

accountRouter.delete("/", async (req, res) => {
  const parsed = deleteAccountSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  const { userId, confirmation, password } = parsed.data;

  const limit = await checkLimitFailOpen(`ratelimit:account-delete:${userId}`, DELETE_ATTEMPT_LIMIT, DELETE_ATTEMPT_WINDOW_SECONDS, "account:delete");
  if (!limit.allowed) return sendRateLimitedResponse(res, limit.retryAfterSeconds);

  if (confirmation !== DELETE_CONFIRMATION) {
    return res.status(400).json({ error: `Type ${DELETE_CONFIRMATION} to confirm.` });
  }

  try {
    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) return res.status(404).json({ error: "Account not found." });

    // Already deleted: succeed without re-checking anything (idempotent).
    if (user.accountStatus !== "deleted" && user.passwordHash) {
      if (!password) return res.status(400).json({ error: "Enter your password to confirm." });
      if (!(await bcrypt.compare(password, user.passwordHash))) {
        return res.status(403).json({ error: "That password isn't correct." });
      }
    }

    const result = await deleteAccount(userId);

    // Cut off everything live for this member. All best-effort: the database
    // change above is what matters, and every endpoint re-checks the account
    // status on its own.
    await leaveQueue(userId).catch(() => undefined);
    try {
      disconnectUser(userId);
    } catch {
      // no socket server in this process
    }

    res.status(200).json(result);
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("delete account error:", err instanceof Error ? err.message : "unknown error");
    res.status(500).json({ error: "Something went wrong." });
  }
});
