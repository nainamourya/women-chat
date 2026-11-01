import { randomUUID } from "node:crypto";
import { AuthError } from "../../../server/src/services/auth.service";
import { getRequestContext } from "../realtime/env";

// Build-time replacement for apps/server/src/services/social/mediaStorage.ts
// (see scripts/build.mjs): profile photos and post images in the private R2
// bucket under the "social/" prefix, via the Worker's R2 binding. Objects are
// never public and never get a presigned URL: bytes leave only through
// readMedia(), which the authenticated media route calls after it has checked
// that the viewer may see the post or profile. Keys are generated here, never
// client-supplied. (The local-disk development mode of the Express version has
// no equivalent: a Worker has no disk; local runs use the simulated R2 bucket.)

const KEY_PATTERN = /^social\/(posts|avatars)\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

const bucket = () => getRequestContext().env.PRIVATE_BUCKET;

function assertKey(key: string): void {
  // Defence in depth: keys always come from our own rows, but a malformed one
  // must never reach the bucket.
  if (!KEY_PATTERN.test(key)) throw new Error("Invalid media key.");
}

export type MediaKind = "posts" | "avatars";

export function newMediaKey(kind: MediaKind, ext: string): string {
  return `social/${kind}/${randomUUID()}.${ext}`;
}

export async function writeMedia(key: string, body: Buffer, contentType: string): Promise<void> {
  assertKey(key);
  try {
    await bucket().put(key, body, { httpMetadata: { contentType } });
  } catch (err) {
    console.error("Failed to store media:", err instanceof Error ? err.name : "unknown error");
    throw new AuthError("Something went wrong saving your image. Please try again.", 500);
  }
}

export async function readMedia(key: string): Promise<Buffer> {
  assertKey(key);
  const object = await bucket().get(key);
  if (!object) {
    // Same shape the Express version surfaces for a missing file; the media
    // route turns a read failure into a 404.
    const notFound = new Error("Media not found.") as NodeJS.ErrnoException;
    notFound.code = "ENOENT";
    throw notFound;
  }
  return Buffer.from(await object.arrayBuffer());
}

// Best-effort delete: a leftover object is never reachable (no row points at
// it), so a failure is logged but must not fail the user's request.
export async function deleteMedia(key: string): Promise<boolean> {
  try {
    assertKey(key);
    await bucket().delete(key);
    return true;
  } catch {
    console.error("Failed to delete media object (it is unreferenced and unreachable).");
    return false;
  }
}
