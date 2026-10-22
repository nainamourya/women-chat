import { z } from "zod";

// Pure schema + parser for the server's environment — no side effects (no
// dotenv, no process.exit, no process.env access), so it can be unit-tested
// with arbitrary inputs. config/env.ts is the thin, side-effecting wrapper
// that feeds it process.env at startup.

export const NODE_ENV_VALUES = ["development", "test", "production"] as const;

// The shared secret between the Next.js server and this API. Short secrets
// are tolerated outside production so local fixtures stay simple; a real
// deployment must use a long random value (see .env.example for a generator).
const DEFAULT_INTERNAL_SECRET_MIN_LENGTH = 16;
export const PRODUCTION_INTERNAL_SECRET_MIN_LENGTH = 32;
const PRODUCTION_INTERNAL_SECRET_MIN_DISTINCT_CHARS = 10;
// Obvious template/placeholder values copied from docs or examples.
const PLACEHOLDER_SECRET_PATTERN =
  /replace|change[-_]?me|your[-_]|example|placeholder|dummy|password|secret[-_]here|test[-_]?secret/i;

// Variables a hosting platform sets on every service it runs. If one of these
// is present the process is deployed, so anything other than an explicit
// NODE_ENV=production is a misconfiguration and must not start.
// Render documents RENDER=true as always present on its services.
const DEPLOYED_PLATFORM_MARKERS = ["RENDER"] as const;

export const envSchema = z
  .object({
    // Deliberately no default: a deployment that forgot to set it must fail to
    // start rather than silently run with development behaviour (e.g. the
    // verification-simulation route — see middleware/developmentOnly.ts).
    NODE_ENV: z.enum(NODE_ENV_VALUES, {
      error: "NODE_ENV must be set explicitly to one of: development, test, production",
    }),
    PORT: z.coerce.number().default(4000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    REDIS_URL: z.string().min(1, "REDIS_URL is required"),
    // Comma-separated if the app is served from more than one domain (e.g. a
    // Vercel-assigned domain plus a custom domain) — see CORS_ORIGINS in
    // env.ts, which both Express's cors() and the Socket.IO server read
    // instead of this raw string, since both accept an array of origins.
    CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),
    // Shared secret so the Next.js server (not the browser) can call trusted
    // internal endpoints. Rotate independently of NEXTAUTH_SECRET. Stricter
    // rules apply in production — see the refinement below.
    INTERNAL_API_SECRET: z
      .string()
      .min(DEFAULT_INTERNAL_SECRET_MIN_LENGTH, `INTERNAL_API_SECRET must be at least ${DEFAULT_INTERNAL_SECRET_MIN_LENGTH} chars`),
    // Local disk directory for report evidence uploads (prototype only — see
    // evidenceStorage.ts for what production storage would need instead).
    REPORT_EVIDENCE_DIR: z.string().default("./uploads/reports"),

    // --- WebRTC TURN relay (all optional — calls fall back to STUN-only, with
    // a startup warning, if none of these are set). See iceServers.service.ts.
    // Comma-separated turn:/turns: URIs from your TURN provider, e.g.
    // "turn:relay.example.com:80,turns:relay.example.com:443".
    TURN_URLS: z.string().optional(),
    // Preferred: a shared secret for minting short-lived, per-call TURN
    // credentials (the "coturn REST API" convention — most managed TURN
    // providers, and self-hosted coturn, support this).
    TURN_STATIC_AUTH_SECRET: z.string().optional(),
    // Fallback only, for providers that don't support the shared-secret scheme
    // above: a single long-lived credential pair. Less secure (never expires
    // on its own) — rotate it periodically in the provider's dashboard.
    TURN_STATIC_USERNAME: z.string().optional(),
    TURN_STATIC_CREDENTIAL: z.string().optional(),
    // How long a minted short-lived TURN credential stays valid for.
    TURN_CREDENTIAL_TTL_SECONDS: z.coerce.number().default(3600),

    // Alternative to TURN_URLS/TURN_STATIC_*: a managed provider (metered.ca)
    // that mints short-lived credentials via its own REST API rather than a
    // static shared secret. Checked first in iceServers.service.ts; falls
    // back to TURN_URLS (then STUN-only) if unset or if the API call fails.
    METERED_TURN_APP_NAME: z.string().optional(),
    METERED_TURN_API_KEY: z.string().optional(),
    METERED_TURN_REGION: z.string().optional(),

    // Introduction-verification videos, pending manual admin review, are
    // stored in a private Cloudflare R2 bucket (see the R2_* vars below and
    // videoStorage.ts) — not on local disk, which would not survive a Render
    // redeploy/restart.
    VERIFICATION_VIDEO_MAX_BYTES: z.coerce.number().default(25 * 1024 * 1024), // 25MB
    // Enforced both client-side (fast UX feedback) and server-side (the real
    // guarantee — see videoStorage.ts, which reads the actual container
    // metadata via music-metadata rather than trusting the browser).
    VERIFICATION_VIDEO_MAX_DURATION_SECONDS: z.coerce.number().default(15),

    // Cloudflare R2 (S3-compatible) — private bucket backing verification
    // video storage (see videoStorage.ts). All four are required: the server
    // treats R2 as the only storage backend for this feature, not an optional
    // enhancement. Never logged, never sent to any client — read only here.
    R2_ENDPOINT: z.string().min(1, "R2_ENDPOINT is required"),
    R2_BUCKET_NAME: z.string().min(1, "R2_BUCKET_NAME is required"),
    R2_ACCESS_KEY_ID: z.string().min(1, "R2_ACCESS_KEY_ID is required"),
    R2_SECRET_ACCESS_KEY: z.string().min(1, "R2_SECRET_ACCESS_KEY is required"),
  })
  .superRefine((value, ctx) => {
    // Messages below never include the offending value — they end up in logs.
    if (value.NODE_ENV === "production") {
      const secret = value.INTERNAL_API_SECRET;
      if (secret.length < PRODUCTION_INTERNAL_SECRET_MIN_LENGTH) {
        ctx.addIssue({
          code: "custom",
          path: ["INTERNAL_API_SECRET"],
          message: `INTERNAL_API_SECRET must be at least ${PRODUCTION_INTERNAL_SECRET_MIN_LENGTH} chars in production`,
        });
      } else if (new Set(secret).size < PRODUCTION_INTERNAL_SECRET_MIN_DISTINCT_CHARS) {
        ctx.addIssue({
          code: "custom",
          path: ["INTERNAL_API_SECRET"],
          message: "INTERNAL_API_SECRET is too repetitive for production; generate a random value",
        });
      } else if (PLACEHOLDER_SECRET_PATTERN.test(secret)) {
        ctx.addIssue({
          code: "custom",
          path: ["INTERNAL_API_SECRET"],
          message: "INTERNAL_API_SECRET looks like a placeholder; generate a random value",
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export type ParseEnvResult = { success: true; data: Env } | { success: false; errors: string[] };

export function parseEnv(source: Record<string, string | undefined>): ParseEnvResult {
  const errors: string[] = [];

  // Checked ahead of (and independently from) the schema so the message is
  // specific: a deployed process must say NODE_ENV=production, not just any
  // valid value.
  const platform = DEPLOYED_PLATFORM_MARKERS.find((marker) => source[marker] === "true");
  if (platform && source.NODE_ENV !== "production") {
    errors.push(`NODE_ENV: running on a hosting platform (${platform}) requires NODE_ENV=production`);
  }

  const result = envSchema.safeParse(source);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join(".") || "(root)";
      errors.push(`${path}: ${issue.message}`);
    }
  }

  if (errors.length > 0 || !result.success) {
    return { success: false, errors };
  }
  return { success: true, data: result.data };
}
