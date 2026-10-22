import { beforeEach, describe, it, expect, vi } from "vitest";

// Synthetic configuration: the real env module (and the database/Redis
// targets it validates) is not needed to test storage logic.
vi.mock("../config/env.js", () => ({
  env: {
    R2_ENDPOINT: "https://placeholder.r2.example",
    R2_BUCKET_NAME: "test-bucket",
    R2_ACCESS_KEY_ID: "test-access-key-id",
    R2_SECRET_ACCESS_KEY: "test-secret-access-key",
    VERIFICATION_VIDEO_MAX_BYTES: 25 * 1024 * 1024,
    VERIFICATION_VIDEO_MAX_DURATION_SECONDS: 15,
  },
}));
import { buildMp4Buffer, fakeMp4Base64, fakeWebmBase64 } from "../testUtils/fakeVideo.js";
import { saveVerificationVideo, readVerificationVideo, deleteVerificationVideo } from "./videoStorage.js";

// Mocks the R2 (S3-compatible) client with a small in-memory store, so these
// tests never make a real network call or need real credentials — see
// env.ts/.env, which only has placeholder R2 values for exactly this reason.
// vi.hoisted is required here (not a shared test-utils import) because
// vi.mock factories must be self-contained per file — this is a vitest
// hoisting constraint, not a design choice.
const { mockSend, resetMockR2, forceNextFailure } = vi.hoisted(() => {
  const store = new Map<string, Buffer>();
  let forced: { op: string; error: Error } | null = null;

  function notFoundError(name: "NoSuchKey" | "NotFound") {
    const err = new Error("not found") as Error & { name: string; $metadata: { httpStatusCode: number } };
    err.name = name;
    err.$metadata = { httpStatusCode: 404 };
    return err;
  }

  const mockSend = async (command: { constructor: { name: string }; input: Record<string, unknown> }) => {
    const ctor = command.constructor.name;
    const key = command.input.Key as string;

    if (forced && forced.op === ctor) {
      const err = forced.error;
      forced = null;
      throw err;
    }

    if (ctor === "PutObjectCommand") {
      store.set(key, Buffer.from(command.input.Body as Buffer));
      return {};
    }
    if (ctor === "GetObjectCommand") {
      const body = store.get(key);
      if (!body) throw notFoundError("NoSuchKey");
      return { Body: { transformToByteArray: async () => body } };
    }
    if (ctor === "DeleteObjectCommand") {
      store.delete(key); // idempotent, matching real S3/R2 DeleteObject semantics
      return {};
    }
    if (ctor === "HeadObjectCommand") {
      if (!store.has(key)) throw notFoundError("NotFound");
      return {};
    }
    throw new Error("unexpected command: " + ctor);
  };

  return {
    mockSend,
    resetMockR2: () => {
      store.clear();
      forced = null;
    },
    forceNextFailure: (op: string, error: Error) => {
      forced = { op, error };
    },
  };
});

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: class S3Client {
    send = mockSend;
  },
  PutObjectCommand: class PutObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  GetObjectCommand: class GetObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  DeleteObjectCommand: class DeleteObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
  HeadObjectCommand: class HeadObjectCommand {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
    }
  },
}));

beforeEach(() => {
  resetMockR2();
});

describe("saveVerificationVideo", () => {
  it("accepts a valid MP4 within the duration limit and can read it back", async () => {
    const expected = buildMp4Buffer(10);
    const key = await saveVerificationVideo(expected.toString("base64"), "video/mp4");
    const buffer = await readVerificationVideo(key);
    expect(buffer.length).toBe(expected.length);
    await deleteVerificationVideo(key);
  });

  it("accepts a valid WebM within the duration limit", async () => {
    const key = await saveVerificationVideo(fakeWebmBase64(10), "video/webm");
    await deleteVerificationVideo(key);
  });

  it("rejects an unsupported declared MIME type", async () => {
    await expect(saveVerificationVideo(fakeMp4Base64(), "video/avi")).rejects.toThrow(/MP4, WebM, or MOV/);
  });

  it("rejects content whose magic bytes don't match the declared type", async () => {
    const notAVideo = Buffer.from("just some text, not a video").toString("base64");
    await expect(saveVerificationVideo(notAVideo, "video/mp4")).rejects.toThrow(/does not match its declared type/);
  });

  it("rejects an empty upload", async () => {
    await expect(saveVerificationVideo("", "video/mp4")).rejects.toThrow(/non-empty/);
  });

  it("rejects an oversized upload before ever reaching R2", async () => {
    const oversized = Buffer.alloc(30 * 1024 * 1024);
    oversized.write("ftyp", 4, "ascii");
    await expect(saveVerificationVideo(oversized.toString("base64"), "video/mp4")).rejects.toThrow(/under/);
  });

  describe("duration enforcement (15-second limit)", () => {
    it("accepts a video at exactly the 15-second boundary", async () => {
      const key = await saveVerificationVideo(fakeMp4Base64(15), "video/mp4");
      await deleteVerificationVideo(key);
    });

    it("rejects an MP4 that exceeds 15 seconds", async () => {
      await expect(saveVerificationVideo(fakeMp4Base64(16), "video/mp4")).rejects.toThrow(/15 seconds or shorter/);
    });

    it("rejects a WebM that exceeds 15 seconds", async () => {
      await expect(saveVerificationVideo(fakeWebmBase64(16), "video/webm")).rejects.toThrow(/15 seconds or shorter/);
    });

    it("rejects malformed media whose duration cannot be determined", async () => {
      const bareMagicBytes = Buffer.alloc(32);
      bareMagicBytes.write("ftyp", 4, "ascii");
      await expect(saveVerificationVideo(bareMagicBytes.toString("base64"), "video/mp4")).rejects.toThrow(
        /duration could not be verified/,
      );
    });
  });

  describe("R2 failure handling", () => {
    it("rejects with a generic error when the upload call fails (e.g. auth/network)", async () => {
      forceNextFailure("PutObjectCommand", new Error("simulated R2 outage"));
      await expect(saveVerificationVideo(fakeMp4Base64(), "video/mp4")).rejects.toThrow(
        /Something went wrong uploading/,
      );
    });
  });
});

describe("readVerificationVideo", () => {
  it("throws an ENOENT-coded error for a key that was never uploaded", async () => {
    await expect(readVerificationVideo("never-existed.mp4")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("propagates a real error (not ENOENT) when the read call fails for another reason", async () => {
    forceNextFailure("GetObjectCommand", new Error("simulated auth failure"));
    const err = await readVerificationVideo("whatever.mp4").catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as NodeJS.ErrnoException).code).not.toBe("ENOENT");
  });
});

describe("deleteVerificationVideo", () => {
  it("verifies the object is actually gone, and is idempotent", async () => {
    const key = await saveVerificationVideo(fakeMp4Base64(), "video/mp4");
    expect(await deleteVerificationVideo(key)).toBe(true);
    expect(await deleteVerificationVideo(key)).toBe(true);
    await expect(readVerificationVideo(key)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports success for a storage key that never existed", async () => {
    expect(await deleteVerificationVideo("never-existed.mp4")).toBe(true);
  });

  it("returns false (not true, and does not throw) when the delete call itself fails", async () => {
    const key = await saveVerificationVideo(fakeMp4Base64(), "video/mp4");
    forceNextFailure("DeleteObjectCommand", new Error("simulated R2 outage"));
    expect(await deleteVerificationVideo(key)).toBe(false);
  });

  it("returns false — never true — when deletion succeeds but the existence check fails (must not report success during an outage)", async () => {
    const key = await saveVerificationVideo(fakeMp4Base64(), "video/mp4");
    forceNextFailure("HeadObjectCommand", new Error("simulated auth failure confirming deletion"));
    expect(await deleteVerificationVideo(key)).toBe(false);
  });
});
