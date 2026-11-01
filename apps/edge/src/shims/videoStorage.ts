import { AuthError } from "../../../server/src/services/auth.service";
import { getRequestContext } from "../realtime/env";

// Build-time replacement for apps/server/src/services/videoStorage.ts (see
// scripts/build.mjs): the same three functions over the Worker's R2 binding
// instead of the S3 SDK. The bucket is the same private bucket (objects at the
// root, as before, so existing videos stay readable). Bytes leave this module
// only through readVerificationVideo(), which the admin review route calls
// after it has re-verified the caller's role. Keys are server-generated.

const bucket = () => getRequestContext().env.PRIVATE_BUCKET;

/**
 * The Express server accepted the whole video as a base64 string inside a JSON
 * body (~33 MB for 25 MB of video). A Worker has 128 MB of memory and that path
 * holds the body, the string, the parsed copy and the decoded bytes at once, so
 * it is not safe here. Uploads on the Worker stream straight into R2 instead
 * (src/verificationUpload.ts), so this function must never be reached.
 */
export async function saveVerificationVideo(_base64Data: string, _declaredMimeType: string): Promise<string> {
  throw new AuthError("Base64 video uploads are not supported on the edge backend. Use the streaming upload.", 501);
}

export async function readVerificationVideo(storageKey: string): Promise<Buffer> {
  // `storageKey` always comes from a submission row, never client input.
  let object: R2ObjectBody | null;
  try {
    object = await bucket().get(storageKey);
  } catch (err) {
    console.error("Failed to read verification video:", err instanceof Error ? err.name : "unknown error");
    throw err;
  }
  if (!object) {
    // Preserves the ENOENT contract the admin route already checks for.
    const notFound = new Error("Video not found.") as NodeJS.ErrnoException;
    notFound.code = "ENOENT";
    throw notFound;
  }
  return Buffer.from(await object.arrayBuffer());
}

/**
 * Deletes the video and verifies it is actually gone before returning true —
 * callers must not finalize an approval unless this returns true. Idempotent for
 * a missing key. Any storage failure, on the delete or on the confirmation, is a
 * failure, never a success: an outage must not be reported as a deletion.
 */
export async function deleteVerificationVideo(storageKey: string): Promise<boolean> {
  try {
    await bucket().delete(storageKey);
  } catch {
    console.error("Failed to delete verification video (will retry): video deletion error");
    return false;
  }

  try {
    const stillThere = await bucket().head(storageKey);
    // Still exists somehow (e.g. a concurrent write race) — do not report success.
    return stillThere === null;
  } catch {
    console.error("Failed to verify verification video deletion: confirmation error");
    return false;
  }
}
