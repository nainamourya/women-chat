// Pre-bundles ONLY the repository's own code (the Worker entry plus the
// Express server's routers and services it reuses), redirecting the three
// server modules that cannot run in a Worker. Every npm package is left as an
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

await build({
  entryPoints: [path.join(edgeDir, "src/index.ts")],
  outfile: path.join(edgeDir, "dist/worker.mjs"),
  bundle: true,
  format: "esm",
  target: "es2022",
  packages: "external",
  external: ["cloudflare:*", "node:*"],
  plugins: [redirectServerModules],
  logLevel: "warning",
});
