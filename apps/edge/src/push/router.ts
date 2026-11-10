import { Router } from "express";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { z } from "zod";
import { pushSubscriptions } from "../../../server/src/db/schema";
import { requireInternalSecret } from "../../../server/src/middleware/internalAuth";
import { db } from "../db";
import { getRequestContext } from "../realtime/env";
import { vapidKeys, type PushEnv } from "./send";
import { b64urlDecode, isAllowedPushEndpoint } from "./webPush";

// Worker-only endpoints for Web Push, called by the Next.js app (internal
// secret + `x-viewer-id` from the signed-in session, exactly like the social
// API). The browser never talks to these directly.
export const pushRouter = Router();
pushRouter.use(requireInternalSecret);

const MAX_DEVICES_PER_MEMBER = 10;

const b64url = (bytes: number, exact: boolean) =>
  z
    .string()
    .max(200)
    .regex(/^[A-Za-z0-9_-]+=*$/)
    .refine((v) => {
      try {
        const n = b64urlDecode(v.replace(/=+$/, "")).length;
        return exact ? n === bytes : n >= bytes;
      } catch {
        return false;
      }
    });

const subscribeSchema = z.object({
  endpoint: z.string().max(1000).refine(isAllowedPushEndpoint),
  keys: z.object({ p256dh: b64url(65, true), auth: b64url(16, false) }),
});
const unsubscribeSchema = z.object({ endpoint: z.string().max(1000) });
const viewerSchema = z.string().uuid();

// Public key the browser needs for PushManager.subscribe(). 404 when push is
// not configured, so the app simply hides the option.
pushRouter.get("/public-key", (_req, res) => {
  const keys = vapidKeys(getRequestContext().env as PushEnv);
  if (!keys) return res.status(404).json({ error: "Push notifications are not available." });
  res.set("Cache-Control", "no-store").json({ publicKey: keys.publicKey });
});

pushRouter.post("/subscribe", async (req, res, next) => {
  try {
    const viewer = viewerSchema.safeParse(req.header("x-viewer-id"));
    if (!viewer.success) return res.status(401).json({ error: "Unauthorized." });
    const parsed = subscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid push subscription." });
    const { endpoint, keys } = parsed.data;

    // One row per device. If the same device was subscribed by another account
    // (shared phone, switched login), it now belongs to whoever is signed in.
    await db
      .insert(pushSubscriptions)
      .values({ userId: viewer.data, endpoint, p256dh: keys.p256dh, auth: keys.auth })
      .onConflictDoUpdate({
        target: pushSubscriptions.endpoint,
        set: { userId: viewer.data, p256dh: keys.p256dh, auth: keys.auth, createdAt: new Date() },
      });

    // Keep only the newest devices per member.
    const keep = await db
      .select({ id: pushSubscriptions.id })
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, viewer.data))
      .orderBy(asc(pushSubscriptions.createdAt))
      .then((rows) => rows.slice(-MAX_DEVICES_PER_MEMBER).map((r) => r.id));
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, viewer.data), notInArray(pushSubscriptions.id, keep)));

    res.status(201).json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// Turning notifications off, or logging out, on one device. Only ever removes
// the caller's own subscription.
pushRouter.post("/unsubscribe", async (req, res, next) => {
  try {
    const viewer = viewerSchema.safeParse(req.header("x-viewer-id"));
    if (!viewer.success) return res.status(401).json({ error: "Unauthorized." });
    const parsed = unsubscribeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request." });
    await db
      .delete(pushSubscriptions)
      .where(and(eq(pushSubscriptions.userId, viewer.data), eq(pushSubscriptions.endpoint, parsed.data.endpoint)));
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
