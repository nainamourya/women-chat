import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // Only the web-proxy rehearsal test (test/webProxy.test.ts) imports web code.
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "../web/src") } },
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/globalSetup.ts"],
    // The Worker harness boots `wrangler dev` (workerd), which runs
    // scripts/build.mjs and writes dist/worker.mjs. Test files must not run
    // in parallel or their builds would write the same file at once.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
