import { Router } from "express";
import { z } from "zod";
import { AuthError, assertAdmin } from "../services/auth.service.js";
import {
  adminBanUser,
  adminDeleteUser,
  adminSuspendUser,
  adminUnbanUser,
  adminUnsuspendUser,
  listUsersForAdmin,
} from "../services/adminUsers.service.js";
import { requireInternalSecret } from "../middleware/internalAuth.js";

export const adminUsersRouter = Router();

adminUsersRouter.use(requireInternalSecret);

const listQuerySchema = z.object({
  adminUserId: z.string().uuid(),
  search: z.string().max(200).optional(),
});

adminUsersRouter.get("/", async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    await assertAdmin(parsed.data.adminUserId);
    const list = await listUsersForAdmin({ search: parsed.data.search });
    res.status(200).json({ users: list });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("list admin users error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const paramsWithIdSchema = z.object({ id: z.string().uuid() });

const actionBodySchema = z.object({
  adminUserId: z.string().uuid(),
  action: z.enum(["suspend", "unsuspend", "ban", "unban"]),
  suspendUntil: z.string().datetime().nullable().optional(),
});

adminUsersRouter.patch("/:id", async (req, res) => {
  const parsedParams = paramsWithIdSchema.safeParse(req.params);
  if (!parsedParams.success) {
    return res.status(400).json({ error: "Invalid request." });
  }
  const parsedBody = actionBodySchema.safeParse(req.body);
  if (!parsedBody.success) {
    return res.status(400).json({ error: parsedBody.error.flatten().fieldErrors });
  }

  try {
    const admin = await assertAdmin(parsedBody.data.adminUserId);
    const targetId = parsedParams.data.id;

    let user;
    switch (parsedBody.data.action) {
      case "suspend":
        user = await adminSuspendUser(
          admin.id,
          targetId,
          parsedBody.data.suspendUntil ? new Date(parsedBody.data.suspendUntil) : null,
        );
        break;
      case "unsuspend":
        user = await adminUnsuspendUser(admin.id, targetId);
        break;
      case "ban":
        user = await adminBanUser(admin.id, targetId);
        break;
      case "unban":
        user = await adminUnbanUser(admin.id, targetId);
        break;
    }

    res.status(200).json({ user });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("admin user action error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});

const deleteQuerySchema = z.object({ adminUserId: z.string().uuid() });

adminUsersRouter.delete("/:id", async (req, res) => {
  const parsedParams = paramsWithIdSchema.safeParse(req.params);
  const parsedQuery = deleteQuerySchema.safeParse(req.query);
  if (!parsedParams.success || !parsedQuery.success) {
    return res.status(400).json({ error: "Invalid request." });
  }

  try {
    const admin = await assertAdmin(parsedQuery.data.adminUserId);
    await adminDeleteUser(admin.id, parsedParams.data.id);
    res.status(200).json({ ok: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return res.status(err.status).json({ error: err.message });
    }
    console.error("admin delete user error:", err);
    res.status(500).json({ error: "Something went wrong." });
  }
});
