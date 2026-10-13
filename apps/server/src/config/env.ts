import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  CORS_ORIGIN: z.string().min(1, "CORS_ORIGIN is required"),
  // Shared secret so the Next.js server (not the browser) can call trusted
  // internal endpoints. Rotate independently of NEXTAUTH_SECRET.
  INTERNAL_API_SECRET: z.string().min(16, "INTERNAL_API_SECRET must be at least 16 chars"),
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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid server environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;
