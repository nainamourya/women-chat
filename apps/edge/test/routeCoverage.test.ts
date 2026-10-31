import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ROUTE_COVERAGE, findCoverage } from "../src/routeCoverage";

// Reads the Express server's source (the reference implementation) and checks
// that every route it defines has an explicit entry in the edge coverage table.
// A route can therefore never be silently left out of the migration.
const serverSrc = path.resolve(import.meta.dirname, "../../server/src");

function discoverRoutes(): Array<{ method: string; path: string; where: string }> {
  const index = readFileSync(path.join(serverSrc, "index.ts"), "utf8");
  const mounts = new Map<string, string>(); // routerVariable -> mount path
  for (const m of index.matchAll(/app\.use\(\s*"([^"]+)"\s*,\s*(\w+Router)\s*\)/g)) mounts.set(m[2], m[1]);

  const routes: Array<{ method: string; path: string; where: string }> = [];
  const routesDir = path.join(serverSrc, "routes");
  for (const file of readdirSync(routesDir)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
    const source = readFileSync(path.join(routesDir, file), "utf8");
    for (const m of source.matchAll(/(\w+Router)\.(get|post|put|patch|delete)\(\s*(["'`])([^"'`]*)\3/g)) {
      const mount = mounts.get(m[1]);
      if (mount === undefined) continue;
      routes.push({ method: m[2].toUpperCase(), path: (mount + (m[4] === "/" ? "" : m[4])) || "/", where: `${file} (${m[1]})` });
    }
  }
  return routes;
}

describe("route coverage table", () => {
  const routes = discoverRoutes();

  it("discovers the server's routes (guards the discovery itself)", () => {
    expect(routes.length).toBeGreaterThan(50);
    expect(routes.some((r) => r.method === "GET" && r.path === "/api/interests")).toBe(true);
    expect(routes.some((r) => r.path.startsWith("/api/social/"))).toBe(true);
  });

  it("every Express route is classified (ported, partial or blocked)", () => {
    const missing = routes.filter((r) => !findCoverage(r.method, r.path)).map((r) => `${r.method} ${r.path}  [${r.where}]`);
    expect(missing).toEqual([]);
  });

  it("every ported route in the table exists on the Express server", () => {
    const exact = ROUTE_COVERAGE.filter((e) => !e.prefix && e.status !== "blocked");
    const unknown = exact.filter((e) => !routes.some((r) => r.method === e.method && r.path === e.path) && !e.path.startsWith("/api/health"));
    expect(unknown.map((e) => `${e.method} ${e.path}`)).toEqual([]);
  });

  it("ROUTE_COVERAGE.md lists every table entry (the report cannot drift)", () => {
    const doc = readFileSync(path.resolve(import.meta.dirname, "../ROUTE_COVERAGE.md"), "utf8");
    const missing = ROUTE_COVERAGE.filter((e) => !doc.includes(e.prefix ? `${e.path}/*` : e.path)).map((e) => `${e.method} ${e.path}`);
    expect(missing).toEqual([]);
  });

  it("every blocked entry states an exact blocker and the stage that unblocks it", () => {
    for (const entry of ROUTE_COVERAGE.filter((e) => e.status !== "ported")) {
      expect(entry.blocker, `${entry.method} ${entry.path}`).toBeTruthy();
      expect(entry.unblockedBy, `${entry.method} ${entry.path}`).toBeTruthy();
    }
  });
});
