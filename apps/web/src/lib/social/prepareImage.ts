// Prepares a photo for upload in the browser: honours its orientation, scales
// it down and re-encodes it as JPEG. Besides keeping uploads small (the web
// host limits request size), re-encoding drops the camera's embedded location
// and device metadata. The server strips metadata again regardless — it never
// relies on this step.

export const MAX_INPUT_BYTES = 25 * 1024 * 1024;
const MAX_EDGE = 1600;
const QUALITY = 0.85;
const MAX_OUTPUT_BYTES = 3 * 1024 * 1024;

export type PreparedImage = { imageBase64: string; mimeType: "image/jpeg"; previewUrl: string; bytes: number };

export class ImageError extends Error {}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export async function prepareImage(file: File, maxEdge = MAX_EDGE): Promise<PreparedImage> {
  if (!/^image\/(jpeg|png|webp|heic|heif)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
    throw new ImageError("Choose a JPEG, PNG or WebP photo.");
  }
  if (file.size > MAX_INPUT_BYTES) throw new ImageError("That photo is too large. Choose one under 25 MB.");

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    throw new ImageError("That file couldn't be read as a photo.");
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new ImageError("Your browser can't prepare this photo.");
  // JPEG has no transparency: paint white first so transparent PNGs aren't black.
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", QUALITY));
  if (!blob) throw new ImageError("Your browser couldn't prepare this photo.");
  if (blob.size > MAX_OUTPUT_BYTES) throw new ImageError("That photo is still too large after resizing. Try a smaller one.");

  return {
    imageBase64: toBase64(await blob.arrayBuffer()),
    mimeType: "image/jpeg",
    previewUrl: URL.createObjectURL(blob),
    bytes: blob.size,
  };
}
