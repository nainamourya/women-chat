import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // The Worker harness boots `wrangler dev` (workerd) once per run.
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
