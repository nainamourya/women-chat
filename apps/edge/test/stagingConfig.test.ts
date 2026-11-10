import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Static guard for the staging environment in wrangler.jsonc: it must stay
// isolated from the production-named top-level config. The staging-only Hyperdrive
// id and R2 bucket may be committed in env.staging; connection strings and secrets
// must never be committed. Reads files only; nothing here talks to Cloudflare.
const edgeDir = path.resolve(import.meta.dirname, "..");
const raw = readFileSync(path.join(edgeDir, "wrangler.jsonc"), "utf8");

// JSONC -> JSON without a dependency: drop // and /* */ comments and trailing
// commas outside of strings.
function parseJsonc(text: string): any {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i];
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else out += c;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

const config = parseJsonc(raw);
const staging = config.env?.staging;
const production = config.env?.production;
const HEX32 = /^[0-9a-f]{32}$/;
const bindingNames = (c: any) => ({
  hyperdrive: (c.hyperdrive ?? []).map((b: any) => b.binding),
  r2: (c.r2_buckets ?? []).map((b: any) => b.binding),
  durable: (c.durable_objects?.bindings ?? []).map((b: any) => `${b.name}:${b.class_name}`),
});

describe("wrangler.jsonc staging environment", () => {
  it("exists, with its own Worker name (so its Durable Object namespaces are its own)", () => {
    expect(staging).toBeDefined();
    expect(staging.name).toBe("giigirl-edge-staging");
    expect(staging.name).not.toBe(config.name);
  });

  it("is workers.dev only: no routes, custom domains, zones or account ids anywhere in the file", () => {
    expect(staging.workers_dev).toBe(true);
    for (const key of ["route", "routes", "custom_domains", "zone_id", "zone_name", "account_id", "pattern"]) {
      expect(raw).not.toMatch(new RegExp(`"${key}"\\s*:`));
    }
  });

  it("declares the same bindings as the base config (nothing missing, nothing extra)", () => {
    const names = (c: any) => ({
      hyperdrive: (c.hyperdrive ?? []).map((b: any) => b.binding),
      r2: (c.r2_buckets ?? []).map((b: any) => b.binding),
      durable: (c.durable_objects?.bindings ?? []).map((b: any) => `${b.name}:${b.class_name}`),
    });
    expect(names(staging)).toEqual(names(config));
    expect(staging.migrations).toEqual(config.migrations);
    // Required bindings the Worker code reads.
    expect(names(staging).hyperdrive).toEqual(["HYPERDRIVE"]);
    expect(names(staging).r2).toEqual(["PRIVATE_BUCKET"]);
  });

  it("binds Durable Objects to its own script, never another Worker's", () => {
    for (const binding of [...config.durable_objects.bindings, ...staging.durable_objects.bindings]) {
      expect(binding.script_name).toBeUndefined();
    }
  });

  it("exports every Durable Object class (and migrates each one) from the Worker entry", () => {
    const entry = readFileSync(path.join(edgeDir, "src/index.ts"), "utf8");
    const migrated = staging.migrations.flatMap((m: any) => m.new_sqlite_classes ?? []);
    for (const binding of staging.durable_objects.bindings) {
      expect(entry).toMatch(new RegExp(`export \\{ ${binding.class_name} \\} from`));
      expect(migrated).toContain(binding.class_name);
    }
  });

  it("has its own Hyperdrive id and bucket, different from the base config's", () => {
    expect(staging.hyperdrive).toHaveLength(1);
    expect(staging.hyperdrive[0].id).toMatch(HEX32);
    expect(staging.hyperdrive[0].id).not.toBe(config.hyperdrive[0].id);
    expect(staging.r2_buckets).toHaveLength(1);
    expect(staging.r2_buckets[0].bucket_name).toBe("giigirl-private-staging");
    expect(staging.r2_buckets[0].bucket_name).not.toBe(config.r2_buckets[0].bucket_name);
  });

  it("embeds no secret, connection string, URL or real-looking id", () => {
    expect(config.vars).toBeUndefined();
    expect(staging.vars).toBeUndefined();
    expect(raw).not.toMatch(/postgres(ql)?:\/\//i);
    expect(raw).not.toMatch(/rediss?:\/\//i);
    expect(raw).not.toMatch(/https?:\/\//i);
    expect(raw).not.toMatch(/(secret|password|token|credential)"?\s*:/i);
    // The only 32-character ids in the file are the Hyperdrive ids (not secrets).
    const hexIds = (raw.match(/\b[0-9a-f]{32}\b/gi) ?? []).sort();
    expect(hexIds).toEqual([config.hyperdrive[0].id, staging.hyperdrive[0].id, production.hyperdrive[0].id].sort());
  });

  it("never shares a resource with production", () => {
    expect(staging.name).not.toBe(production.name);
    expect(staging.hyperdrive[0].id).not.toBe(production.hyperdrive[0].id);
    expect(staging.r2_buckets[0].bucket_name).not.toBe(production.r2_buckets[0].bucket_name);
  });

  it("checklist docs require --env staging, a staging-only database and a stable CORS origin", () => {
    const doc = readFileSync(path.join(edgeDir, "STAGING.md"), "utf8");
    for (const needle of ["--env staging", "UPLOAD_TOKEN_SECRET", "CORS_ORIGIN", "NEXT_PUBLIC_SOCKET_URL", "SERVER_URL", "/api/health/ready"]) {
      expect(doc).toContain(needle);
    }
  });
});

describe("wrangler.jsonc production environment", () => {
  it("exists, with its own Worker name, workers.dev only", () => {
    expect(production).toBeDefined();
    expect(production.name).toBe("giigirl-edge-production");
    expect(production.name).not.toBe(config.name);
    expect(production.workers_dev).toBe(true);
  });

  it("declares the same bindings and Durable Object migrations as the base config", () => {
    expect(bindingNames(production)).toEqual(bindingNames(config));
    expect(production.migrations).toEqual(config.migrations);
    for (const binding of production.durable_objects.bindings) expect(binding.script_name).toBeUndefined();
  });

  // A deploy without these two plain vars wipes them and the Worker fails closed
  // (503 on everything) — this happened once on 2026-11-10.
  it("has a deploy script that always sets NODE_ENV and the exact CORS origins", () => {
    const pkg = JSON.parse(readFileSync(path.join(edgeDir, "package.json"), "utf8"));
    const script: string = pkg.scripts["deploy:production"];
    expect(script).toContain("--env production");
    expect(script).toContain("--var NODE_ENV:production");
    expect(script).toContain('"CORS_ORIGIN:https://www.giigirl.com,https://women-chat.vercel.app"');
  });

  it("uses the production Hyperdrive config and the existing production bucket", () => {
    expect(production.hyperdrive).toHaveLength(1);
    expect(production.hyperdrive[0].id).toBe("4682ff8c403c46c087e4dbe86fbf3207");
    expect(production.hyperdrive[0].id).not.toBe(config.hyperdrive[0].id);
    expect(production.r2_buckets).toHaveLength(1);
    expect(production.r2_buckets[0].bucket_name).toBe("giigril-verification-videos");
    expect(production.vars).toBeUndefined();
  });
});
