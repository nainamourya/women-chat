import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/**
 * Restricts an endpoint to server-to-server calls from the Next.js app
 * (which holds INTERNAL_API_SECRET server-side, never in the browser bundle).
 * This keeps auth endpoints from being called directly by arbitrary clients
 * once the Express server has its own public URL, without adding a full
 * service-auth system for MVP.
 */
export function requireInternalSecret(req: Request, res: Response, next: NextFunction) {
  const provided = req.header("x-internal-api-secret");
  if (!provided || provided !== env.INTERNAL_API_SECRET) {
    return res.status(401).json({ error: "Unauthorized." });
  }
  next();
}
