import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { parseBuffer } from "music-metadata";
import { users, verificationSubmissions } from "../../server/src/db/schema";
import { AuthError } from "../../server/src/services/auth.service";
import { getConfig } from "./config";
import { db } from "./db";
import { getRequestContext } from "./realtime/env";
import { checkLimitFailOpen } from "./realtime/limiter";
import { deleteVerificationVideo } from "./shims/videoStorage";

// Streaming replacement for POST /api/verification/video.
//
// The Express route took the whole video as a base64 string inside a JSON body
// (~33 MB for 25 MB of video) and decoded it in memory. A Worker has 128 MB, and
// that path holds the raw body, the string, the parsed copy and the decoded
// bytes together, so it is not safe here. This route takes the raw video bytes
// as the request body and streams them straight into R2 without holding them in
// the Worker, then validates the stored object exactly as the Express server
// validated the decoded one (declared type, size, magic bytes, and a container-
// metadata duration that fails closed), and deletes it if anything fails.
//
//   PUT /api/verification/video/:userId
//   headers: x-internal-api-secret, Content-Type: video/mp4 | video/webm | video/quicktime,
//            Content-Length: <bytes>, x-acknowledged-notice: true
//   body:    the raw video
//   201 { submission } on success; the same errors, statuses and messages as before.
//
// `userId` is the Next.js server's own trusted session user id, never client
// input — the same trust model as every other internal route.

// Copied from apps/server/src/services/videoStorage.ts (not exported there).
const ALLOWED_TYPES: Record<string, { ext: string; matches: (buffer: Buffer) => boolean }> = {
  "video/mp4": {
    ext: "mp4",
    // The `ftyp` box sits at byte offset 4; there is no fixed leading signature.
    matches: (buffer) => buffer.length > 8 && buffer.toString("ascii", 4, 8) === "ftyp",
  },
  "video/webm": {
    ext: "webm",
    // EBML header, used by both WebM and Matroska.
    matches: (buffer) => buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3,
  },
  "video/quicktime": {
    ext: "mov",
    matches: (buffer) => buffer.length > 8 && buffer.toString("ascii", 4, 8) === "ftyp",
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const VIDEO_UPLOAD_PATH = /^\/api\/verification\/video\/([^/]+)$/;

const json = (body: unknown, status: number, headers?: Record<string, string>) => Response.json(body, { status, headers });

// Constant-time comparison, as in apps/server/src/middleware/internalAuth.ts.
function secretMatches(provided: string | null): boolean {
  const config = getConfig();
  if (!provided || !config.ok) return false;
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(config.env.INTERNAL_API_SECRET).digest();
  return timingSafeEqual(a, b);
}

export async function handleVideoUpload(request: Request, userIdParam: string): Promise<Response> {
  // Same order as the Express route: authenticate, validate, rate-limit, then the service checks.
  if (!secretMatches(request.headers.get("x-internal-api-secret"))) return json({ error: "Unauthorized." }, 401);
  if (!UUID.test(userIdParam)) return json({ error: "Invalid user id." }, 400);
  const userId = userIdParam.toLowerCase();

  const config = getConfig();
  if (!config.ok) return json({ error: "Service unavailable." }, 503);
  const { env } = getRequestContext();
  const maxBytes = config.env.VERIFICATION_VIDEO_MAX_BYTES;
  const maxSeconds = config.env.VERIFICATION_VIDEO_MAX_DURATION_SECONDS;

  const limit = await checkLimitFailOpen(env, `ratelimit:verification:video:${userId}`, 5, 60 * 60, "verification:video");
  if (!limit.allowed) {
    return json({ error: "Too many attempts. Please try again later." }, 429, {
      "Retry-After": String(Math.max(1, Math.ceil(limit.retryAfterSeconds))),
    });
  }

  let storageKey: string | undefined;
  try {
    if (request.headers.get("x-acknowledged-notice") !== "true") {
      throw new AuthError("You must acknowledge the verification and privacy notice before uploading.", 400);
    }

    const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
    if (!user) throw new AuthError("User not found.", 404);

    // App-level pre-check for a friendly message; the partial unique index
    // (verification_submissions_one_pending_per_user) is the real guard.
    const existingPending = await db.query.verificationSubmissions.findFirst({
      where: and(eq(verificationSubmissions.userId, userId), eq(verificationSubmissions.status, "pending_review")),
    });
    if (existingPending) throw new AuthError("You already have a submission awaiting review.", 409);

    const mimeType = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
    const typeInfo = ALLOWED_TYPES[mimeType];
    if (!typeInfo) throw new AuthError("Video must be MP4, WebM, or MOV.", 400);

    // The size is declared up front, so an oversized or empty upload is refused
    // before a single byte is read. (The runtime enforces that the body really
    // is that long.)
    const declared = request.headers.get("content-length");
    if (declared === null || !/^\d+$/.test(declared)) return json({ error: "Content-Length is required." }, 411);
    const length = Number(declared);
    const sizeMessage = `Video must be non-empty and under ${Math.floor(maxBytes / (1024 * 1024))}MB.`;
    if (length === 0 || length > maxBytes) throw new AuthError(sizeMessage, 400);
    if (!request.body) throw new AuthError(sizeMessage, 400);

    // Streamed into R2: the Worker never holds the upload.
    storageKey = `${randomUUID()}.${typeInfo.ext}`;
    try {
      await env.PRIVATE_BUCKET.put(storageKey, request.body, { httpMetadata: { contentType: mimeType } });
    } catch (err) {
      console.error("Failed to upload verification video:", err instanceof Error ? err.name : "unknown error");
      throw new AuthError("Something went wrong uploading your video. Please try again.", 500);
    }

    // Validate what was actually stored (never the client's claims).
    const stored = await env.PRIVATE_BUCKET.get(storageKey);
    if (!stored || stored.size === 0 || stored.size > maxBytes) throw new AuthError(sizeMessage, 400);
    const buffer = Buffer.from(await stored.arrayBuffer()); // at most 25 MB, one copy, no base64

    if (!typeInfo.matches(buffer)) {
      throw new AuthError("Video file content does not match its declared type.", 400);
    }

    // Duration comes from the container's own metadata; failing to read it is a
    // rejection, not a pass.
    let durationSeconds: number | undefined;
    try {
      durationSeconds = (await parseBuffer(buffer, mimeType)).format.duration;
    } catch {
      throw new AuthError("Video file could not be read — it may be corrupted or in an unsupported format.", 400);
    }
    if (durationSeconds === undefined || !Number.isFinite(durationSeconds)) {
      throw new AuthError("Video duration could not be verified.", 400);
    }
    // Rounded before comparing, as on Express (encoders report e.g. 15.03 s).
    if (Math.round(durationSeconds) > maxSeconds) {
      throw new AuthError(`Video must be ${maxSeconds} seconds or shorter.`, 400);
    }

    let submission: typeof verificationSubmissions.$inferSelect;
    try {
      [submission] = await db
        .insert(verificationSubmissions)
        .values({ userId, status: "pending_review", videoStorageKey: storageKey })
        .returning();
    } catch (err) {
      // drizzle wraps the driver error, so the code can be on `cause`.
      const code = (err as { code?: string })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
      if (code === "23505") throw new AuthError("You already have a submission awaiting review.", 409);
      throw err;
    }

    await db.update(users).set({ verificationStatus: "pending", updatedAt: new Date() }).where(eq(users.id, userId));

    // Never exposes videoStorageKey: an internal reference no client needs.
    const { videoStorageKey: _omit, ...publicSubmission } = submission;
    storageKey = undefined; // now referenced by a row: must not be cleaned up
    return json({ submission: publicSubmission }, 201);
  } catch (err) {
    // Anything that stopped the submission leaves no orphaned video behind.
    if (storageKey) await deleteVerificationVideo(storageKey).catch(() => false);
    if (err instanceof AuthError) return json({ error: err.message }, err.status);
    console.error("submit verification video error:", err instanceof Error ? err.name : "unknown error");
    return json({ error: "Something went wrong." }, 500);
  }
}
