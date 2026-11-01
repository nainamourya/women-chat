import { createHmac, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

// Verification videos go straight from the browser to the backend Worker: Vercel
// Functions reject request bodies over 4.5 MB, so the bytes cannot pass through
// here. This route (session-authenticated) only mints a short-lived, one-time
// upload authorization for the signed-in user. The Worker verifies it, spends it
// once, and still runs every existing check (rate limit, acknowledgement,
// pending-submission, magic bytes, duration). See apps/edge/src/directUpload.ts,
// which defines the token format this must match.
//
// UPLOAD_TOKEN_SECRET is its own secret, shared only with the Worker. The
// internal API secret is never sent to a browser and never used to sign this.

const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
// Mirrors VERIFICATION_VIDEO_MAX_BYTES on the backend (the Worker is the real gate).
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const TOKEN_LIFETIME_SECONDS = 120;
const TOKEN_DOMAIN = "giigirl-verification-upload.v1.";
const MIN_SECRET_LENGTH = 32;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The client address, only where a trusted host sets it. Vercel overwrites
// x-forwarded-for / x-vercel-forwarded-for and does not forward external values
// (Vercel's request-headers docs), so on Vercel they are the real client. Anywhere
// else the headers are client-controlled, so no address is used and only the
// per-user limit applies. A malformed value is ignored the same way.
function trustedClientIp(req: Request): string | undefined {
  if (process.env.VERCEL !== "1") return undefined;
  const raw = req.headers.get("x-vercel-forwarded-for") ?? "";
  const first = raw.split(",")[0].trim();
  return first && isIP(first) !== 0 ? first : undefined;
}

const b64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  // Never sign for an identity that is not a well-formed user id.
  if (!UUID.test(session.user.id)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const secret = process.env.UPLOAD_TOKEN_SECRET;
  const serverUrl = process.env.SERVER_URL;
  if (!secret || secret.length < MIN_SECRET_LENGTH || secret === process.env.INTERNAL_API_SECRET || !serverUrl) {
    console.error("Verification upload is not configured (UPLOAD_TOKEN_SECRET / SERVER_URL).");
    return NextResponse.json({ error: "Video upload is temporarily unavailable." }, { status: 503 });
  }

  let body: { contentType?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const contentType = typeof body.contentType === "string" ? body.contentType.split(";")[0].trim().toLowerCase() : "";
  if (!ALLOWED_VIDEO_TYPES.includes(contentType)) {
    return NextResponse.json({ error: "Video must be MP4, WebM, or MOV." }, { status: 400 });
  }
  const size = body.size;
  if (typeof size !== "number" || !Number.isInteger(size) || size <= 0 || size > MAX_VIDEO_BYTES) {
    return NextResponse.json(
      { error: `Video must be non-empty and under ${Math.floor(MAX_VIDEO_BYTES / (1024 * 1024))}MB.` },
      { status: 400 },
    );
  }

  // Rate limit, kept in the backend's Durable Object limiter (this app has no
  // shared store, and a per-instance counter would not hold across serverless
  // instances). Per session user always; per client address where Vercel supplies
  // a trusted one. If the limiter cannot be reached the request is refused: an
  // upload cannot succeed without the backend anyway.
  let limited: Response;
  try {
    limited = await fetch(`${serverUrl.replace(/\/+$/, "")}/api/verification/video-authorization/check`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-api-secret": process.env.INTERNAL_API_SECRET! },
      body: JSON.stringify({ userId: session.user.id, ip: trustedClientIp(req) }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return NextResponse.json({ error: "Video upload is temporarily unavailable." }, { status: 503 });
  }
  if (limited.status === 429) {
    const retryAfter = limited.headers.get("retry-after");
    return NextResponse.json(
      { error: "Too many upload attempts. Please try again later." },
      { status: 429, headers: { "Cache-Control": "no-store", ...(retryAfter && /^\d+$/.test(retryAfter) ? { "Retry-After": retryAfter } : {}) } },
    );
  }
  if (!limited.ok) {
    return NextResponse.json({ error: "Video upload is temporarily unavailable." }, { status: 503 });
  }

  // The user is always the session's own; the type and size are bound into the
  // token so it authorizes exactly this one upload and nothing else.
  const iat = Math.floor(Date.now() / 1000);
  const payload = b64url(
    JSON.stringify({ sub: session.user.id, jti: randomUUID(), iat, exp: iat + TOKEN_LIFETIME_SECONDS, ct: contentType, len: size }),
  );
  const signature = createHmac("sha256", secret).update(TOKEN_DOMAIN + payload).digest("base64url");

  return NextResponse.json(
    {
      uploadUrl: `${serverUrl.replace(/\/+$/, "")}/api/verification/video-upload`,
      token: `v1.${payload}.${signature}`,
      expiresAt: new Date((iat + TOKEN_LIFETIME_SECONDS) * 1000).toISOString(),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
