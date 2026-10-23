import { randomUUID } from "node:crypto";
import { db } from "../db/client.js";
import { users, type User } from "../db/schema.js";

// Test helpers shared by the social integration tests. Everything created here
// is tracked so a test file can remove it (users cascade to all social data).

export const GPS_MARKER = "GPS-LAT-12.97-LON-77.59";

// A structurally valid JPEG (JFIF + optional Exif block + scan + EOI). Not a
// renderable picture — exactly what the server-side sanitizer parses.
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

export const imagePayload = (buffer: Buffer, mimeType = "image/jpeg") => ({ imageBase64: buffer.toString("base64"), mimeType });

export type MemberOptions = {
  username?: string | null;
  verified?: boolean;
  accountStatus?: User["accountStatus"];
  displayName?: string;
};

export async function createMember(created: string[], options: MemberOptions = {}): Promise<User> {
  const username = options.username === undefined ? `u_${randomUUID().replace(/-/g, "").slice(0, 10)}` : options.username;
  const [user] = await db
    .insert(users)
    .values({
      email: `social-${randomUUID()}@example.com`,
      passwordHash: "test-hash-not-used",
      displayName: options.displayName ?? "Test Member",
      ageConfirmed18: true,
      verificationStatus: options.verified === false ? "unverified" : "verified",
      accountStatus: options.accountStatus ?? "active",
      username,
    })
    .returning();
  created.push(user!.id);
  return user!;
}
