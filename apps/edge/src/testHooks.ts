import type { Express } from "express";
import { z } from "zod";
import { requireInternalSecret } from "../../server/src/middleware/internalAuth";
import { getRequestContext } from "./realtime/env";
import { emitToUser } from "./shims/socket";

// TEST BUILDS ONLY. scripts/build.mjs swaps this file for testHooksOff.ts
// unless EDGE_TEST_HOOKS=1, so none of this exists in a normal build (a test
// checks that). It lets tests trigger a server-initiated push and look inside
// the (simulated, local) R2 bucket, neither of which the public API exposes.
const emitSchema = z.object({ userId: z.string().uuid(), event: z.string().min(1), payload: z.unknown() });

export function registerTestHooks(app: Express): void {
  app.post("/__test__/emit", requireInternalSecret, (req, res) => {
    const parsed = emitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid request." });
    emitToUser(parsed.data.userId, parsed.data.event, parsed.data.payload);
    res.status(200).json({ ok: true });
  });

  // Lists object keys (and sizes) under a prefix of the simulated bucket.
  app.get("/__test__/r2/list", requireInternalSecret, async (req, res) => {
    const prefix = typeof req.query.prefix === "string" ? req.query.prefix : "";
    const listed = await getRequestContext().env.PRIVATE_BUCKET.list({ prefix, limit: 1000 });
    res.status(200).json({ objects: listed.objects.map((o) => ({ key: o.key, size: o.size })) });
  });

  // Reads one object's raw bytes (base64) and content type.
  app.get("/__test__/r2/get", requireInternalSecret, async (req, res) => {
    const key = typeof req.query.key === "string" ? req.query.key : "";
    const object = await getRequestContext().env.PRIVATE_BUCKET.get(key);
    if (!object) return res.status(404).json({ error: "missing" });
    res.status(200).json({
      contentType: object.httpMetadata?.contentType ?? null,
      base64: Buffer.from(await object.arrayBuffer()).toString("base64"),
    });
  });
}
