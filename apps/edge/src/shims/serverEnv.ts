import type { Env } from "../../../server/src/config/envSchema";
import { getConfig } from "../config";

// Build-time replacement for apps/server/src/config/env.ts (see
// scripts/build.mjs). The server's own module reads dotenv, calls
// process.exit and builds a database URL guard — none of which belongs in a
// Worker. Server code that does `import { env } from "../config/env.js"`
// (internal-secret middleware, ICE servers) gets this instead.
export const env: Env = new Proxy({} as Env, {
  get(_target, key) {
    const config = getConfig();
    if (!config.ok) {
      // Unreachable in practice (app.ts answers 503 before any route runs),
      // but never hand back a partial value if it were reached.
      throw new Error("Edge configuration is invalid");
    }
    return config.env[key as keyof Env];
  },
});

export const CORS_ORIGINS: string[] = [];
