import type { Express } from "express";

// The normal build's stand-in for testHooks.ts: registers nothing.
export function registerTestHooks(_app: Express): void {}
