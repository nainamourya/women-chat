import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env.js";

/**
 * Hides an endpoint everywhere except local development. Allow-list, not
 * deny-list: "production", "test", or any value we haven't thought of (a
 * staging deploy that forgot to set NODE_ENV falls back to "development" in
 * env.ts, so deployments must set it explicitly) all get a plain 404, as if
 * the route did not exist.
 *
 * Used for the prototype verification stub, which marks a user verified
 * without any human review — it must never be reachable on a real deploy.
 */
export function developmentOnly(req: Request, res: Response, next: NextFunction) {
  if (env.NODE_ENV !== "development") {
    return res.status(404).json({ error: "Not found." });
  }
  next();
}
