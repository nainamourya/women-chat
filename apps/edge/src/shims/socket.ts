// Build-time replacement for apps/server/src/socket/index.ts (see
// scripts/build.mjs). Real-time delivery moves to Durable Objects in Stage C.
//
// This is deliberately NOT a silent no-op. A ban, suspension or deletion that
// quietly skipped disconnecting the user's live sockets would be a security
// regression, so any call fails loudly. The routes that call it (PATCH and
// DELETE on /api/admin/users/:id) are not served by the edge Worker in Stage B
// — they answer 501 before reaching this module — so this must never run.
export function disconnectUser(_userId: string): never {
  throw new Error("disconnectUser is not available in the edge Worker until the real-time stage");
}
