import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { env } from "../../config/env.js";
import { AuthError } from "../auth.service.js";

// Storage for profile photos and post images.
//
// Same private Cloudflare R2 bucket and credentials as the verification
// videos (videoStorage.ts), under a separate "social/" prefix. Objects are
// never public and never given a presigned URL: bytes leave only through
// readMedia(), which the authenticated media route calls after it has checked
// that the viewer may see the post or profile. Keys are generated here
// (never client-supplied), so there is no path-traversal or key-guessing
// surface.
//
// Local development only: if MEDIA_LOCAL_DIR is set AND NODE_ENV is
// "development", files go to that directory instead, so the feature can be
// run without R2 credentials. env.ts refuses to start with MEDIA_LOCAL_DIR set
// in any other mode, so this branch can never be active in production.

const KEY_PATTERN = /^social\/(posts|avatars)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const s3 = new S3Client({
  region: "auto",
  endpoint: env.R2_ENDPOINT,
  credentials: {
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  },
});

function localDir(): string | null {
  return env.NODE_ENV === "development" && env.MEDIA_LOCAL_DIR ? path.resolve(env.MEDIA_LOCAL_DIR) : null;
}

function assertKey(key: string): void {
  // Defence in depth: keys always come from our own rows, but a malformed one
  // must never reach the filesystem or the bucket.
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid media key.");
}

export type MediaKind = "posts" | "avatars";

export function newMediaKey(kind: MediaKind, ext: string): string {
  return `social/${kind}/${randomUUID()}.${ext}`;
}

export async function writeMedia(key: string, body: Buffer, contentType: string): Promise<void> {
  assertKey(key);
  try {
    const dir = localDir();
    if (dir) {
      const target = path.join(dir, key);
      await mkdir(path.dirname(target), { recursive: true });
      const { writeFile } = await import("node:fs/promises");
      await writeFile(target, body, { mode: 0o600 });
      return;
    }
    await s3.send(new PutObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key, Body: body, ContentType: contentType }));
  } catch (err) {
    console.error("Failed to store media:", err instanceof Error ? err.message : "unknown error");
    throw new AuthError("Something went wrong saving your image. Please try again.", 500);
  }
}

export async function readMedia(key: string): Promise<Buffer> {
  assertKey(key);
  const dir = localDir();
  if (dir) return readFile(path.join(dir, key));
  const result = await s3.send(new GetObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
  const bytes = await result.Body?.transformToByteArray();
  if (!bytes) throw new Error("Empty response body from storage.");
  return Buffer.from(bytes);
}

// Best-effort delete: a leftover object is never reachable (no row points at
// it), so a failure is logged but must not fail the user's request.
export async function deleteMedia(key: string): Promise<boolean> {
  try {
    assertKey(key);
    const dir = localDir();
    if (dir) {
      await rm(path.join(dir, key), { force: true });
      return true;
    }
    await s3.send(new DeleteObjectCommand({ Bucket: env.R2_BUCKET_NAME, Key: key }));
    return true;
  } catch {
    console.error("Failed to delete media object (it is unreferenced and unreachable).");
    return false;
  }
}
