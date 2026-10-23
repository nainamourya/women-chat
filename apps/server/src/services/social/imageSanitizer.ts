import { AuthError } from "../auth.service.js";

// Validation and metadata stripping for user-uploaded images (profile photos
// and posts). Nothing here trusts the client: the declared MIME type must
// match the file's real signature, the size is checked on the decoded bytes,
// and the file is rewritten without its embedded metadata.
//
// Why strip metadata: photos taken on phones routinely carry GPS coordinates,
// device details and timestamps in EXIF/XMP. On a platform for women's safety
// that is a real exposure, so it is removed server-side regardless of what the
// browser did before upload.
//
// This does NOT re-encode pixels (no image library is installed), so it cannot
// catch a file that is valid-looking but malformed inside the pixel data; the
// media route serves it only as an inert image type with `nosniff`.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export type SanitizedImage = { buffer: Buffer; mimeType: "image/jpeg" | "image/png" | "image/webp"; ext: "jpg" | "png" | "webp" };

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

function decodeBase64(data: string): Buffer {
  // Accept a data URL prefix, but nothing else that isn't base64.
  const payload = data.replace(/^data:[^;,]+;base64,/, "");
  if (payload.length === 0 || payload.length % 4 !== 0 || !BASE64_PATTERN.test(payload)) {
    throw new AuthError("The image could not be read.", 400);
  }
  return Buffer.from(payload, "base64");
}

// --- JPEG: drop the segments that carry personal metadata (APP1 Exif/XMP, APP3-APP13
// vendor/IPTC blocks, APP15, comments) but keep what affects how the image renders:
// APP0 (JFIF), APP2 (ICC colour profile) and APP14 (Adobe colour transform).
function stripJpeg(input: Buffer): Buffer {
  if (input[0] !== 0xff || input[1] !== 0xd8) throw new AuthError("The image isn't a valid JPEG.", 400);
  const parts: Buffer[] = [input.subarray(0, 2)];
  let offset = 2;
  while (offset < input.length) {
    if (input[offset] !== 0xff) throw new AuthError("The image isn't a valid JPEG.", 400);
    // Skip fill bytes.
    while (input[offset] === 0xff && offset < input.length) offset++;
    const marker = input[offset];
    offset++;
    if (marker === undefined) throw new AuthError("The image isn't a valid JPEG.", 400);

    // Standalone markers (no length): TEM, RSTn, SOI/EOI.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9)) {
      parts.push(Buffer.from([0xff, marker]));
      if (marker === 0xd9) return Buffer.concat(parts);
      continue;
    }
    if (offset + 2 > input.length) throw new AuthError("The image isn't a valid JPEG.", 400);
    const length = input.readUInt16BE(offset);
    if (length < 2 || offset + length > input.length) throw new AuthError("The image isn't a valid JPEG.", 400);
    const segmentEnd = offset + length;

    if (marker === 0xda) {
      // Start of scan: the entropy-coded data runs to the end of the file (EOI
      // included); copy it unchanged.
      parts.push(input.subarray(offset - 2, input.length));
      return Buffer.concat(parts);
    }

    const isMetadata = marker === 0xe1 || (marker >= 0xe3 && marker <= 0xed) || marker === 0xef || marker === 0xfe;
    if (!isMetadata) parts.push(input.subarray(offset - 2, segmentEnd));
    offset = segmentEnd;
  }
  throw new AuthError("The image isn't a valid JPEG.", 400);
}

// --- PNG: drop the ancillary chunks that carry text/EXIF/time metadata.
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// iCCP (colour profile) is kept: it changes how colours render and carries no personal data.
const PNG_DROP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

function stripPng(input: Buffer): Buffer {
  if (!input.subarray(0, 8).equals(PNG_SIGNATURE)) throw new AuthError("The image isn't a valid PNG.", 400);
  const parts: Buffer[] = [input.subarray(0, 8)];
  let offset = 8;
  let sawEnd = false;
  while (offset + 12 <= input.length) {
    const length = input.readUInt32BE(offset);
    const type = input.toString("ascii", offset + 4, offset + 8);
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > input.length) throw new AuthError("The image isn't a valid PNG.", 400);
    if (!PNG_DROP.has(type)) parts.push(input.subarray(offset, chunkEnd));
    offset = chunkEnd;
    if (type === "IEND") {
      sawEnd = true;
      break;
    }
  }
  if (!sawEnd) throw new AuthError("The image isn't a valid PNG.", 400);
  return Buffer.concat(parts);
}

// --- WebP: drop the EXIF and XMP chunks and clear their flags in VP8X.
function stripWebp(input: Buffer): Buffer {
  if (input.toString("ascii", 0, 4) !== "RIFF" || input.toString("ascii", 8, 12) !== "WEBP") {
    throw new AuthError("The image isn't a valid WebP.", 400);
  }
  const riffEnd = Math.min(input.length, 8 + input.readUInt32LE(4));
  const chunks: Buffer[] = [];
  let offset = 12;
  while (offset + 8 <= riffEnd) {
    const fourcc = input.toString("ascii", offset, offset + 4);
    const size = input.readUInt32LE(offset + 4);
    const padded = size + (size % 2);
    const end = offset + 8 + padded;
    if (end > riffEnd) throw new AuthError("The image isn't a valid WebP.", 400);
    if (fourcc !== "EXIF" && fourcc !== "XMP ") {
      const chunk = Buffer.from(input.subarray(offset, end));
      if (fourcc === "VP8X" && size >= 1) chunk[8] = (chunk[8] ?? 0) & ~(0x08 | 0x04); // EXIF + XMP flags
      chunks.push(chunk);
    }
    offset = end;
  }
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(4 + body.length, 4);
  header.write("WEBP", 8, "ascii");
  return Buffer.concat([header, body]);
}

const DECLARED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function detect(buffer: Buffer): SanitizedImage["mimeType"] | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length > 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return "image/png";
  if (buffer.length > 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

export function sanitizeImage(base64: string, declaredMimeType: string, maxBytes = MAX_IMAGE_BYTES): SanitizedImage {
  if (!DECLARED_TYPES.has(declaredMimeType)) {
    throw new AuthError("Only JPEG, PNG or WebP images are supported.", 400);
  }
  // Cheap upper bound before decoding: base64 is ~4/3 the size of the bytes.
  if (base64.length > Math.ceil((maxBytes * 4) / 3) + 128) {
    throw new AuthError(`Images must be ${Math.floor(maxBytes / (1024 * 1024))}MB or smaller.`, 413);
  }
  const decoded = decodeBase64(base64);
  if (decoded.length === 0 || decoded.length > maxBytes) {
    throw new AuthError(`Images must be ${Math.floor(maxBytes / (1024 * 1024))}MB or smaller.`, 413);
  }

  const detected = detect(decoded);
  if (!detected || detected !== declaredMimeType) {
    throw new AuthError("The file doesn't match its image type.", 400);
  }

  if (detected === "image/jpeg") return { buffer: stripJpeg(decoded), mimeType: detected, ext: "jpg" };
  if (detected === "image/png") return { buffer: stripPng(decoded), mimeType: detected, ext: "png" };
  return { buffer: stripWebp(decoded), mimeType: detected, ext: "webp" };
}
