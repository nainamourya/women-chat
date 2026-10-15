import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),
  // Comma-separated if the app is served from more than one domain (e.g. a
  // Vercel-assigned domain plus a custom domain) — see CORS_ORIGINS below,
  // which both Express's cors() and the Socket.IO server read instead of
  // this raw string, since both accept an array of allowed origins.
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
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("Invalid server environment variables:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

// Split (and trim) so a single Render env var can list multiple allowed
// origins, e.g. "https://women-chat.vercel.app,https://www.giigirl.com" —
// both cors() and the Socket.IO server accept an array here natively.
export const CORS_ORIGINS = env.CORS_ORIGIN.split(",").map((origin) => origin.trim());
