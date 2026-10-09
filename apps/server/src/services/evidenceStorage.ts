import { randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../config/env.js";
import { AuthError } from "./auth.service.js";

/**
 * PROTOTYPE ONLY: report evidence is written to local disk on the Express
 * server. It is never served through a public/static route — only the
 * authenticated admin evidence endpoint reads it back (see reports
 * routes). For production this directory should be replaced with
 * object storage (e.g. S3) behind short-lived signed URLs, plus a
 * scheduled job that deletes evidence past a defined retention window —
 * neither exists yet here, so files persist indefinitely until someone
 * manually clears the directory.
 */
const EVIDENCE_DIR = path.resolve(process.cwd(), env.REPORT_EVIDENCE_DIR);

export const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024; // 5MB

const ALLOWED_TYPES: Record<string, { ext: string; signature: number[] }> = {
  "image/jpeg": { ext: "jpg", signature: [0xff, 0xd8, 0xff] },
  "image/png": { ext: "png", signature: [0x89, 0x50, 0x4e, 0x47] },
  "image/webp": { ext: "webp", signature: [0x52, 0x49, 0x46, 0x46] }, // "RIFF" (WEBP marker follows at byte 8)
};

function matchesSignature(buffer: Buffer, signature: number[]): boolean {
  return signature.every((byte, i) => buffer[i] === byte);
}

async function ensureDir(): Promise<void> {
  await mkdir(EVIDENCE_DIR, { recursive: true });
}

/**
 * Decodes + validates a base64-encoded screenshot and writes it to the
 * local evidence directory under a server-generated filename (never the
 * client-supplied one). Returns the relative filename to store on the
 * report row.
 */
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

  // Never trust the declared MIME type alone — confirm the file's actual
  // magic bytes match before writing it as that type.
  if (!matchesSignature(buffer, typeInfo.signature)) {
    throw new AuthError("Evidence file content does not match its declared type.", 400);
  }
  if (declaredMimeType === "image/webp" && buffer.toString("ascii", 8, 12) !== "WEBP") {
    throw new AuthError("Evidence file content does not match its declared type.", 400);
  }

  await ensureDir();
  const filename = `${randomUUID()}.${typeInfo.ext}`;
  await writeFile(path.join(EVIDENCE_DIR, filename), buffer, { mode: 0o600 });

  return filename;
}

export async function readEvidence(filename: string): Promise<Buffer> {
  // `filename` always comes from a report row written by saveEvidence, never
  // client input, so a plain join is safe — no path traversal surface.
  const filePath = path.join(EVIDENCE_DIR, filename);
  await stat(filePath); // throws ENOENT if missing, surfaced by caller as a 404
  return readFile(filePath);
}
