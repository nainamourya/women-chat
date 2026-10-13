import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without this, vitest's default glob also picks up compiled test files
    // under dist/ (a local, gitignored `npm run build` artifact) alongside
    // the real src/ tests — running both against the same database and
    // causing spurious unique-constraint collisions in the integration test.
    exclude: ["dist/**", "node_modules/**"],
  },
});
