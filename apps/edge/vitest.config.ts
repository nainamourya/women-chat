import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The Worker harness boots `wrangler dev` (workerd), which runs
    // scripts/build.mjs and writes dist/worker.mjs. Test files must not run
    // in parallel or their builds would write the same file at once.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
