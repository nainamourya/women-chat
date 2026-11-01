import type { Express } from "express";
import { z } from "zod";
import { requireInternalSecret } from "../../server/src/middleware/internalAuth";
import { emitToUser } from "./shims/socket";

// TEST BUILDS ONLY. scripts/build.mjs swaps this file for testHooksOff.ts
// unless EDGE_TEST_HOOKS=1, so none of this exists in a normal build (a test
// checks that). It lets the real-time tests trigger server-initiated pushes
// (the dm:message / notification:new path) that, in production, come from
// social routes that are not on the Worker yet.
const bodySchema = z.object({ userId: z.string().uuid(), event: z.string().min(1), payload: z.unknown() });

export function registerTestHooks(app: Express): void {
  app.post("/__test__/emit", requireInternalSecret, (req, res) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request." });
    emitToUser(parsed.data.userId, parsed.data.event, parsed.data.payload);
    res.status(200).json({ ok: true });
  });
}
