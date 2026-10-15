// Builds minimal, genuinely parseable MP4 and WebM buffers with real
// embedded duration metadata — not just magic bytes at the right offset.
// Needed because videoStorage.ts's server-side duration check uses a real
// media parser (music-metadata), which requires an actually-valid container
// (a real `moov`/`mvhd` box for MP4, a real `Segment`/`Info`/`Duration` for
// WebM) to report a duration; a bare magic-byte fixture parses with
// `duration: undefined` and is correctly rejected as unverifiable.

function box(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + body.length, 0);
  header.write(type, 4, "ascii");
  return Buffer.concat([header, body]);
}

function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n, 0);
  return b;
}

function buildMvhd(durationSeconds: number, timescale = 1000): Buffer {
  const duration = Math.round(durationSeconds * timescale);
  const body = Buffer.concat([
    Buffer.from([0, 0, 0, 0]), // version(1) + flags(3)
    u32(0), // creation_time
    u32(0), // modification_time
    u32(timescale),
    u32(duration),
    u32(0x00010000), // rate 1.0
    u16(0x0100), // volume 1.0
    u16(0), // reserved
    u32(0),
    u32(0), // reserved x2
    // matrix: identity
    u32(0x00010000),
    u32(0),
    u32(0),
    u32(0),
    u32(0x00010000),
    u32(0),
    u32(0),
    u32(0),
    u32(0x40000000),
    // pre_defined x6
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(0),
    u32(2), // next_track_ID
  ]);
  return box("mvhd", body);
}

/** A minimal but genuinely valid MP4 (ftyp + moov/mvhd) with a real duration. */
export function buildMp4Buffer(durationSeconds: number): Buffer {
  const ftyp = box("ftyp", Buffer.concat([Buffer.from("isom"), u32(0), Buffer.from("isom")]));
  const moov = box("moov", buildMvhd(durationSeconds));
  return Buffer.concat([ftyp, moov]);
}

export function fakeMp4Base64(durationSeconds = 10): string {
  return buildMp4Buffer(durationSeconds).toString("base64");
}

function vintSize(value: number): Buffer {
  for (let n = 1; n <= 8; n++) {
    const maxVal = Math.pow(2, 7 * n) - 2;
    if (value <= maxVal) {
      const bytes = Buffer.alloc(n);
      let v = BigInt(value);
      for (let i = n - 1; i >= 0; i--) {
        bytes[i] = Number(v & 0xffn);
        v >>= 8n;
      }
      bytes[0] |= 1 << (8 - n);
      return bytes;
    }
  }
  throw new Error("value too large for EBML vint");
}

function ebmlElement(idHex: string, content: Buffer): Buffer {
  return Buffer.concat([Buffer.from(idHex, "hex"), vintSize(content.length), content]);
}

/** A minimal but genuinely valid WebM (EBML header + Segment/Info/Duration) with a real duration. */
export function buildWebmBuffer(durationSeconds: number): Buffer {
  const timecodeScaleNs = 1_000_000; // 1ms per tick — the conventional WebM default
  const durationTicks = (durationSeconds * 1e9) / timecodeScaleNs;

  const docType = ebmlElement("4282", Buffer.from("webm", "ascii"));
  const ebmlHeader = ebmlElement("1a45dfa3", docType);

  const timecodeScaleBuf = Buffer.alloc(4);
  timecodeScaleBuf.writeUInt32BE(timecodeScaleNs, 0);
  const timecodeScaleEl = ebmlElement("2ad7b1", timecodeScaleBuf);

  const durationBuf = Buffer.alloc(8);
  durationBuf.writeDoubleBE(durationTicks, 0);
  const durationEl = ebmlElement("4489", durationBuf);

  const info = ebmlElement("1549a966", Buffer.concat([timecodeScaleEl, durationEl]));
  const segment = ebmlElement("18538067", info);

  return Buffer.concat([ebmlHeader, segment]);
}

export function fakeWebmBase64(durationSeconds = 10): string {
  return buildWebmBuffer(durationSeconds).toString("base64");
}
