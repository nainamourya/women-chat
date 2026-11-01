// Pre-bundles ONLY the repository's own code (the Worker entry plus the
// Express server's routers and services it reuses), redirecting the server
// modules that cannot run in a Worker. Every npm package is left as an
// external import, so wrangler's own bundler then resolves them (Express,
// postgres.js and friends need its Node-compat handling).
//
// apps/server is never modified: it is the reference implementation, and the
// redirects exist only inside this build.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const edgeDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverSrc = path.resolve(edgeDir, "../server/src") + path.sep;
const edgeSrc = path.join(edgeDir, "src") + path.sep;

const REPLACEMENTS = [
  { pattern: /[\\/]db[\\/]client\.js$/, to: path.join(edgeDir, "src/shims/dbClient.ts") },
  { pattern: /[\\/]config[\\/]env\.js$/, to: path.join(edgeDir, "src/shims/serverEnv.ts") },
  { pattern: /[\\/]socket[\\/]index\.js$/, to: path.join(edgeDir, "src/shims/socket.ts") },
];

const redirectServerModules = {
  name: "redirect-server-modules",
  setup(b) {
    b.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith(".")) return undefined;
      const importer = args.importer ? path.resolve(args.importer) : "";
      if (!importer.startsWith(serverSrc)) return undefined;
      const resolved = path.resolve(path.dirname(importer), args.path);
      const hit = REPLACEMENTS.find((r) => r.pattern.test(resolved));
      return hit ? { path: hit.to } : undefined;
    });
  },
};

// Test-only routes exist only when EDGE_TEST_HOOKS=1 (see src/testHooks.ts).
const withTestHooks = process.env.EDGE_TEST_HOOKS === "1";
const selectTestHooks = {
  name: "select-test-hooks",
  setup(b) {
    b.onResolve({ filter: /^\.\/testHooks$/ }, (args) => {
      if (!path.resolve(args.importer).startsWith(edgeSrc)) return undefined;
      return { path: path.join(edgeDir, withTestHooks ? "src/testHooks.ts" : "src/testHooksOff.ts") };
    });
  },
};

await build({
  entryPoints: [path.join(edgeDir, "src/index.ts")],
  outfile: process.env.EDGE_BUILD_OUT ?? path.join(edgeDir, "dist/worker.mjs"),
  bundle: true,
  format: "esm",
  target: "es2022",
  packages: "external",
  external: ["cloudflare:*", "node:*"],
  plugins: [redirectServerModules, selectTestHooks],
  logLevel: "warning",
});
