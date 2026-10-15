import { randomUUID } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { parseBuffer } from "music-metadata";
import { env } from "../config/env.js";
import { AuthError } from "./auth.service.js";

/**
 * Private Cloudflare R2 bucket (S3-compatible API) backing verification
 * video storage — never served through a public/static route, never given a
 * public or presigned URL. The only way a video's bytes ever leave this
 * module is through readVerificationVideo(), called solely by the
 * authenticated admin review endpoint, which independently re-verifies the
 * acting user's role server-side before calling it.
 *
 * Object keys are always server-generated (randomUUID-based), never
 * client-supplied, so there is no path-traversal or key-guessing surface.
 */
const s3 = new S3Client({
  region: "auto",
  endpoint: env.R2_ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

const ALLOWED_TYPES: Record<string, { ext: string; matches: (buffer: Buffer) => boolean }> = {
  "video/mp4": {
    ext: "mp4",
    // MP4/MOV family: an `ftyp` box appears at byte offset 4, not the start
    // of the file — there is no fixed leading magic-byte signature the way
    // JPEG/PNG have.
    matches: (buffer) => buffer.length > 8 && buffer.toString("ascii", 4, 8) === "ftyp",
  },
  "video/webm": {
    ext: "webm",
    // EBML header, used by both WebM and Matroska.
    matches: (buffer) =>
      buffer.length >= 4 &&
      buffer[0] === 0x1a &&
      buffer[1] === 0x45 &&
      buffer[2] === 0xdf &&
      buffer[3] === 0xa3,
  },
  "video/quicktime": {
    ext: "mov",
    matches: (buffer) => buffer.length > 8 && buffer.toString("ascii", 4, 8) === "ftyp",
  },
};

/** True for the AWS SDK v3 error shapes R2 returns for a missing object. */
function isNotFoundError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const name = (err as { name?: string }).name;
    if (name === "NotFound" || name === "NoSuchKey") return true;
    const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404) return true;
  }
  return false;
}

/**
 * Decodes + validates a base64-encoded introduction video and uploads it to
 * the private R2 bucket under a server-generated key (never the
 * client-supplied one). Returns the opaque storage key to persist on the
 * submission row.
 *
 * Duration is independently verified here via music-metadata (a pure-JS
 * media-metadata parser — no ffmpeg/native binary required), reading the
 * real container metadata rather than trusting anything the browser
 * reports. If the duration can't be determined at all (e.g. a truncated or
 * otherwise malformed container), the upload is rejected rather than
 * assumed to be within limits — this check fails closed.
 */
export async function saveVerificationVideo(base64Data: string, declaredMimeType: string): Promise<string> {
  const typeInfo = ALLOWED_TYPES[declaredMimeType];
  if (!typeInfo) {
    throw new AuthError("Video must be MP4, WebM, or MOV.", 400);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, "base64");
  } catch {
    throw new AuthError("Video upload is not valid base64 data.", 400);
  }

  if (buffer.length === 0 || buffer.length > env.VERIFICATION_VIDEO_MAX_BYTES) {
    throw new AuthError(
      `Video must be non-empty and under ${Math.floor(env.VERIFICATION_VIDEO_MAX_BYTES / (1024 * 1024))}MB.`,
      400,
    );
  }

  // Never trust the declared MIME type alone — confirm the file's actual
  // magic bytes match before uploading it as that type.
  if (!typeInfo.matches(buffer)) {
    throw new AuthError("Video file content does not match its declared type.", 400);
  }

  // Never trust a client-reported duration — independently read it from the
  // container's own metadata. Any parse failure (corrupted, truncated, or
  // otherwise malformed media) is treated as a rejection, not a pass.
  let durationSeconds: number | undefined;
  try {
    const metadata = await parseBuffer(buffer, declaredMimeType);
    durationSeconds = metadata.format.duration;
  } catch {
    throw new AuthError("Video file could not be read — it may be corrupted or in an unsupported format.", 400);
  }

  if (durationSeconds === undefined || !Number.isFinite(durationSeconds)) {
    throw new AuthError("Video duration could not be verified.", 400);
  }

  if (durationSeconds > env.VERIFICATION_VIDEO_MAX_DURATION_SECONDS) {
    throw new AuthError(
      `Video must be ${env.VERIFICATION_VIDEO_MAX_DURATION_SECONDS} seconds or shorter.`,
      400,
    );
  }

  const key = `${randomUUID()}.${typeInfo.ext}`;
  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: env.R2_BUCKET_NAME,
        Key: key,
        Body: buffer,
        ContentType: declaredMimeType,
      }),
    );
  } catch (err) {
    console.error("Failed to upload verification video:", err instanceof Error ? err.message : "unknown error");
    throw new AuthError("Something went wrong uploading your video. Please try again.", 500);
  }

  return key;
}

export async function readVerificationVideo(storageKey: string): Promise<Buffer> {
  // `storageKey` always comes from a submission row written by
  // saveVerificationVideo, never client input.
  try {
    const result = await s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storageKey }));
    const bytes = await result.Body?.transformToByteArray();
    if (!bytes) {
      throw new Error("Empty response body from R2.");
    }
    return Buffer.from(bytes);
  } catch (err) {
    if (isNotFoundError(err)) {
      // Preserves the ENOENT contract callers (adminVerification.ts) already
      // check for, so that route needs no changes.
      const notFound = new Error("Video not found.") as NodeJS.ErrnoException;
      notFound.code = "ENOENT";
      throw notFound;
    }
    console.error("Failed to read verification video:", err instanceof Error ? err.message : "unknown error");
    throw err;
  }
}

/**
 * Deletes the video and verifies it is actually gone before returning true —
 * callers (videoVerification.service.ts) must not finalize an approval
 * decision unless this returns true.
 *
 * Idempotent: deleting an already-deleted (or never-written) key is treated
 * as success, matching S3/R2's own DeleteObject semantics (which do not
 * error for a missing key). Any authentication, network, or other failure —
 * on either the delete call or the existence check that confirms it — is
 * treated as a failure, never as success; an outage must never be
 * misreported as a confirmed deletion.
 */
export async function deleteVerificationVideo(storageKey: string): Promise<boolean> {
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storageKey }));
  } catch (err) {
    console.error("Failed to delete verification video (will retry): video deletion error");
    return false;
  }

  try {
    await s3.send(new HeadObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: storageKey }));
    // Still exists somehow (e.g. a concurrent write race) — do not report
    // success.
    return false;
  } catch (err) {
    if (isNotFoundError(err)) {
      return true; // confirmed gone
    }
    // Authentication, network, or any other error while confirming — fail
    // closed. We cannot tell whether the object is actually gone, so this
    // must not be reported as a successful deletion.
    console.error("Failed to verify verification video deletion: confirmation error");
    return false;
  }
}
