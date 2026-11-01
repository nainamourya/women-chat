import { getRequestContext, hubFor } from "../realtime/env";

// Build-time replacement for apps/server/src/socket/index.ts (see
// scripts/build.mjs), for the server code that is reused unchanged: the
// notification service's emitToUser and the admin/report flows' disconnectUser.
// The Express server reached for a module-level Socket.IO instance; the Worker
// reaches the target user's UserHub Durable Object instead.

/** `io.to("user:<id>").emit(event, payload)` — best-effort, like the Express original. */
export function emitToUser(userId: string, event: string, payload: unknown): void {
  const { env, ctx } = getRequestContext();
  ctx.waitUntil(
    hubFor(env, userId)
      .emit(event, payload)
      .catch(() => console.error("Failed to push a real-time event (best effort).")),
  );
}

/**
 * `io.in("user:<id>").disconnectSockets(true)` — drops every live connection of a
 * user who was just banned, suspended or deleted. Reconnecting is already refused
 * for such accounts (socket authentication and the ticket route both check
 * eligibility), so this only has to end what is open right now. The client sees
 * an ordinary disconnect, as before.
 */
export function disconnectUser(userId: string): void {
  const { env, ctx } = getRequestContext();
  ctx.waitUntil(
    hubFor(env, userId)
      .disconnectAll()
      .catch(() => console.error("Failed to disconnect a user's live connections.")),
  );
}
