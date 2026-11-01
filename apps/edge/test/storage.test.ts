import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildMp4Buffer, buildWebmBuffer } from "../../server/src/testUtils/fakeVideo";
import { DEFAULT_TEST_VARS, TEST_INTERNAL_SECRET, startLocalWorker, type RunningWorker } from "./localWorker";
import { fakeJpeg, fakePng } from "./media";
import { Fixtures } from "./seed";

// R2 storage behavior of the Worker: the streaming verification-video upload,
// admin review/deletion of those videos, and report evidence. The bucket is
// wrangler's local simulation; nothing here touches a real bucket.
const SECRET = { "x-internal-api-secret": TEST_INTERNAL_SECRET };
const JSON_HEADERS = { ...SECRET, "content-type": "application/json" };
const MAX_BYTES = 5_000; // lowered for the test Worker so "oversized" is cheap to send

let worker: RunningWorker;
let fx: Fixtures;

beforeAll(async () => {
  fx = new Fixtures();
  worker = await startLocalWorker(8840, {
    testHooks: true,
    vars: { ...DEFAULT_TEST_VARS, VERIFICATION_VIDEO_MAX_BYTES: String(MAX_BYTES) },
  });
});
afterAll(async () => {
  worker?.stop();
  await fx?.cleanup();
});

async function json(method: string, path: string, body?: unknown, headers: Record<string, string> = JSON_HEADERS) {
  const res = await fetch(`${worker.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any, headers: res.headers };
}

async function upload(
  userId: string,
  body: Buffer | ReadableStream | null,
  opts: { contentType?: string; ack?: boolean; secret?: boolean } = {},
) {
  const headers: Record<string, string> = {
    ...(opts.secret === false ? {} : SECRET),
    "content-type": opts.contentType ?? "video/mp4",
    "x-acknowledged-notice": opts.ack === false ? "false" : "true",
  };
  const init: RequestInit & { duplex?: string } = { method: "PUT", headers, body: body as any };
  if (body instanceof ReadableStream) init.duplex = "half";
  const res = await fetch(`${worker.baseUrl}/api/verification/video/${userId}`, init);
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any, headers: res.headers };
}

const objects = async (prefix = "") =>
  ((await json("GET", `/__test__/r2/list?prefix=${encodeURIComponent(prefix)}`, undefined, SECRET)).body.objects as Array<{ key: string; size: number }>);
const videoKeys = async () => (await objects()).map((o) => o.key).filter((k) => /^[0-9a-f-]{36}\.(mp4|webm|mov)$/.test(k));
const getObject = async (key: string) => json("GET", `/__test__/r2/get?key=${encodeURIComponent(key)}`, undefined, SECRET);

describe("verification video upload (streamed into R2)", () => {
  it("stores a valid MP4 in R2, creates a pending submission, and never exposes the storage key", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(10);
    const before = await videoKeys();

    const res = await upload(member.id, video);
    expect(res.status).toBe(201);
    expect(res.body.submission).toMatchObject({ userId: member.id, status: "pending_review" });
    expect(res.body.submission).not.toHaveProperty("videoStorageKey");

    const after = await videoKeys();
    const added = after.filter((k) => !before.includes(k));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/\.mp4$/);
    const stored = await getObject(added[0]);
    expect(stored.body.contentType).toBe("video/mp4");
    expect(Buffer.from(stored.body.base64, "base64").equals(video)).toBe(true);

    const status = await json("GET", `/api/verification/video/status/${member.id}`, undefined, SECRET);
    expect(status.body.submission).toMatchObject({ id: res.body.submission.id, status: "pending_review" });
    expect(status.body.submission).not.toHaveProperty("videoStorageKey");
    expect((await json("GET", `/api/profile/${member.id}`, undefined, SECRET)).body.profile.verificationStatus).toBe("pending");
  });

  it("accepts WebM and a duration that rounds to the limit, rejects one that rounds past it", async () => {
    const a = await fx.member({ verificationStatus: "unverified" });
    expect((await upload(a.id, buildWebmBuffer(8), { contentType: "video/webm" })).status).toBe(201);
    const b = await fx.member({ verificationStatus: "unverified" });
    expect((await upload(b.id, buildMp4Buffer(15.3))).status).toBe(201); // rounds to 15
    const c = await fx.member({ verificationStatus: "unverified" });
    const tooLong = await upload(c.id, buildMp4Buffer(15.6)); // rounds to 16
    expect(tooLong.status).toBe(400);
    expect(tooLong.body).toEqual({ error: "Video must be 15 seconds or shorter." });
  });

  it("requires the internal secret and a valid user id", async () => {
    const member = await fx.member();
    const before = (await videoKeys()).length;
    const noSecret = await upload(member.id, buildMp4Buffer(5), { secret: false });
    expect(noSecret.status).toBe(401);
    expect(noSecret.body).toEqual({ error: "Unauthorized." });
    const badId = await upload("not-a-uuid", buildMp4Buffer(5));
    expect(badId.status).toBe(400);
    expect(badId.body).toEqual({ error: "Invalid user id." });
    expect((await videoKeys()).length).toBe(before);
  });

  it("an unknown user, or one who has not acknowledged the notice, stores nothing", async () => {
    const before = (await videoKeys()).length;
    const unknown = await upload(crypto.randomUUID(), buildMp4Buffer(5));
    expect(unknown.status).toBe(404);
    expect(unknown.body).toEqual({ error: "User not found." });
    const member = await fx.member();
    const noAck = await upload(member.id, buildMp4Buffer(5), { ack: false });
    expect(noAck.status).toBe(400);
    expect(noAck.body).toEqual({ error: "You must acknowledge the verification and privacy notice before uploading." });
    expect((await videoKeys()).length).toBe(before);
  });

  it("rejects a disallowed content type before reading the body", async () => {
    const member = await fx.member();
    for (const contentType of ["video/x-flv", "application/octet-stream", "image/png", "text/plain", ""]) {
      const res = await upload(member.id, buildMp4Buffer(5), { contentType });
      expect(res.status, contentType).toBe(400);
      expect(res.body).toEqual({ error: "Video must be MP4, WebM, or MOV." });
    }
  });

  it("rejects an oversized upload from its declared length, storing nothing", async () => {
    const member = await fx.member();
    const before = (await videoKeys()).length;
    const res = await upload(member.id, Buffer.alloc(MAX_BYTES + 1, 0x41));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Video must be non-empty and under 0MB." });
    expect((await videoKeys()).length).toBe(before);
  });

  it("rejects an empty upload and an upload with no Content-Length (chunked)", async () => {
    const member = await fx.member();
    const empty = await upload(member.id, Buffer.alloc(0));
    expect(empty.status).toBe(400);
    const video = buildMp4Buffer(5);
    const chunked = await upload(
      member.id,
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(video));
          controller.close();
        },
      }),
    );
    expect(chunked.status).toBe(411);
    expect(chunked.body).toEqual({ error: "Content-Length is required." });
    expect((await json("GET", `/api/verification/video/status/${member.id}`, undefined, SECRET)).body.submission).toBeNull();
  });

  it("rejects content that does not match its declared type, and removes what it stored", async () => {
    const member = await fx.member();
    const before = (await videoKeys()).length;
    const png = await upload(member.id, fakePng()); // declared video/mp4, actually a PNG
    expect(png.status).toBe(400);
    expect(png.body).toEqual({ error: "Video file content does not match its declared type." });
    const webmAsMp4 = await upload(member.id, buildWebmBuffer(5));
    expect(webmAsMp4.status).toBe(400);
    expect((await videoKeys()).length).toBe(before); // nothing orphaned in R2
    expect((await json("GET", `/api/verification/video/status/${member.id}`, undefined, SECRET)).body.submission).toBeNull();
  });

  it("fails closed when the duration cannot be read (magic bytes alone are not enough)", async () => {
    const member = await fx.member();
    const before = (await videoKeys()).length;
    const onlyHeader = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from("ftypisom"), Buffer.alloc(8)]);
    const res = await upload(member.id, onlyHeader);
    expect(res.status).toBe(400);
    expect(["Video duration could not be verified.", "Video file could not be read — it may be corrupted or in an unsupported format."]).toContain(res.body.error);
    expect((await videoKeys()).length).toBe(before);
  });

  it("a second submission while one is pending is refused (409) and stores nothing", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    expect((await upload(member.id, buildMp4Buffer(5))).status).toBe(201);
    const before = (await videoKeys()).length;
    const again = await upload(member.id, buildMp4Buffer(6));
    expect(again.status).toBe(409);
    expect(again.body).toEqual({ error: "You already have a submission awaiting review." });
    expect((await videoKeys()).length).toBe(before);
  });

  it("two simultaneous submissions: exactly one wins, and no orphan is left", async () => {
    const member = await fx.member({ verificationStatus: "unverified" });
    const before = (await videoKeys()).length;
    const results = await Promise.all([upload(member.id, buildMp4Buffer(5)), upload(member.id, buildMp4Buffer(6))]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await videoKeys()).length).toBe(before + 1);
  });

  it("is limited to 5 uploads per hour per user (429 with Retry-After)", async () => {
    const member = await fx.member();
    for (let i = 0; i < 5; i++) await upload(member.id, buildMp4Buffer(5), { ack: false }); // each attempt counts
    const limited = await upload(member.id, buildMp4Buffer(5), { ack: false });
    expect(limited.status).toBe(429);
    expect(limited.body).toEqual({ error: "Too many attempts. Please try again later." });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
  });

  it("the old base64-in-JSON upload is refused (501) after the secret check and stores nothing", async () => {
    const member = await fx.member();
    const before = (await videoKeys()).length;
    const body = { userId: member.id, videoBase64: buildMp4Buffer(5).toString("base64"), mimeType: "video/mp4", acknowledgedNotice: true };
    const noSecret = await json("POST", "/api/verification/video", body, { "content-type": "application/json" });
    expect(noSecret.status).toBe(401);
    const res = await json("POST", "/api/verification/video", body);
    expect(res.status).toBe(501);
    expect(res.body.error).toContain("PUT /api/verification/video/:userId");
    expect((await videoKeys()).length).toBe(before);
  });
});

describe("admin review of verification videos (private R2 access and deletion)", () => {
  async function pendingSubmission() {
    const member = await fx.member({ verificationStatus: "unverified" });
    const video = buildMp4Buffer(9);
    const res = await upload(member.id, video);
    expect(res.status).toBe(201);
    return { member, video, submissionId: res.body.submission.id as string };
  }

  it("lists submissions for an admin only", async () => {
    const admin = await fx.member({ role: "admin" });
    const { member, submissionId } = await pendingSubmission();
    const listed = await json("GET", `/api/admin/verification?adminUserId=${admin.id}&status=pending_review`, undefined, SECRET);
    expect(listed.status).toBe(200);
    const mine = listed.body.submissions.find((s: any) => s.id === submissionId);
    expect(mine).toMatchObject({ userId: member.id, status: "pending_review" });
    expect(mine).not.toHaveProperty("videoStorageKey");

    const refused = await json("GET", `/api/admin/verification?adminUserId=${member.id}`, undefined, SECRET);
    expect(refused.status).toBe(403);
    expect((await json("GET", `/api/admin/verification?adminUserId=${admin.id}`, undefined, { "content-type": "application/json" })).status).toBe(401);
  });

  it("serves the video bytes to an admin only, never cacheable", async () => {
    const admin = await fx.member({ role: "admin" });
    const { member, video, submissionId } = await pendingSubmission();

    const res = await fetch(`${worker.baseUrl}/api/admin/verification/${submissionId}/video?adminUserId=${admin.id}`, { headers: SECRET });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(video)).toBe(true);

    const asMember = await fetch(`${worker.baseUrl}/api/admin/verification/${submissionId}/video?adminUserId=${member.id}`, { headers: SECRET });
    expect(asMember.status).toBe(403);
    const unknown = await fetch(`${worker.baseUrl}/api/admin/verification/${crypto.randomUUID()}/video?adminUserId=${admin.id}`, { headers: SECRET });
    expect(unknown.status).toBe(404);
  });

  it("approving deletes the video from R2 and verifies the member", async () => {
    const admin = await fx.member({ role: "admin" });
    const { member, submissionId } = await pendingSubmission();
    const keysBefore = await videoKeys();

    const res = await json("PATCH", `/api/admin/verification/${submissionId}`, { adminUserId: admin.id, decision: "approved" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ finalized: true, deletionPending: false });
    expect((await videoKeys()).length).toBe(keysBefore.length - 1); // the video is really gone
    expect((await json("GET", `/api/profile/${member.id}`, undefined, SECRET)).body.profile.verificationStatus).toBe("verified");

    const after = await fetch(`${worker.baseUrl}/api/admin/verification/${submissionId}/video?adminUserId=${admin.id}`, { headers: SECRET });
    expect(after.status).toBe(404);
    expect(await after.json()).toEqual({ error: "This video has already been deleted." });

    const again = await json("PATCH", `/api/admin/verification/${submissionId}`, { adminUserId: admin.id, decision: "approved" });
    expect(again.status).toBe(409);
  });

  it("rejecting needs a reason, deletes the video, and leaves the member unverified", async () => {
    const admin = await fx.member({ role: "admin" });
    const { member, submissionId } = await pendingSubmission();
    const keysBefore = await videoKeys();

    const missing = await json("PATCH", `/api/admin/verification/${submissionId}`, { adminUserId: admin.id, decision: "rejected" });
    expect(missing.status).toBe(400);
    expect((await videoKeys()).length).toBe(keysBefore.length); // refused before touching storage

    const res = await json("PATCH", `/api/admin/verification/${submissionId}`, {
      adminUserId: admin.id,
      decision: "rejected",
      rejectionReason: "video_unclear_or_incomplete",
    });
    expect(res.status).toBe(200);
    expect((await videoKeys()).length).toBe(keysBefore.length - 1);
    expect((await json("GET", `/api/profile/${member.id}`, undefined, SECRET)).body.profile.verificationStatus).toBe("rejected");
  });

  it("only an admin may decide, and retrying a finished deletion is a safe no-op", async () => {
    const admin = await fx.member({ role: "admin" });
    const { member, submissionId } = await pendingSubmission();
    const refused = await json("PATCH", `/api/admin/verification/${submissionId}`, { adminUserId: member.id, decision: "approved" });
    expect(refused.status).toBe(403);
    expect((await videoKeys()).length).toBeGreaterThan(0);

    await json("PATCH", `/api/admin/verification/${submissionId}`, { adminUserId: admin.id, decision: "approved" });
    const retry = await json("POST", `/api/admin/verification/${submissionId}/retry-deletion`, { adminUserId: admin.id });
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ finalized: true, deletionPending: false });
  });
});

describe("report evidence (R2, private)", () => {
  const reportBody = (reporterUserId: string, reportedUserId: string, extra: Record<string, unknown> = {}) => ({
    reporterUserId,
    reportedUserId,
    reason: "harassment",
    description: "test",
    ...extra,
  });
  const evidenceKeys = async () => (await objects("reports/evidence/")).map((o) => o.key);

  it("stores an image under reports/evidence/ and serves it back to an admin only", async () => {
    const reporter = await fx.member();
    const reported = await fx.member();
    const admin = await fx.member({ role: "admin" });
    const png = fakePng();
    const before = await evidenceKeys();

    const created = await json("POST", "/api/reports", reportBody(reporter.id, reported.id, { evidenceBase64: png.toString("base64"), evidenceMimeType: "image/png" }));
    expect(created.status).toBe(201);
    const reportId = created.body.report.id as string;

    const added = (await evidenceKeys()).filter((k) => !before.includes(k));
    expect(added).toHaveLength(1);
    expect(added[0]).toMatch(/^reports\/evidence\/[0-9a-f-]{36}\.png$/);
    expect((await getObject(added[0])).body.contentType).toBe("image/png");

    const res = await fetch(`${worker.baseUrl}/api/reports/${reportId}/evidence?adminUserId=${admin.id}`, { headers: SECRET });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true);

    const asReporter = await fetch(`${worker.baseUrl}/api/reports/${reportId}/evidence?adminUserId=${reporter.id}`, { headers: SECRET });
    expect(asReporter.status).toBe(403);
    const noSecret = await fetch(`${worker.baseUrl}/api/reports/${reportId}/evidence?adminUserId=${admin.id}`);
    expect(noSecret.status).toBe(401);
  });

  it("rejects invalid evidence: wrong type, wrong magic bytes, empty, over 5 MB", async () => {
    const reporter = await fx.member();
    const reported = await fx.member();
    const before = await evidenceKeys();
    const cases: Array<[string, Record<string, unknown>]> = [
      ["wrong type", { evidenceBase64: fakePng().toString("base64"), evidenceMimeType: "application/pdf" }],
      ["magic mismatch", { evidenceBase64: fakeJpeg().toString("base64"), evidenceMimeType: "image/png" }],
      ["fake webp", { evidenceBase64: Buffer.from("RIFFxxxxNOPE").toString("base64"), evidenceMimeType: "image/webp" }],
      ["over 5 MB", { evidenceBase64: Buffer.concat([fakePng(), Buffer.alloc(5 * 1024 * 1024)]).toString("base64"), evidenceMimeType: "image/png" }],
    ];
    for (const [name, extra] of cases) {
      const res = await json("POST", "/api/reports", reportBody(reporter.id, reported.id, extra));
      expect(res.status, name).toBe(400);
      expect(typeof res.body.error, name).toBe("string");
    }
    expect(await evidenceKeys()).toEqual(before); // nothing was stored
  });

  it("a report without evidence needs no storage, and a missing evidence file is a 404", async () => {
    const reporter = await fx.member();
    const reported = await fx.member();
    const admin = await fx.member({ role: "admin" });
    const created = await json("POST", "/api/reports", reportBody(reporter.id, reported.id));
    expect(created.status).toBe(201);
    const res = await fetch(`${worker.baseUrl}/api/reports/${created.body.report.id}/evidence?adminUserId=${admin.id}`, { headers: SECRET });
    expect([404]).toContain(res.status);
  });
});
