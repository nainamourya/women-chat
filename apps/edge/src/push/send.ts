import { and, eq, inArray } from "drizzle-orm";
import { pushSubscriptions, users } from "../../../server/src/db/schema";
import { db, withDb } from "../db";
import { limiterFor, type RealtimeEnv } from "../realtime/env";
import { sendWebPush, vapidKeysLookValid, type VapidKeys } from "./webPush";

export type PushEnv = RealtimeEnv & {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
};

export type PushKind = "follow" | "like" | "comment" | "message";

/** Null when push is not configured (or misconfigured): everything else keeps working. */
export function vapidKeys(env: PushEnv): VapidKeys | null {
  const keys = {
    publicKey: env.VAPID_PUBLIC_KEY?.trim(),
    privateKey: env.VAPID_PRIVATE_KEY?.trim(),
    subject: env.VAPID_SUBJECT?.trim() || "mailto:support@giigirl.com",
  };
  return vapidKeysLookValid(keys) ? keys : null;
}

// What shows on the lock screen. Deliberately no names, usernames or message
// text: a phone's lock screen can be seen by anyone nearby, and for some
// members that would not be safe. The app shows the details once opened.
const CONTENT: Record<PushKind, { title: string; body: string; url: string }> = {
  message: { title: "GiiGirl", body: "You have a new message", url: "/messages" },
  comment: { title: "GiiGirl", body: "Someone commented on your post", url: "/notifications" },
  like: { title: "GiiGirl", body: "Someone liked your post", url: "/notifications" },
  follow: { title: "GiiGirl", body: "You have a new follower", url: "/notifications" },
};

// At most one push per kind per member in this window; the in-app badge still
// counts everything. Stops a burst of messages buzzing a phone 20 times.
const PUSH_WINDOW_SECONDS = 60;

export function isPushKind(value: unknown): value is PushKind {
  return value === "follow" || value === "like" || value === "comment" || value === "message";
}

/**
 * Best-effort push to every device of one member. Runs after the response
 * (inside ctx.waitUntil), with its own database client because the request's
 * client is already closed by then. Never throws.
 */
export async function sendPushToUser(env: PushEnv, userId: string, kind: PushKind): Promise<void> {
  const keys = vapidKeys(env);
  if (!keys) return;

  try {
    const allowed = await limiterFor(env, `push:${kind}:${userId}`).hit(1, PUSH_WINDOW_SECONDS);
    if (!allowed.allowed) return;

    await withDb(env, async () => {
      // Only active accounts get pushes (not suspended, banned or deleted).
      const targets = await db
        .select({ id: pushSubscriptions.id, endpoint: pushSubscriptions.endpoint, p256dh: pushSubscriptions.p256dh, auth: pushSubscriptions.auth })
        .from(pushSubscriptions)
        .innerJoin(users, eq(users.id, pushSubscriptions.userId))
        .where(and(eq(pushSubscriptions.userId, userId), eq(users.accountStatus, "active")))
        .limit(10);
      if (targets.length === 0) return;

      const content = CONTENT[kind];
      const payload = { ...content, kind, tag: `giigirl-${kind}` };
      const results = await Promise.all(
        targets.map((t) => sendWebPush(t, payload, keys, { topic: kind, urgency: kind === "message" ? "high" : "normal" })),
      );

      const gone = targets.filter((_, i) => results[i] === "gone").map((t) => t.id);
      if (gone.length > 0) await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
    });
  } catch (err) {
    // Error type only: messages could contain an endpoint.
    console.error("Push notification failed (best effort):", err instanceof Error ? err.name : "unknown");
  }
}
