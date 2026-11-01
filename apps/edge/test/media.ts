// Minimal, structurally valid image fixtures (not renderable pictures: exactly
// what the server-side sanitizer and signature checks parse). Copied from
// apps/server/src/testUtils/socialFixtures.ts, which cannot be imported here
// because it pulls in the server's database client.

export const GPS_MARKER = "GPS-LAT-12.97-LON-77.59";

export function fakeJpeg({ withExif = true, extra = "" }: { withExif?: boolean; extra?: string } = {}): Buffer {
  const segment = (marker: number, payload: Buffer) => {
    const length = Buffer.alloc(2);
    length.writeUInt16BE(payload.length + 2);
    return Buffer.concat([Buffer.from([0xff, marker]), length, payload]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.concat([Buffer.from("JFIF\0"), Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0])])),
    ...(withExif ? [segment(0xe1, Buffer.from(`Exif\0\0${GPS_MARKER}`))] : []),
    Buffer.from([0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00]),
    Buffer.from(`SCAN${extra}`),
    Buffer.from([0xff, 0xd9]),
  ]);
}

export function fakePng(): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, "ascii"), data, Buffer.alloc(4)]);
  };
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", Buffer.alloc(13)),
    chunk("IDAT", Buffer.from("PIXELS")),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export const imagePayload = (buffer: Buffer, mimeType = "image/jpeg") => ({
  imageBase64: buffer.toString("base64"),
  mimeType,
});
