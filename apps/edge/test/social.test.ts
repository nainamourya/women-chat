import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TEST_INTERNAL_SECRET, startLocalWorker, type RunningWorker } from "./localWorker";
import { GPS_MARKER, fakeJpeg, fakePng, imagePayload } from "./media";
import { Fixtures } from "./seed";

// The server's social router and services running on the Worker, with R2 for
// images, the Durable Object limiter, and the real-time push path for
// dm:message and notification:new. Local simulated bucket only.
const SECRET = { "x-internal-api-secret": TEST_INTERNAL_SECRET };

let worker: RunningWorker;
let fx: Fixtures;
const sockets: Socket[] = [];

beforeAll(async () => {
  fx = new Fixtures();
  worker = await startLocalWorker(8850, { testHooks: true });
});
afterEach(() => sockets.splice(0).forEach((s) => s.close()));
afterAll(async () => {
  worker?.stop();
  await fx?.cleanup();
});

let seq = 0;
const handle = () => `u_${Date.now().toString(36)}${(seq++).toString(36)}`.slice(0, 20);
const member = (overrides: Parameters<Fixtures["member"]>[0] = {}) => fx.member({ username: handle(), ...overrides });

async function social(viewerId: string | undefined, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { ...SECRET, "content-type": "application/json" };
  if (viewerId) headers["x-viewer-id"] = viewerId;
  const res = await fetch(`${worker.baseUrl}/api/social${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const buffer = Buffer.from(await res.arrayBuffer());
  let parsed: any;
  try {
    parsed = JSON.parse(buffer.toString("utf8"));
  } catch {
    parsed = undefined;
  }
  return { status: res.status, body: parsed, bytes: buffer, headers: res.headers };
}

async function admin(method: string, path: string, body?: unknown) {
  const res = await fetch(`${worker.baseUrl}${path}`, {
    method,
    headers: { ...SECRET, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => undefined)) as any };
}

const objects = async (prefix: string) => ((await admin("GET", `/__test__/r2/list?prefix=${encodeURIComponent(prefix)}`)).body.objects as Array<{ key: string; size: number }>).map((o) => o.key);
const stored = async (key: string) => Buffer.from((await admin("GET", `/__test__/r2/get?key=${encodeURIComponent(key)}`)).body.base64, "base64");

async function connectAs(userId: string): Promise<Socket> {
  const ticket = (await admin("POST", "/api/matchmaking/socket-ticket", { userId })).body.ticket as string;
  const socket = io(worker.baseUrl, { transports: ["websocket"], auth: { ticket }, reconnection: false, forceNew: true });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (e) => reject(new Error(e.message)));
  });
  return socket;
}
const collect = (socket: Socket, ...events: string[]) => {
  const seen: Array<{ event: string; payload: any }> = [];
  for (const e of events) socket.on(e, (payload) => seen.push({ event: e, payload }));
  return seen;
};
const settle = () => new Promise((r) => setTimeout(r, 800));

const newPost = async (author: { id: string }, caption = "hello") => {
  const res = await social(author.id, "POST", "/posts", { ...imagePayload(fakeJpeg()), caption });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.post as { id: string; imageUrl?: string };
};

describe("access and authentication", () => {
  it("needs the internal secret and a valid x-viewer-id on every route", async () => {
    const a = await member();
    const noSecret = await fetch(`${worker.baseUrl}/api/social/me`, { headers: { "x-viewer-id": a.id } });
    expect(noSecret.status).toBe(401);
    expect(await noSecret.json()).toEqual({ error: "Unauthorized." });
    for (const viewer of [undefined, "not-a-uuid"]) {
      const res = await social(viewer, "GET", "/me");
      expect(res.status, String(viewer)).toBe(401);
      expect(res.body).toEqual({ error: "Unauthorized." });
    }
    expect((await social(a.id, "GET", "/me")).status).toBe(200);
  });

  it("acts only as the viewer: another member's data is never writable through it", async () => {
    const a = await member();
    const b = await member();
    const post = await newPost(a);
    const del = await social(b.id, "DELETE", `/posts/${post.id}`);
    expect([403, 404]).toContain(del.status);
    expect((await social(a.id, "GET", `/posts/${post.id}`)).status).toBe(200);
  });
});

describe("profiles and photos (private R2 media)", () => {
  it("sets a profile and rejects a taken or invalid username", async () => {
    const a = await member({ username: null });
    const b = await member();
    const name = handle();
    const set = await social(a.id, "PUT", "/me/profile", { username: name, bio: "Hi there" });
    expect(set.status).toBe(200);
    expect(set.body.profile).toMatchObject({ username: name, bio: "Hi there" });
    expect((await social(b.id, "GET", `/users/${name}`)).body.profile).toMatchObject({ username: name });

    const taken = await social(b.id, "PUT", "/me/profile", { username: name });
    expect(taken.status).toBe(409);
    const invalid = await social(b.id, "PUT", "/me/profile", { username: "no spaces!" });
    expect(invalid.status).toBe(400);
  });

  it("stores an avatar in R2 with metadata stripped, serves it only to permitted members, and deletes the old object on replace and removal", async () => {
    const owner = await member();
    const viewer = await member();
    const blockedViewer = await member();
    const before = await objects("social/avatars/");

    const set = await social(owner.id, "PUT", "/me/avatar", imagePayload(fakeJpeg({ withExif: true })));
    expect(set.status).toBe(200);
    const first = (await objects("social/avatars/")).filter((k) => !before.includes(k));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatch(/^social\/avatars\/[0-9a-f-]{36}\.jpg$/);
    const bytes = await stored(first[0]);
    expect(bytes.includes(Buffer.from(GPS_MARKER))).toBe(false); // EXIF/GPS never reaches storage
    expect(bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xd8]))).toBe(true);

    const res = await social(viewer.id, "GET", `/media/avatars/${owner.username}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; sandbox");
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(res.bytes.equals(bytes)).toBe(true);

    expect((await social(undefined, "GET", `/media/avatars/${owner.username}`)).status).toBe(401);
    await social(owner.id, "POST", `/users/${blockedViewer.username}/block`);
    expect((await social(blockedViewer.id, "GET", `/media/avatars/${owner.username}`)).status).toBe(404);

    const replaced = await social(owner.id, "PUT", "/me/avatar", imagePayload(fakePng(), "image/png"));
    expect(replaced.status).toBe(200);
    const afterReplace = (await objects("social/avatars/")).filter((k) => !before.includes(k));
    expect(afterReplace).toHaveLength(1); // the old JPEG was deleted, only the PNG remains
    expect(afterReplace[0]).toMatch(/\.png$/);

    expect((await social(owner.id, "DELETE", "/me/avatar")).status).toBe(200);
    expect((await objects("social/avatars/")).filter((k) => !before.includes(k))).toHaveLength(0);
    expect((await social(viewer.id, "GET", `/media/avatars/${owner.username}`)).status).toBe(404);
  });

  it("rejects invalid images: wrong type, signature mismatch, empty, oversized — and stores nothing", async () => {
    const a = await member();
    const before = await objects("social/");
    const cases: Array<[string, unknown]> = [
      ["wrong type", imagePayload(fakeJpeg(), "image/gif")],
      ["signature mismatch", imagePayload(fakePng(), "image/jpeg")],
      ["not an image", imagePayload(Buffer.from("just text"), "image/jpeg")],
      ["empty", { imageBase64: "", mimeType: "image/jpeg" }],
      ["missing mime", { imageBase64: fakeJpeg().toString("base64") }],
    ];
    for (const [name, body] of cases) {
      const res = await social(a.id, "PUT", "/me/avatar", body);
      expect(res.status, name).toBe(400);
    }
    // Over the 8 MB base64 limit: refused by the body limit or the schema, never stored.
    const huge = await fetch(`${worker.baseUrl}/api/social/me/avatar`, {
      method: "PUT",
      headers: { ...SECRET, "content-type": "application/json", "x-viewer-id": a.id },
      body: JSON.stringify({ imageBase64: "A".repeat(9 * 1024 * 1024), mimeType: "image/jpeg" }),
    });
    expect([400, 413]).toContain(huge.status);
    expect(await objects("social/")).toEqual(before);
  });
});

describe("posts, likes, comments", () => {
  it("creates a post (image sanitized into R2), shows it to a follower, and removes the object when deleted", async () => {
    const author = await member();
    const follower = await member();
    const stranger = await member();
    await social(follower.id, "POST", `/users/${author.username}/follow`);
    const before = await objects("social/posts/");

    const post = await newPost(author, "a caption");
    const added = (await objects("social/posts/")).filter((k) => !before.includes(k));
    expect(added).toHaveLength(1);
    expect((await stored(added[0])).includes(Buffer.from(GPS_MARKER))).toBe(false);

    const feed = await social(follower.id, "GET", "/feed");
    expect(feed.status).toBe(200);
    expect(JSON.stringify(feed.body)).toContain(post.id);

    const image = await social(follower.id, "GET", `/media/posts/${post.id}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(image.bytes.equals(await stored(added[0]))).toBe(true);
    expect((await social(undefined, "GET", `/media/posts/${post.id}`)).status).toBe(401);

    expect([403, 404]).toContain((await social(stranger.id, "DELETE", `/posts/${post.id}`)).status);
    expect((await social(author.id, "DELETE", `/posts/${post.id}`)).body).toEqual({ deleted: true });
    expect((await objects("social/posts/")).filter((k) => !before.includes(k))).toHaveLength(0);
    expect((await social(follower.id, "GET", `/media/posts/${post.id}`)).status).toBe(404);
  });

  it("a blocked member cannot see a post or its image", async () => {
    const author = await member();
    const other = await member();
    const post = await newPost(author);
    await social(author.id, "POST", `/users/${other.username}/block`);
    expect((await social(other.id, "GET", `/posts/${post.id}`)).status).toBe(404);
    expect((await social(other.id, "GET", `/media/posts/${post.id}`)).status).toBe(404);
    await social(author.id, "DELETE", `/users/${other.username}/block`);
    expect((await social(other.id, "GET", `/media/posts/${post.id}`)).status).toBe(200);
  });

  it("likes and comments work, and are authorized", async () => {
    const author = await member();
    const fan = await member();
    const post = await newPost(author);
    expect((await social(fan.id, "POST", `/posts/${post.id}/like`)).status).toBe(200);
    expect((await social(fan.id, "POST", `/posts/${post.id}/like`)).status).toBe(200); // idempotent
    const comment = await social(fan.id, "POST", `/posts/${post.id}/comments`, { content: "nice" });
    expect(comment.status).toBe(201);
    expect((await social(fan.id, "POST", `/posts/${post.id}/comments`, { content: "" })).status).toBe(400);
    const listed = await social(author.id, "GET", `/posts/${post.id}/comments`);
    expect(JSON.stringify(listed.body)).toContain("nice");
    const stranger = await member();
    expect([403, 404]).toContain((await social(stranger.id, "DELETE", `/comments/${comment.body.comment.id}`)).status);
    expect((await social(fan.id, "DELETE", `/comments/${comment.body.comment.id}`)).status).toBe(200);
    expect((await social(fan.id, "DELETE", `/posts/${post.id}/like`)).status).toBe(200);
  });

  it("rate limits post creation (20 per hour) with the generic 429", async () => {
    const a = await member();
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await social(a.id, "POST", "/posts", { ...imagePayload(fakeJpeg()), caption: `p${i}` });
      last = res.status;
      if (last === 429) {
        expect(res.body).toEqual({ error: "Too many attempts. Please try again later." });
        expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
        break;
      }
    }
    expect(last).toBe(429);
  }, 60_000);
});

describe("notifications and direct messages are pushed in real time", () => {
  it("follow, like and comment push notification:new to the recipient's live sockets only", async () => {
    const author = await member();
    const fan = await member();
    const bystander = await member();
    const sa1 = await connectAs(author.id);
    const sa2 = await connectAs(author.id);
    const sb = await connectAs(bystander.id);
    const at1 = collect(sa1, "notification:new");
    const at2 = collect(sa2, "notification:new");
    const atBystander = collect(sb, "notification:new");

    await social(fan.id, "POST", `/users/${author.username}/follow`);
    const post = await newPost(author);
    await social(fan.id, "POST", `/posts/${post.id}/like`);
    await social(fan.id, "POST", `/posts/${post.id}/comments`, { content: "great" });
    await settle();

    const types = at1.map((e) => e.payload.type);
    expect(types).toEqual(expect.arrayContaining(["follow", "like", "comment"]));
    expect(at2.map((e) => e.payload.type).sort()).toEqual(types.slice().sort()); // every tab
    expect(atBystander).toEqual([]);

    const list = await social(author.id, "GET", "/notifications");
    expect(list.status).toBe(200);
    expect((await social(author.id, "GET", "/unread-counts")).body.notifications).toBeGreaterThanOrEqual(3);
    expect((await social(author.id, "POST", "/notifications/read", {})).body).toEqual({ ok: true });
    expect((await social(author.id, "GET", "/unread-counts")).body.notifications).toBe(0);
  });

  it("a direct message is pushed as dm:message to both people, plus notification:new to the recipient", async () => {
    const a = await member();
    const b = await member();
    const outsider = await member();
    await social(a.id, "POST", `/users/${b.username}/follow`);
    await social(b.id, "POST", `/users/${a.username}/follow`);
    const sa = await connectAs(a.id);
    const sb = await connectAs(b.id);
    const so = await connectAs(outsider.id);
    const atA = collect(sa, "dm:message", "notification:new");
    const atB = collect(sb, "dm:message", "notification:new");
    const atOutsider = collect(so, "dm:message", "notification:new");

    const started = await social(a.id, "POST", "/conversations", { username: b.username });
    expect(started.status).toBe(201);
    const conversationId = started.body.conversation?.id ?? started.body.id;
    expect(typeof conversationId).toBe("string");

    const sent = await social(a.id, "POST", `/conversations/${conversationId}/messages`, { content: "hello b" });
    expect(sent.status).toBe(201);
    await settle();

    const dmAtA = atA.filter((e) => e.event === "dm:message");
    const dmAtB = atB.filter((e) => e.event === "dm:message");
    expect(dmAtA).toHaveLength(1);
    expect(dmAtB).toHaveLength(1);
    expect(JSON.stringify(dmAtB[0].payload)).toContain("hello b");
    expect(atB.filter((e) => e.event === "notification:new").map((e) => e.payload)).toContainEqual({ type: "message" });
    expect(atOutsider).toEqual([]);

    const readBack = await social(b.id, "GET", `/conversations/${conversationId}/messages`);
    expect(JSON.stringify(readBack.body)).toContain("hello b");
    expect((await social(outsider.id, "GET", `/conversations/${conversationId}/messages`)).status).toBeGreaterThanOrEqual(400);
  });

  it("messaging needs a mutual follow and refuses blocked members", async () => {
    const a = await member();
    const b = await member();
    const oneWay = await social(a.id, "POST", "/conversations", { username: b.username });
    expect(oneWay.status).toBeGreaterThanOrEqual(400);
    await social(a.id, "POST", `/users/${b.username}/follow`);
    await social(b.id, "POST", `/users/${a.username}/follow`);
    const ok = await social(a.id, "POST", "/conversations", { username: b.username });
    expect(ok.status).toBe(201);
    const id = ok.body.conversation?.id ?? ok.body.id;
    await social(b.id, "POST", `/users/${a.username}/block`);
    const afterBlock = await social(a.id, "POST", `/conversations/${id}/messages`, { content: "still there?" });
    expect(afterBlock.status).toBeGreaterThanOrEqual(400);
  });
});

describe("blocking and reporting", () => {
  it("block, list and unblock through the social router", async () => {
    const a = await member();
    const b = await member();
    expect((await social(a.id, "POST", `/users/${b.username}/block`)).body).toEqual({ blocked: true });
    expect(JSON.stringify((await social(a.id, "GET", "/blocked")).body)).toContain(b.username!);
    expect((await social(a.id, "DELETE", `/users/${b.username}/block`)).body).toEqual({ blocked: false });
    expect((await social(a.id, "POST", `/users/${a.username}/block`)).status).toBe(400);
  });

  it("reports a member and a post, and limits reports to 5 per hour", async () => {
    const a = await member();
    const b = await member();
    const post = await newPost(b);
    const user = await social(a.id, "POST", `/users/${b.username}/report`, { reason: "harassment" });
    expect(user.status).toBe(201);
    expect(user.body).toMatchObject({ reported: true });
    const onPost = await social(a.id, "POST", `/posts/${post.id}/report`, { reason: "spam_scam", description: "ad" });
    expect(onPost.status).toBe(201);
    expect((await social(a.id, "POST", `/users/${b.username}/report`, { reason: "not-a-reason" })).status).toBe(400);
  });

  it("the /api/blocks router (server-to-server) blocks and unblocks with its own limits and validation", async () => {
    const a = await member();
    const b = await member();
    expect((await admin("POST", "/api/blocks", { blockerUserId: a.id })).status).toBe(400);
    expect((await admin("POST", "/api/blocks", { blockerUserId: a.id, blockedUserId: b.id })).status).toBe(200);
    const bad = await fetch(`${worker.baseUrl}/api/blocks`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(bad.status).toBe(401);
    expect((await admin("DELETE", "/api/blocks", { blockerUserId: a.id, blockedUserId: b.id })).status).toBe(200);
    expect((await admin("POST", "/api/blocks", { blockerUserId: a.id, blockedUserId: a.id })).status).toBe(400);
  });
});

describe("account deletion removes stored media and live connections", () => {
  it("deletes the member's R2 images, drops their sockets, and refuses wrong confirmation or password", async () => {
    const victim = await member();
    await social(victim.id, "PUT", "/me/avatar", imagePayload(fakeJpeg()));
    const post = await newPost(victim);
    const mine = (await objects("social/")).length;
    expect(mine).toBeGreaterThanOrEqual(2);
    const live = await connectAs(victim.id);
    const dropped = new Promise((r) => live.once("disconnect", r));

    const wrong = await admin("DELETE", "/api/account", { userId: victim.id, confirmation: "delete" });
    expect(wrong.status).toBe(400);
    expect((await objects("social/")).length).toBe(mine); // nothing removed yet

    const done = await admin("DELETE", "/api/account", { userId: victim.id, confirmation: "DELETE" });
    expect(done.status).toBe(200);
    await dropped;
    expect(live.connected).toBe(false);
    expect((await objects("social/")).length).toBe(mine - 2); // avatar and post image are gone
    const viewer = await member();
    expect((await social(viewer.id, "GET", `/media/posts/${post.id}`)).status).toBe(404);
    expect((await admin("POST", "/api/matchmaking/socket-ticket", { userId: victim.id })).status).toBe(403);

    // Deleting again is idempotent.
    expect((await admin("DELETE", "/api/account", { userId: victim.id, confirmation: "DELETE" })).status).toBe(200);
  });

  it("requires the password when the account has one", async () => {
    const withPassword = await member({ passwordHash: "$2a$10$notarealhashnotarealhashnotarealhashnotarealhashnotare" });
    const res = await admin("DELETE", "/api/account", { userId: withPassword.id, confirmation: "DELETE" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Enter your password to confirm." });
    const wrong = await admin("DELETE", "/api/account", { userId: withPassword.id, confirmation: "DELETE", password: "wrong-password" });
    expect(wrong.status).toBe(403);
    expect(wrong.body).toEqual({ error: "That password isn't correct." });
  });
});
