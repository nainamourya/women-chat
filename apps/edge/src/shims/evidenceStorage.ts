import { randomUUID } from "node:crypto";
import { AuthError } from "../../../server/src/services/auth.service";
import { getRequestContext } from "../realtime/env";

// Build-time replacement for apps/server/src/services/evidenceStorage.ts (see
// scripts/build.mjs). The Express version wrote report screenshots to the local
// disk of the server ("PROTOTYPE ONLY" in its own comment); a Worker has no
// disk, so they go to the same private R2 bucket under "reports/evidence/".
// Validation is identical: JPG/PNG/WEBP only, 5 MB, magic bytes must match the
// declared type, server-generated file names. Evidence is never served through a
// public route: only the authenticated admin evidence endpoint reads it back.
// There is still no retention job (the original has none either).

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024; // 5MB

const ALLOWED_TYPES: Record<string, { ext: string; signature: number[] }> = {
  "image/jpeg": { ext: "jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": { ext: "png", signature: [0x89, 0x50, 0x4e, 0x47] },
  "image/webp": { ext: "webp", signature: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" (WEBP marker follows at byte 8)
};

const FILENAME_PATTERN = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const KEY_PREFIX = "reports/evidence/";

const bucket = () => getRequestContext().env.PRIVATE_BUCKET;

function matchesSignature(buffer: Buffer, signature: number[]): boolean {
  return signature.every((byte, i) => buffer[i] === byte);
}

export async function saveEvidence(base64Data: string, declaredMimeType: string): Promise<string> {
  const typeInfo = ALLOWED_TYPES[declaredMimeType];
  if (!typeInfo) {
    throw new AuthError("Evidence must be a JPG, PNG, or WEBP image.", 400);
  }

  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64Data, "base64");
  } catch {
    throw new AuthError("Evidence upload is not valid base64 data.", 400);
  }

  if (buffer.length === 0 || buffer.length > MAX_EVIDENCE_BYTES) {
    throw new AuthError("Evidence must be a non-empty image under 5MB.", 400);
  }

  // Never trust the declared MIME type alone.
  if (!matchesSignature(buffer, typeInfo.signature)) {
    throw new AuthError("Evidence file content does not match its declared type.", 400);
  }
  if (declaredMimeType === "image/webp" && buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new AuthError("Evidence file content does not match its declared type.", 400);
  }

  const filename = `${randomUUID()}.${typeInfo.ext}`;
  try {
    await bucket().put(KEY_PREFIX + filename, buffer, { httpMetadata: { contentType: declaredMimeType } });
  } catch (err) {
    console.error("Failed to store report evidence:", err instanceof Error ? err.name : "unknown error");
    throw new AuthError("Something went wrong saving your evidence. Please try again.", 500);
  }
  return filename;
}

export async function readEvidence(filename: string): Promise<Buffer> {
  // `filename` always comes from a report row written by saveEvidence; the
  // pattern check keeps a malformed value from ever being turned into a key.
  if (!FILENAME_PATTERN.test(filename)) {
    const notFound = new Error("Evidence not found.") as NodeJS.ErrnoException;
    notFound.code = "ENOENT";
    throw notFound;
  }
  const object = await bucket().get(KEY_PREFIX + filename);
  if (!object) {
    const notFound = new Error("Evidence not found.") as NodeJS.ErrnoException;
    notFound.code = "ENOENT"; // surfaced by the caller as a 404, as before
    throw notFound;
  }
  return Buffer.from(await object.arrayBuffer());
}
