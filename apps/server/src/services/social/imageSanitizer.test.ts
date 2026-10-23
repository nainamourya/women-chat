import { describe, expect, it, vi } from "vitest";

// auth.service (imported for AuthError) pulls in the database client; this file
// tests pure byte handling, so the client is replaced with an inert stub.
vi.mock("../../db/client.js", () => ({ db: {} }));

import { MAX_IMAGE_BYTES, sanitizeImage } from "./imageSanitizer.js";

// Builds small, structurally valid files that carry personal metadata. They are
// not renderable pictures; they are exactly as much as the sanitizer parses.
const GPS_MARKER = Buffer.from("GPS-LAT-12.97-LON-77.59");

function jpegWith(...segments: Array<{ marker: number; payload: Buffer }>): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
  const jfif = Buffer.concat([Buffer.from("JFIF\0"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])]);
  const all = [{ marker: 0xe0, payload: jfif }, ...segments];
  for (const { marker, payload } of all) {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(payload.length + 2);
    parts.push(Buffer.from([0xff, marker]), length, payload);
  }
  // Start of scan, then "image data" and the end marker.
  parts.push(Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]), Buffer.from("SCANDATA"), Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]); // CRC not checked
}

function pngWith(...extra: Array<[string, Buffer]>): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", Buffer.alloc(13)),
    ...extra.map(([type, data]) => pngChunk(type, data)),
    pngChunk("IDAT", Buffer.from("PIXELS")),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function webpChunk(fourcc: string, data: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(fourcc, 0, "ascii");
  header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data, data.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]);
}

function webpWith(withMetadata: boolean): Buffer {
  const flags = Buffer.alloc(10);
  flags[0] = withMetadata ? 0x08 | 0x04 : 0; // EXIF + XMP present
  const body = Buffer.concat([
    Buffer.from("WEBP", "ascii"),
    webpChunk("VP8X", flags),
    webpChunk("VP8 ", Buffer.from("BITSTREAM")),
    ...(withMetadata ? [webpChunk("EXIF", GPS_MARKER), webpChunk("XMP ", Buffer.from("<xmp>device</xmp>"))] : []),
  ]);
  const header = Buffer.alloc(8);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(body.length, 4);
  return Buffer.concat([header, body]);
}

const b64 = (buffer: Buffer) => buffer.toString("base64");

describe("sanitizeImage — metadata is removed server-side", () => {
  it("strips Exif (GPS), XMP and comments from a JPEG but keeps the picture and colour data", () => {
    const original = jpegWith(
      { marker: 0xe1, payload: Buffer.concat([Buffer.from("Exif\0\0"), GPS_MARKER]) },
      { marker: 0xe1, payload: Buffer.from("http://ns.adobe.com/xap/1.0/\0<xmp/>") },
      { marker: 0xfe, payload: Buffer.from("Shot on my phone") },
      { marker: 0xed, payload: Buffer.from("Photoshop 3.0 IPTC") },
      { marker: 0xe2, payload: Buffer.from("ICC_PROFILE\0colourdata") },
      { marker: 0xee, payload: Buffer.from("Adobe\0transform") },
    );
    const result = sanitizeImage(b64(original), "image/jpeg");

    expect(result.mimeType).toBe("image/jpeg");
    expect(result.buffer.includes(GPS_MARKER)).toBe(false);
    expect(result.buffer.includes(Buffer.from("Exif"))).toBe(false);
    expect(result.buffer.includes(Buffer.from("xap"))).toBe(false);
    expect(result.buffer.includes(Buffer.from("my phone"))).toBe(false);
    expect(result.buffer.includes(Buffer.from("IPTC"))).toBe(false);
    // Rendering-relevant data and the pixels survive.
    expect(result.buffer.includes(Buffer.from("JFIF"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("ICC_PROFILE"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("Adobe"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("SCANDATA"))).toBe(true);
    expect(result.buffer.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);
    expect(result.buffer.subarray(-2).equals(Buffer.from([0xff, 0xd9]))).toBe(true);
    expect(result.buffer.length).toBeLessThan(original.length);
  });

  it("strips text, Exif and time chunks from a PNG but keeps the image chunks", () => {
    const original = pngWith(["eXIf", GPS_MARKER], ["tEXt", Buffer.from("Comment\0at home")], ["tIME", Buffer.alloc(7)], ["iCCP", Buffer.from("profile")]);
    const result = sanitizeImage(b64(original), "image/png");

    expect(result.buffer.includes(GPS_MARKER)).toBe(false);
    expect(result.buffer.includes(Buffer.from("at home"))).toBe(false);
    expect(result.buffer.includes(Buffer.from("eXIf"))).toBe(false);
    expect(result.buffer.includes(Buffer.from("IHDR"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("PIXELS"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("iCCP"))).toBe(true);
    expect(result.buffer.includes(Buffer.from("IEND"))).toBe(true);
  });

  it("strips EXIF and XMP from a WebP, fixes the RIFF size and clears the VP8X flags", () => {
    const original = webpWith(true);
    const result = sanitizeImage(b64(original), "image/webp");

    expect(result.buffer.includes(GPS_MARKER)).toBe(false);
    expect(result.buffer.includes(Buffer.from("EXIF"))).toBe(false);
    expect(result.buffer.includes(Buffer.from("XMP "))).toBe(false);
    expect(result.buffer.includes(Buffer.from("BITSTREAM"))).toBe(true);
    expect(result.buffer.readUInt32LE(4)).toBe(result.buffer.length - 8);
    const vp8x = result.buffer.indexOf(Buffer.from("VP8X"));
    expect(result.buffer[vp8x + 8]! & (0x08 | 0x04)).toBe(0);
  });

  it("leaves an image that has no metadata functionally identical", () => {
    const clean = webpWith(false);
    expect(sanitizeImage(b64(clean), "image/webp").buffer.equals(clean)).toBe(true);
  });
});

describe("sanitizeImage — rejects bad input", () => {
  const goodJpeg = () => b64(jpegWith());

  it.each(["image/gif", "image/svg+xml", "text/html", "application/pdf", "", "image/JPEG"])("rejects declared type %j", (type) => {
    expect(() => sanitizeImage(goodJpeg(), type)).toThrow(/JPEG, PNG or WebP/);
  });

  it("rejects a file whose bytes do not match its declared type", () => {
    expect(() => sanitizeImage(b64(pngWith()), "image/jpeg")).toThrow(/doesn't match/);
    expect(() => sanitizeImage(goodJpeg(), "image/png")).toThrow(/doesn't match/);
  });

  it("rejects an HTML or SVG payload disguised with an image type", () => {
    expect(() => sanitizeImage(b64(Buffer.from("<svg onload=alert(1)></svg>")), "image/png")).toThrow(/doesn't match/);
    expect(() => sanitizeImage(b64(Buffer.from("<script>alert(1)</script>")), "image/jpeg")).toThrow(/doesn't match/);
  });

  it.each(["", "not base64!!", "abc", "ab==cd", "data:image/png;base64,", "%%%%"])("rejects malformed base64 %j", (value) => {
    expect(() => sanitizeImage(value, "image/jpeg")).toThrow();
  });

  it("accepts a data-URL prefix", () => {
    expect(() => sanitizeImage(`data:image/jpeg;base64,${goodJpeg()}`, "image/jpeg")).not.toThrow();
  });

  it("rejects images over the size limit, before and after decoding", () => {
    const big = Buffer.concat([jpegWith(), Buffer.alloc(MAX_IMAGE_BYTES + 10)]);
    expect(() => sanitizeImage(b64(big), "image/jpeg")).toThrow(/smaller/);
    expect(() => sanitizeImage("A".repeat(Math.ceil((MAX_IMAGE_BYTES * 4) / 3) + 500), "image/jpeg")).toThrow(/smaller/);
  });

  it("rejects truncated or corrupt structure instead of storing it", () => {
    const jpeg = jpegWith();
    expect(() => sanitizeImage(b64(jpeg.subarray(0, 12)), "image/jpeg")).toThrow(/valid JPEG/);
    const png = pngWith();
    expect(() => sanitizeImage(b64(png.subarray(0, png.length - 20)), "image/png")).toThrow(/valid PNG/);
    const webp = webpWith(true);
    expect(() => sanitizeImage(b64(webp.subarray(0, webp.length - 6)), "image/webp")).toThrow(/valid WebP/);
  });
});
