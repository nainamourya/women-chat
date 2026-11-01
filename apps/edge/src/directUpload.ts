import { isIP } from "node:net";
import { getConfig } from "./config";
import { getRequestContext, ticketStoreFor } from "./realtime/env";
import { checkLimitFailOpen } from "./realtime/limiter";
import { processUpload, secretMatches } from "./verificationUpload";

// Direct browser -> Worker verification video upload.
//
// Vercel Functions reject request bodies over 4.5 MB, so the video cannot pass
// through the Next.js app. Instead the signed-in browser asks a Next.js route
// (session-authenticated) for a short-lived upload authorization and sends the
// raw bytes straight here:
//
//   PUT /api/verification/video-upload
//   Authorization: Bearer <upload authorization>
//   Content-Type: video/mp4 | video/webm | video/quicktime     (must equal the authorization's)
//   Content-Length: <bytes>                                     (must equal the authorization's)
//   x-acknowledged-notice: true
//
// The authorization is a signed token, NOT x-internal-api-secret (which never
// reaches a browser). It is signed with UPLOAD_TOKEN_SECRET, a separate secret
// shared only by the Next.js server and this Worker. Claims:
//   sub  the session user's id  (the only user this token can upload as)
//   jti  random id, spent exactly once (TicketStore.claim)
//   iat / exp  issue and expiry, at most MAX_TOKEN_LIFETIME_SECONDS apart
//   ct / len   the one content type and exact byte length it authorizes
// Everything the upload does afterwards (rate limit, acknowledgement, user and
// pending-submission checks, magic bytes, duration, R2 cleanup) is the same code
// the internal route runs, so the token adds a way in, not a way around.

export const DIRECT_UPLOAD_PATH = "/api/verification/video-upload";
export const MAX_TOKEN_LIFETIME_SECONDS = 300;
const CLOCK_SKEW_SECONDS = 30;
const ALLOWED_CONTENT_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const TOKEN_DOMAIN = "giigirl-verification-upload.v1.";
const MIN_SECRET_LENGTH = 32;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

type Claims = { sub: string; jti: string; iat: number; exp: number; ct: string; len: number };

const textEncoder = new TextEncoder();

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  try {
    const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(binary, (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/** The signing secret, or null when it is missing, short, or reused from the internal secret. */
function uploadSecret(): string | null {
  const config = getConfig();
  const secret = process.env.UPLOAD_TOKEN_SECRET;
  if (!config.ok || !secret || secret.length < MIN_SECRET_LENGTH) return null;
  if (secret === config.env.INTERNAL_API_SECRET) return null;
  return secret;
}

async function verifyToken(token: string, secret: string): Promise<Claims | null> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;
  const [, payloadB64, signatureB64] = parts;
  const signature = fromBase64Url(signatureB64);
  if (!signature) return null;

  const key = await crypto.subtle.importKey("raw", textEncoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  // subtle.verify compares in constant time.
  const valid = await crypto.subtle.verify("HMAC", key, signature, textEncoder.encode(TOKEN_DOMAIN + payloadB64));
  if (!valid) return null;

  const payloadBytes = fromBase64Url(payloadB64);
  if (!payloadBytes) return null;
  let claims: Claims;
  try {
    claims = JSON.parse(new TextDecoder().decode(payloadBytes));
  } catch {
    return null;
  }
  const now = Math.floor(Date.now() / 1000);
  const wellFormed =
    typeof claims?.sub === "string" && UUID.test(claims.sub) &&
    typeof claims.jti === "string" && UUID.test(claims.jti) &&
    Number.isInteger(claims.iat) && Number.isInteger(claims.exp) &&
    typeof claims.ct === "string" && ALLOWED_CONTENT_TYPES.includes(claims.ct) &&
    Number.isInteger(claims.len) && claims.len > 0;
  if (!wellFormed) return null;
  if (claims.exp <= now) return null; // expired
  if (claims.iat > now + CLOCK_SKEW_SECONDS) return null; // issued in the future
  if (claims.exp <= claims.iat) return null; // never valid
  if (claims.exp - claims.iat > MAX_TOKEN_LIFETIME_SECONDS) return null; // longer-lived than we ever issue
  return claims;
}

/** CORS for this one route: the exact configured origin(s), no credentials, no wildcard. */
function corsHeaders(request: Request): Record<string, string> | null {
  const config = getConfig();
  const origin = request.headers.get("origin");
  if (!config.ok || !origin || !config.corsOrigins.includes(origin)) return null;
  return { "Access-Control-Allow-Origin": origin, Vary: "Origin" };
}

function withCors(response: Response, cors: Record<string, string> | null): Response {
  if (!cors) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(response.body, { status: response.status, headers });
}

const reject = (status: number, error: string) => Response.json({ error }, { status });

export async function handleDirectUpload(request: Request): Promise<Response> {
  const cors = corsHeaders(request);
  try {
    return await directUpload(request, cors);
  } catch (err) {
    // Fail closed, and with the CORS header so the browser can read the error. If
    // this happened after the one-time claim the token is spent: the page asks for
    // a fresh one. Only the error class is logged, never a token or a key.
    console.error("direct verification upload failed:", err instanceof Error ? err.name : "unknown error");
    return withCors(reject(503, "Upload is temporarily unavailable. Please try again."), cors);
  }
}

async function directUpload(request: Request, cors: Record<string, string> | null): Promise<Response> {

  if (request.method === "OPTIONS") {
    // Preflight: answered only for an allowed origin; anything else gets no CORS headers.
    if (!cors) return new Response(null, { status: 403, headers: { Vary: "Origin" } });
    return new Response(null, {
      status: 204,
      headers: {
        ...cors,
        "Access-Control-Allow-Methods": "PUT",
        "Access-Control-Allow-Headers": "authorization, content-type, x-acknowledged-notice",
        "Access-Control-Max-Age": "600",
      },
    });
  }
  if (request.method !== "PUT") return withCors(reject(405, "Method not allowed."), cors);

  // A browser always sends Origin; one from somewhere else is refused outright.
  if (request.headers.get("origin") && !cors) return reject(403, "Origin not allowed.");

  if (!getConfig().ok) return withCors(reject(503, "Service unavailable."), cors);
  const secret = uploadSecret();
  if (!secret) return withCors(reject(503, "Direct upload is not configured."), cors);

  const bearer = /^Bearer (\S+)$/.exec(request.headers.get("authorization") ?? "");
  const claims = bearer ? await verifyToken(bearer[1], secret) : null;
  if (!claims) return withCors(reject(401, "Upload authorization is invalid or expired."), cors);

  // The token authorizes exactly one content type and one exact length. A
  // mismatch is a different upload from the one authorized, and does not spend it.
  const contentType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (contentType !== claims.ct) return withCors(reject(400, "Video type does not match the upload authorization."), cors);
  const declared = request.headers.get("content-length");
  if (declared === null || !/^\d+$/.test(declared)) return withCors(reject(411, "Content-Length is required."), cors);
  if (Number(declared) !== claims.len) return withCors(reject(400, "Video size does not match the upload authorization."), cors);

  // One-time use, spent before a single byte is read. Kept well past expiry.
  const { env } = getRequestContext();
  const keepMs = (MAX_TOKEN_LIFETIME_SECONDS + CLOCK_SKEW_SECONDS) * 2 * 1000;
  const spent = await ticketStoreFor(env, claims.jti).claim(claims.jti, keepMs);
  if (!spent) return withCors(reject(401, "Upload authorization is invalid or expired."), cors);

  return withCors(await processUpload(request, claims.sub), cors);
}

// ---- Limit on minting upload authorizations --------------------------------------
//
// The Next.js route that mints tokens runs on Vercel, which has no shared store, and
// an in-memory limiter there would not survive across serverless instances. It asks
// this endpoint instead, so the count lives in the same Limiter Durable Object as
// every other limit. Internal-secret authenticated (server to server).
//
//   POST /api/verification/video-authorization/check   { userId, ip? }
//   200 { allowed: true }   |   429 { error } + Retry-After
//
// Per user: 10 / hour. Uploads themselves are capped at 5 / hour, so this leaves
// room for tokens that expire or are refused without letting a client mint without
// bound. Per IP (only when the web app can supply a trusted one): 30 / hour, a
// guard against one source cycling through many accounts that is loose enough for
// a shared network.

export const AUTHORIZATION_CHECK_PATH = "/api/verification/video-authorization/check";
export const AUTHORIZE_USER_LIMIT = { limit: 10, windowSeconds: 60 * 60 };
export const AUTHORIZE_IP_LIMIT = { limit: 30, windowSeconds: 60 * 60 };

export async function handleAuthorizationCheck(request: Request): Promise<Response> {
  if (request.method !== "POST") return reject(405, "Method not allowed.");
  if (!secretMatches(request.headers.get("x-internal-api-secret"))) return reject(401, "Unauthorized.");
  if (!getConfig().ok) return reject(503, "Service unavailable.");

  const declared = request.headers.get("content-length");
  if (declared !== null && Number(declared) > 1024) return reject(400, "Invalid request.");
  let body: { userId?: unknown; ip?: unknown };
  try {
    const text = await request.text();
    if (text.length > 1024) return reject(400, "Invalid request.");
    body = JSON.parse(text);
  } catch {
    return reject(400, "Invalid request.");
  }
  if (typeof body.userId !== "string" || !UUID.test(body.userId.toLowerCase())) return reject(400, "Invalid request.");
  if (body.ip !== undefined && (typeof body.ip !== "string" || isIP(body.ip) === 0)) return reject(400, "Invalid request.");

  const { env } = getRequestContext();
  const user = body.userId.toLowerCase();
  const checks: Array<[string, { limit: number; windowSeconds: number }]> = [
    [`ratelimit:verification:authorize:${user}`, AUTHORIZE_USER_LIMIT],
  ];
  if (body.ip) checks.push([`ratelimit:verification:authorize-ip:${body.ip.toLowerCase()}`, AUTHORIZE_IP_LIMIT]);

  for (const [key, { limit, windowSeconds }] of checks) {
    const result = await checkLimitFailOpen(env, key, limit, windowSeconds, "verification:authorize");
    if (!result.allowed) {
      const retryAfter = Math.max(1, Math.ceil(result.retryAfterSeconds));
      return Response.json(
        { error: "Too many upload attempts. Please try again later." },
        { status: 429, headers: { "Retry-After": String(retryAfter) } },
      );
    }
  }
  return Response.json({ allowed: true });
}
