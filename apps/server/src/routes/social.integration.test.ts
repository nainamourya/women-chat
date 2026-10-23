import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import express from "express";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db, closeDb } from "../db/client.js";
import { blocks, comments, conversations, follows, notifications, postLikes, posts, reports, users, type User } from "../db/schema.js";
import { env } from "../config/env.js";
import { GPS_MARKER, createMember, fakeJpeg, fakePng, imagePayload } from "../testUtils/socialFixtures.js";
import { socialRouter } from "./social.js";

// Real router, real PostgreSQL and Redis (the dedicated local test instances
// guarded by config/testTargetGuard.ts). Only object storage is replaced, with
// an in-memory map, so no test ever talks to R2.
const store = vi.hoisted(() => new Map<string, Buffer>());
vi.mock("../services/social/mediaStorage.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/social/mediaStorage.js")>();
  return {
    ...real,
    writeMedia: async (key: string, body: Buffer) => void store.set(key, body),
    readMedia: async (key: string) => {
      const found = store.get(key);
      if (!found) throw new Error("missing");
      return found;
    },
    deleteMedia: async (key: string) => store.delete(key),
  };
});

const created: string[] = [];
let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use("/api/social", socialRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  if (created.length > 0) {
    await db.delete(reports).where(inArray(reports.reporterUserId, created));
    await db.delete(users).where(inArray(users.id, created));
  }
  await closeDb();
});

type Result = { status: number; body: any; headers: Headers; raw: Buffer };

async function call(viewer: string | User | null, method: string, path: string, body?: unknown, extraHeaders: Record<string, string> = {}): Promise<Result> {
  const headers: Record<string, string> = { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET, ...extraHeaders };
  if (viewer) headers["x-viewer-id"] = typeof viewer === "string" ? viewer : viewer.id;
  const res = await fetch(`${baseUrl}/api/social${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const raw = Buffer.from(await res.arrayBuffer());
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw.toString("utf8"));
  } catch {
    // binary body
  }
  return { status: res.status, body: parsed, headers: res.headers, raw };
}

const member = (opts?: Parameters<typeof createMember>[1]) => createMember(created, opts);
const jpeg = () => imagePayload(fakeJpeg());

async function postAs(author: User, caption = "hello") {
  const res = await call(author, "POST", "/posts", { caption, ...jpeg() });
  expect(res.status).toBe(201);
  return res.body.post as { id: string };
}

async function followAs(follower: User, target: User) {
  const res = await call(follower, "POST", `/users/${target.username}/follow`);
  expect(res.status).toBe(200);
}

async function mutualFollow(a: User, b: User) {
  await followAs(a, b);
  await followAs(b, a);
}

describe("authentication and eligibility of the caller", () => {
  it("rejects calls without the internal secret, without a viewer, or with a forged viewer id", async () => {
    const a = await member();
    const noSecret = await fetch(`${baseUrl}/api/social/me`, { headers: { "x-viewer-id": a.id } });
    expect(noSecret.status).toBe(401);
    expect((await call(null, "GET", "/me")).status).toBe(401);
    expect((await call("not-a-uuid", "GET", "/me")).status).toBe(401);
    // A well-formed id of an account that does not exist.
    expect((await call(randomUUID(), "GET", "/me")).status).toBe(401);
  });

  it("refuses unverified, suspended and banned accounts — there is no social access without eligibility", async () => {
    const unverified = await member({ verified: false });
    const suspended = await member({ accountStatus: "suspended" });
    const banned = await member({ accountStatus: "banned" });
    const deleted = await member({ accountStatus: "deleted" });
    for (const user of [unverified, suspended, banned, deleted]) {
      const res = await call(user, "GET", "/feed");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("not_eligible");
    }
  });

  it("requires a username for social actions but not to set one up", async () => {
    const fresh = await member({ username: null });
    expect((await call(fresh, "GET", "/me")).body.profile.hasUsername).toBe(false);
    const blocked = await call(fresh, "POST", "/posts", { caption: "x", ...jpeg() });
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("username_required");
    expect((await call(fresh, "GET", "/feed")).body.code).toBe("username_required");
  });
});

describe("1. profiles: create, edit, validate, and only edit your own", () => {
  it("lets a member choose a username, display name and bio, and shows them on the profile", async () => {
    const a = await member({ username: null });
    const name = `anna_${randomUUID().slice(0, 6)}`;
    const res = await call(a, "PUT", "/me/profile", { username: name, displayName: "Anna Rao", bio: "Hello, I paint.\nAnd hike." });
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({ username: name, displayName: "Anna Rao", bio: "Hello, I paint.\nAnd hike.", hasUsername: true });

    const viewer = await member();
    const view = await call(viewer, "GET", `/users/${name}`);
    expect(view.status).toBe(200);
    expect(view.body.profile).toMatchObject({ username: name, displayName: "Anna Rao", postCount: 0, followerCount: 0, followingCount: 0, isSelf: false, isFollowing: false });
    // No internal identifiers or contact details leak into a profile.
    expect(Object.keys(view.body.profile)).not.toContain("id");
    expect(Object.keys(view.body.profile)).not.toContain("email");
  });

  it("normalises usernames to lowercase and enforces uniqueness case-insensitively", async () => {
    const first = await member({ username: null });
    const second = await member({ username: null });
    const base = `Mixed_${randomUUID().slice(0, 6)}`;
    expect((await call(first, "PUT", "/me/profile", { username: base })).body.profile.username).toBe(base.toLowerCase());
    const clash = await call(second, "PUT", "/me/profile", { username: base.toUpperCase() });
    expect(clash.status).toBe(409);
    expect(clash.body.error).toMatch(/already taken/);
    // Keeping your own name is fine.
    expect((await call(first, "PUT", "/me/profile", { username: base })).status).toBe(200);
  });

  it.each([
    ["too short", "ab"],
    ["too long", "a".repeat(31)],
    ["spaces", "has space"],
    ["symbols", "bad!name"],
    ["leading period", ".dot"],
    ["trailing period", "dot."],
    ["double period", "a..b"],
    ["reserved name", "admin"],
    ["reserved route", "settings"],
    ["unicode lookalike", "ааа_cyr"],
    ["empty", ""],
  ])("rejects an invalid username: %s", async (_label, username) => {
    const a = await member({ username: null });
    const res = await call(a, "PUT", "/me/profile", { username });
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe("string");
  });

  it("rejects malformed display names and bios", async () => {
    const a = await member();
    expect((await call(a, "PUT", "/me/profile", { displayName: "x" })).status).toBe(400);
    expect((await call(a, "PUT", "/me/profile", { displayName: "two\nlines" })).status).toBe(400);
    expect((await call(a, "PUT", "/me/profile", { bio: "x".repeat(501) })).status).toBe(400);
    expect((await call(a, "PUT", "/me/profile", { bio: "bell\u0007char" })).status).toBe(400);
  });

  it("only ever edits the caller's own profile, ignoring any user id in the request", async () => {
    const a = await member();
    const victim = await member({ displayName: "Victim" });
    const before = victim.username;
    const res = await call(a, "PUT", "/me/profile", { displayName: "Hijacked", userId: victim.id, id: victim.id, username: "hijacked_user", targetUserId: victim.id });
    expect(res.status).toBe(200);
    const [after] = await db.select().from(users).where(eq(users.id, victim.id));
    expect(after!.displayName).toBe("Victim");
    expect(after!.username).toBe(before);
    expect(res.body.profile.displayName).toBe("Hijacked");
  });

  it("does not show a member who is unverified, suspended or has no username", async () => {
    const viewer = await member();
    const unverified = await member({ verified: false });
    const suspended = await member({ accountStatus: "suspended" });
    expect((await call(viewer, "GET", `/users/${unverified.username}`)).status).toBe(404);
    expect((await call(viewer, "GET", `/users/${suspended.username}`)).status).toBe(404);
    expect((await call(viewer, "GET", "/users/does_not_exist_zz")).status).toBe(404);
  });
});

describe("2/3. follow relationships are persisted, unique and consistent", () => {
  it("follows, persists the edge, updates both members' counts, and unfollows", async () => {
    const a = await member();
    const b = await member();
    const res = await call(a, "POST", `/users/${b.username}/follow`);
    expect(res.body).toMatchObject({ following: true, followerCount: 1 });

    const rows = await db.select().from(follows).where(and(eq(follows.followerId, a.id), eq(follows.followeeId, b.id)));
    expect(rows).toHaveLength(1);

    const profileB = (await call(a, "GET", `/users/${b.username}`)).body.profile;
    expect(profileB).toMatchObject({ followerCount: 1, followingCount: 0, isFollowing: true, followsYou: false, isMutual: false });
    expect((await call(a, "GET", "/me")).body.profile).toMatchObject({ followingCount: 1, followerCount: 0 });

    const off = await call(a, "DELETE", `/users/${b.username}/follow`);
    expect(off.body).toMatchObject({ following: false, followerCount: 0 });
    expect(await db.select().from(follows).where(eq(follows.followerId, a.id))).toHaveLength(0);
  });

  it("never creates a duplicate follow, even for simultaneous requests", async () => {
    const a = await member();
    const b = await member();
    const results = await Promise.all(Array.from({ length: 6 }, () => call(a, "POST", `/users/${b.username}/follow`)));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(await db.select().from(follows).where(eq(follows.followerId, a.id))).toHaveLength(1);
    expect((await call(a, "GET", `/users/${b.username}`)).body.profile.followerCount).toBe(1);
  });

  it("refuses to follow yourself, at the API and in the database", async () => {
    const a = await member();
    const res = await call(a, "POST", `/users/${a.username}/follow`);
    expect(res.status).toBe(400);
    await expect(db.insert(follows).values({ followerId: a.id, followeeId: a.id })).rejects.toThrow();
  });

  it("reports mutual follows from both sides", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    expect((await call(a, "GET", `/users/${b.username}`)).body.profile).toMatchObject({ isFollowing: true, followsYou: true, isMutual: true });
    expect((await call(b, "GET", `/users/${a.username}`)).body.profile).toMatchObject({ isFollowing: true, followsYou: true, isMutual: true });
  });

  it("lists followers and following with stable cursor pagination", async () => {
    const star = await member();
    const fans: User[] = [];
    for (let i = 0; i < 5; i++) {
      const fan = await member();
      fans.push(fan);
      await followAs(fan, star);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Result = await call(fans[0]!, "GET", `/users/${star.username}/followers?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      expect(res.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...res.body.items.map((u: { username: string }) => u.username));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(seen).size).toBe(5);
    expect(seen.sort()).toEqual(fans.map((f) => f.username).sort());

    const following = await call(fans[0]!, "GET", `/users/${fans[0]!.username}/following`);
    expect(following.body.items.map((u: { username: string }) => u.username)).toEqual([star.username]);
    // The caller sees their own relationship to each listed member.
    expect(following.body.items[0].isFollowing).toBe(true);
  });

  it("rejects a malformed cursor", async () => {
    const a = await member();
    expect((await call(a, "GET", `/users/${a.username}/followers?cursor=garbage`)).status).toBe(400);
    expect((await call(a, "GET", `/users/${a.username}/followers?limit=999`)).status).toBe(400);
  });
});

describe("4. posts and media", () => {
  it("creates a post with a photo, shows it on the profile and serves the image to members", async () => {
    const a = await member();
    const b = await member();
    const res = await call(a, "POST", "/posts", { caption: "First light", ...jpeg() });
    expect(res.status).toBe(201);
    const post = res.body.post;
    expect(post).toMatchObject({ caption: "First light", likeCount: 0, commentCount: 0, likedByViewer: false, isOwner: true });
    expect(post.author.username).toBe(a.username);
    expect(post.imageUrl).toBe(`/api/social/media/posts/${post.id}`);

    const grid = await call(b, "GET", `/users/${a.username}/posts`);
    expect(grid.body.items.map((p: { id: string }) => p.id)).toEqual([post.id]);
    expect(grid.body.items[0].isOwner).toBe(false);
    expect((await call(a, "GET", `/users/${a.username}`)).body.profile.postCount).toBe(1);

    const image = await call(b, "GET", `/media/posts/${post.id}`);
    expect(image.status).toBe(200);
    expect(image.headers.get("content-type")).toBe("image/jpeg");
    expect(image.headers.get("x-content-type-options")).toBe("nosniff");
    expect(image.headers.get("cache-control")).toMatch(/^private/);
  });

  it("removes embedded location metadata before storing the image", async () => {
    const a = await member();
    const post = await postAs(a);
    const [row] = await db.select().from(posts).where(eq(posts.id, post.id));
    const stored = store.get(row!.imageKey)!;
    expect(stored.includes(Buffer.from(GPS_MARKER))).toBe(false);
    expect(stored.includes(Buffer.from("Exif"))).toBe(false);
    expect(stored.includes(Buffer.from("SCAN"))).toBe(true);
    // Keys are generated server-side, never taken from the client.
    expect(row!.imageKey).toMatch(/^social\/posts\/[0-9a-f-]{36}\.jpg$/);
  });

  it.each([
    ["a GIF", { imageBase64: Buffer.from("GIF89a....").toString("base64"), mimeType: "image/gif" }],
    ["an SVG", { imageBase64: Buffer.from("<svg onload=alert(1)/>").toString("base64"), mimeType: "image/svg+xml" }],
    ["HTML labelled as PNG", { imageBase64: Buffer.from("<script>alert(1)</script>").toString("base64"), mimeType: "image/png" }],
    ["a PNG labelled as JPEG", imagePayload(fakePng(), "image/jpeg")],
    ["garbage base64", { imageBase64: "%%%not-base64%%%", mimeType: "image/jpeg" }],
    ["an empty image", { imageBase64: "", mimeType: "image/jpeg" }],
  ])("rejects %s", async (_label, payload) => {
    const a = await member();
    const res = await call(a, "POST", "/posts", { caption: "x", ...payload });
    expect([400, 413]).toContain(res.status);
    expect(await db.select().from(posts).where(eq(posts.authorId, a.id))).toHaveLength(0);
  });

  it("rejects an oversized image and an over-long caption, and stores nothing", async () => {
    const a = await member();
    const storedBefore = store.size;
    const huge = await call(a, "POST", "/posts", { caption: "x", ...imagePayload(fakeJpeg({ extra: "x".repeat(5 * 1024 * 1024 + 100) })) });
    expect(huge.status).toBe(413);
    expect((await call(a, "POST", "/posts", { caption: "c".repeat(2201), ...jpeg() })).status).toBe(400);
    expect((await call(a, "POST", "/posts", { caption: "bell\u0007", ...jpeg() })).status).toBe(400);
    expect((await call(a, "POST", "/posts", { caption: "x" })).status).toBe(400);
    expect(store.size).toBe(storedBefore);
  });

  it("allows an image with no caption", async () => {
    const a = await member();
    const res = await call(a, "POST", "/posts", jpeg());
    expect(res.status).toBe(201);
    expect(res.body.post.caption).toBe("");
  });

  it("lets only the author delete a post, and removes its image", async () => {
    const a = await member();
    const b = await member();
    const post = await postAs(a);
    const [row] = await db.select().from(posts).where(eq(posts.id, post.id));

    const attempt = await call(b, "DELETE", `/posts/${post.id}`);
    expect(attempt.status).toBe(404);
    expect(await db.select().from(posts).where(eq(posts.id, post.id))).toHaveLength(1);

    expect((await call(a, "DELETE", `/posts/${post.id}`)).status).toBe(200);
    expect(await db.select().from(posts).where(eq(posts.id, post.id))).toHaveLength(0);
    expect(store.has(row!.imageKey)).toBe(false);
    expect((await call(a, "GET", `/posts/${post.id}`)).status).toBe(404);
  });

  it("sets and clears a profile photo, served only to members who can see the profile", async () => {
    const a = await member();
    const b = await member();
    expect((await call(b, "GET", `/media/avatars/${a.username}`)).status).toBe(404);
    const set = await call(a, "PUT", "/me/avatar", jpeg());
    expect(set.status).toBe(200);
    expect(set.body.profile.avatarUrl).toMatch(new RegExp(`^/api/social/media/avatars/${a.username}\\?v=`));
    const image = await call(b, "GET", `/media/avatars/${a.username}`);
    expect(image.status).toBe(200);
    expect(image.raw.includes(Buffer.from(GPS_MARKER))).toBe(false);

    const [withAvatar] = await db.select().from(users).where(eq(users.id, a.id));
    expect((await call(a, "DELETE", "/me/avatar")).body.profile.avatarUrl).toBeNull();
    expect(store.has(withAvatar!.avatarKey!)).toBe(false);
    expect((await call(a, "PUT", "/me/avatar", { imageBase64: Buffer.from("nope").toString("base64"), mimeType: "image/png" })).status).toBe(400);
  });
});

describe("5. likes and comments", () => {
  it("likes once per member (database-enforced), counts accurately, and unlikes", async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    const post = await postAs(a);

    const first = await call(b, "POST", `/posts/${post.id}/like`);
    expect(first.body).toEqual({ liked: true, likeCount: 1 });
    const results = await Promise.all(Array.from({ length: 5 }, () => call(b, "POST", `/posts/${post.id}/like`)));
    expect(results.every((r) => r.body.likeCount === 1)).toBe(true);
    expect(await db.select().from(postLikes).where(eq(postLikes.postId, post.id))).toHaveLength(1);
    await expect(db.insert(postLikes).values({ postId: post.id, userId: b.id })).rejects.toThrow();

    expect((await call(c, "POST", `/posts/${post.id}/like`)).body.likeCount).toBe(2);
    const seenByB = (await call(b, "GET", `/posts/${post.id}`)).body.post;
    expect(seenByB).toMatchObject({ likeCount: 2, likedByViewer: true });
    const seenByA = (await call(a, "GET", `/posts/${post.id}`)).body.post;
    expect(seenByA).toMatchObject({ likeCount: 2, likedByViewer: false });

    expect((await call(b, "DELETE", `/posts/${post.id}/like`)).body).toEqual({ liked: false, likeCount: 1 });
    expect((await call(b, "DELETE", `/posts/${post.id}/like`)).body.likeCount).toBe(1);
  });

  it("cannot like as someone else, or like a post that does not exist", async () => {
    const a = await member();
    const b = await member();
    const c = await member();
    const post = await postAs(a);
    const res = await call(b, "POST", `/posts/${post.id}/like`, { userId: c.id, viewerId: c.id });
    expect(res.status).toBe(200);
    const likers = await db.select().from(postLikes).where(eq(postLikes.postId, post.id));
    expect(likers.map((l) => l.userId)).toEqual([b.id]);
    expect((await call(b, "POST", `/posts/${randomUUID()}/like`)).status).toBe(404);
    expect((await call(b, "POST", `/posts/not-a-uuid/like`)).status).toBe(404);
  });

  it("adds, lists (oldest first, paginated) and counts comments", async () => {
    const a = await member();
    const b = await member();
    const post = await postAs(a);
    for (let i = 1; i <= 5; i++) {
      const res = await call(b, "POST", `/posts/${post.id}/comments`, { content: `comment ${i}` });
      expect(res.status).toBe(201);
      expect(res.body.comment).toMatchObject({ content: `comment ${i}`, canDelete: true });
      expect(res.body.comment.author.username).toBe(b.username);
    }
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Result = await call(a, "GET", `/posts/${post.id}/comments?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      seen.push(...res.body.items.map((c: { content: string }) => c.content));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toEqual(["comment 1", "comment 2", "comment 3", "comment 4", "comment 5"]);
    expect((await call(a, "GET", `/posts/${post.id}`)).body.post.commentCount).toBe(5);
  });

  it.each([
    ["empty", ""],
    ["whitespace only", "   \n  "],
    ["over 1000 characters", "x".repeat(1001)],
    ["a control character", "hi\u0000there"],
  ])("rejects a comment that is %s", async (_label, content) => {
    const a = await member();
    const post = await postAs(a);
    const res = await call(a, "POST", `/posts/${post.id}/comments`, { content });
    expect(res.status).toBe(400);
    expect(await db.select().from(comments).where(eq(comments.postId, post.id))).toHaveLength(0);
  });

  it("rejects a non-string comment and missing body", async () => {
    const a = await member();
    const post = await postAs(a);
    expect((await call(a, "POST", `/posts/${post.id}/comments`, { content: 123 })).status).toBe(400);
    expect((await call(a, "POST", `/posts/${post.id}/comments`, {})).status).toBe(400);
  });

  it("lets a comment's author or the post's owner delete it, and nobody else", async () => {
    const owner = await member();
    const commenter = await member();
    const stranger = await member();
    const post = await postAs(owner);
    const mine = (await call(commenter, "POST", `/posts/${post.id}/comments`, { content: "mine" })).body.comment;
    const other = (await call(commenter, "POST", `/posts/${post.id}/comments`, { content: "also mine" })).body.comment;

    expect((await call(stranger, "DELETE", `/comments/${mine.id}`)).status).toBe(404);
    expect((await call(commenter, "DELETE", `/comments/${mine.id}`)).status).toBe(200);
    expect((await call(owner, "DELETE", `/comments/${other.id}`)).status).toBe(200);
    expect(await db.select().from(comments).where(eq(comments.postId, post.id))).toHaveLength(0);
  });

  it("shows canDelete correctly to the viewer", async () => {
    const owner = await member();
    const commenter = await member();
    const reader = await member();
    const post = await postAs(owner);
    await call(commenter, "POST", `/posts/${post.id}/comments`, { content: "hey" });
    const asOwner = (await call(owner, "GET", `/posts/${post.id}/comments`)).body.items[0];
    const asReader = (await call(reader, "GET", `/posts/${post.id}/comments`)).body.items[0];
    expect(asOwner.canDelete).toBe(true);
    expect(asReader.canDelete).toBe(false);
  });
});

describe("6. home feed", () => {
  it("shows posts from followed members and the viewer's own, newest first, and paginates without gaps or repeats", async () => {
    const viewer = await member();
    const followedA = await member();
    const followedB = await member();
    const stranger = await member();
    await followAs(viewer, followedA);
    await followAs(viewer, followedB);

    const expected: string[] = [];
    for (let i = 0; i < 3; i++) expected.push((await postAs(followedA, `a${i}`)).id);
    for (let i = 0; i < 2; i++) expected.push((await postAs(followedB, `b${i}`)).id);
    expected.push((await postAs(viewer, "mine")).id);
    const hidden = (await postAs(stranger, "not followed")).id;
    expected.reverse(); // newest first

    const all: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Result = await call(viewer, "GET", `/feed?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      expect(res.status).toBe(200);
      all.push(...res.body.items.map((p: { id: string }) => p.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);

    expect(pages).toBe(3);
    expect(all).toEqual(expected);
    expect(all).not.toContain(hidden);
  });

  it("is empty for a member who follows nobody and has not posted", async () => {
    const lonely = await member();
    const res = await call(lonely, "GET", "/feed");
    expect(res.body).toEqual({ items: [], nextCursor: null });
  });

  it("reflects follow and unfollow immediately, and carries like state per post", async () => {
    const viewer = await member();
    const author = await member();
    const post = await postAs(author);
    expect((await call(viewer, "GET", "/feed")).body.items).toHaveLength(0);
    await followAs(viewer, author);
    await call(viewer, "POST", `/posts/${post.id}/like`);
    const feed = (await call(viewer, "GET", "/feed")).body.items;
    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({ id: post.id, likeCount: 1, likedByViewer: true, commentCount: 0 });
    await call(viewer, "DELETE", `/users/${author.username}/follow`);
    expect((await call(viewer, "GET", "/feed")).body.items).toHaveLength(0);
  });
});

describe("pagination is exact even for rows created within the same millisecond", () => {
  it("never repeats or skips posts whose timestamps differ only in microseconds or are identical", async () => {
    const author = await member();
    const viewer = await member();
    await followAs(viewer, author);
    // PostgreSQL keeps microseconds; JavaScript dates do not. Seven posts inside
    // one millisecond (three sharing the exact same instant) used to be repeated
    // or dropped at page boundaries.
    const stamps = [".123100", ".123200", ".123300", ".123300", ".123300", ".123400", ".123500"];
    const ids: string[] = [];
    for (const frac of stamps) {
      const id = randomUUID();
      ids.push(id);
      await db.execute(sql`insert into posts (id, author_id, caption, image_key, image_mime_type, created_at)
        values (${id}, ${author.id}, ${"p" + frac}, ${`social/posts/${id}.jpg`}, 'image/jpeg', ${"2026-01-01T00:00:00" + frac + "Z"}::timestamptz)`);
    }
    const expected = [...ids.map((id, i) => ({ id, frac: stamps[i]! }))]
      .sort((x, y) => (x.frac === y.frac ? (x.id < y.id ? 1 : -1) : x.frac < y.frac ? 1 : -1))
      .map((x) => x.id);

    for (const path of [`/users/${author.username}/posts`, "/feed"]) {
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        const res: Result = await call(viewer, "GET", `${path}?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
        expect(res.status).toBe(200);
        seen.push(...res.body.items.map((p: { id: string }) => p.id));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor && pages < 12);
      expect(seen).toEqual(expected);
    }
  });
});

describe("7. sharing and link authorization", () => {
  it("opens a shared post for any eligible member, but not for anyone else", async () => {
    const author = await member();
    const post = await postAs(author, "shareable");
    const reader = await member();
    const open = await call(reader, "GET", `/posts/${post.id}`);
    expect(open.status).toBe(200);
    expect(open.body.post.caption).toBe("shareable");

    expect((await call(null, "GET", `/posts/${post.id}`)).status).toBe(401);
    const unverified = await member({ verified: false });
    expect((await call(unverified, "GET", `/posts/${post.id}`)).status).toBe(403);
    const noUsername = await member({ username: null });
    expect((await call(noUsername, "GET", `/posts/${post.id}`)).status).toBe(403);
  });

  it("returns the same 404 for a missing post, a malformed id, and a post by someone who blocked you", async () => {
    const author = await member();
    const reader = await member();
    const post = await postAs(author);
    await call(author, "POST", `/users/${reader.username}/block`);
    const blocked = await call(reader, "GET", `/posts/${post.id}`);
    const missing = await call(reader, "GET", `/posts/${randomUUID()}`);
    const malformed = await call(reader, "GET", "/posts/xyz");
    expect([blocked.status, missing.status, malformed.status]).toEqual([404, 404, 404]);
    expect(blocked.body.error).toBe(missing.body.error);
    expect((await call(reader, "GET", `/media/posts/${post.id}`)).status).toBe(404);
  });

  it("does not serve the image of a post whose author is no longer a visible member", async () => {
    const author = await member();
    const reader = await member();
    const post = await postAs(author);
    await db.update(users).set({ accountStatus: "suspended" }).where(eq(users.id, author.id));
    expect((await call(reader, "GET", `/posts/${post.id}`)).status).toBe(404);
    expect((await call(reader, "GET", `/media/posts/${post.id}`)).status).toBe(404);
  });
});

describe("8/9. private messages require a mutual follow, checked on the server", () => {
  it("refuses to start a conversation when the follow is one-way or absent", async () => {
    const a = await member();
    const b = await member();
    const none = await call(a, "POST", "/conversations", { username: b.username });
    expect(none.status).toBe(403);
    expect(none.body.code).toBe("not_mutual");

    await followAs(a, b);
    const oneWay = await call(a, "POST", "/conversations", { username: b.username });
    expect(oneWay.status).toBe(403);
    const reverse = await call(b, "POST", "/conversations", { username: a.username });
    expect(reverse.status).toBe(403);
    // Nothing was created by the refused attempts.
    expect(await db.select().from(conversations).where(or(eq(conversations.userAId, a.id), eq(conversations.userBId, a.id)))).toHaveLength(0);
  });

  it("starts one conversation per pair once both follow each other, and sends and receives messages", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);

    const started = await call(a, "POST", "/conversations", { username: b.username });
    expect(started.status).toBe(201);
    const again = await call(b, "POST", "/conversations", { username: a.username });
    expect(again.body.id).toBe(started.body.id);
    const id: string = started.body.id;

    const sent = await call(a, "POST", `/conversations/${id}/messages`, { content: "hi b!" });
    expect(sent.status).toBe(201);
    expect(sent.body.message).toMatchObject({ content: "hi b!", fromMe: true, senderUsername: a.username });

    const reply = await call(b, "POST", `/conversations/${id}/messages`, { content: "hello a" });
    expect(reply.body.message.fromMe).toBe(true);

    const history = await call(a, "GET", `/conversations/${id}/messages`);
    expect(history.body.canSend).toBe(true);
    expect(history.body.items.map((m: { content: string }) => m.content)).toEqual(["hello a", "hi b!"]);
    expect(history.body.items[0].fromMe).toBe(false);
    expect(history.body.other.username).toBe(b.username);
    expect(typeof history.body.items[0].createdAt).toBe("string");
  });

  it("lists conversations with last message, timestamps and unread counts, and clears them on read", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    const id = (await call(a, "POST", "/conversations", { username: b.username })).body.id;
    await call(a, "POST", `/conversations/${id}/messages`, { content: "one" });
    await call(a, "POST", `/conversations/${id}/messages`, { content: "two" });

    const asB = (await call(b, "GET", "/conversations")).body.items[0];
    expect(asB).toMatchObject({ id, unreadCount: 2, canSend: true });
    expect(asB.other.username).toBe(a.username);
    expect(asB.lastMessage).toMatchObject({ content: "two", fromMe: false });
    expect((await call(a, "GET", "/conversations")).body.items[0].unreadCount).toBe(0);
    expect((await call(b, "GET", "/unread-counts")).body.messages).toBe(2);

    expect((await call(b, "POST", `/conversations/${id}/read`)).status).toBe(200);
    expect((await call(b, "GET", "/conversations")).body.items[0].unreadCount).toBe(0);
    expect((await call(b, "GET", "/unread-counts")).body.messages).toBe(0);
  });

  it("paginates message history, newest first", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    const id = (await call(a, "POST", "/conversations", { username: b.username })).body.id;
    for (let i = 1; i <= 5; i++) await call(i % 2 ? a : b, "POST", `/conversations/${id}/messages`, { content: `m${i}` });
    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Result = await call(a, "GET", `/conversations/${id}/messages?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      collected.push(...res.body.items.map((m: { content: string }) => m.content));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(collected).toEqual(["m5", "m4", "m3", "m2", "m1"]);
    expect(pages).toBe(3);
  });

  it("validates message content", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    const id = (await call(a, "POST", "/conversations", { username: b.username })).body.id;
    for (const body of [{}, { content: "" }, { content: "   " }, { content: "x".repeat(2001) }, { content: "bell\u0007" }, { content: 5 }, { postId: "nope" }]) {
      expect((await call(a, "POST", `/conversations/${id}/messages`, body)).status).toBe(400);
    }
    expect((await call(a, "POST", `/conversations/${id}/messages`, { content: "x".repeat(2000) })).status).toBe(201);
  });

  it("keeps conversations private: outsiders cannot read, send, mark read, or even tell it exists", async () => {
    const a = await member();
    const b = await member();
    const outsider = await member();
    await mutualFollow(a, b);
    await mutualFollow(outsider, a);
    await mutualFollow(outsider, b);
    const id = (await call(a, "POST", "/conversations", { username: b.username })).body.id;
    await call(a, "POST", `/conversations/${id}/messages`, { content: "secret" });

    for (const res of [
      await call(outsider, "GET", `/conversations/${id}/messages`),
      await call(outsider, "POST", `/conversations/${id}/messages`, { content: "intrude" }),
      await call(outsider, "POST", `/conversations/${id}/read`),
    ]) {
      expect(res.status).toBe(404);
    }
    expect((await call(outsider, "GET", `/conversations/${randomUUID()}/messages`)).status).toBe(404);
    expect((await call(outsider, "GET", "/conversations")).body.items.every((c: { id: string }) => c.id !== id)).toBe(true);
    expect(JSON.stringify((await call(outsider, "GET", "/conversations")).body)).not.toContain("secret");
  });

  it("cannot impersonate another member: the sender is always the caller", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    const id = (await call(a, "POST", "/conversations", { username: b.username })).body.id;
    const res = await call(a, "POST", `/conversations/${id}/messages`, { content: "from a", senderId: b.id, senderUsername: b.username, userId: b.id, fromMe: false });
    expect(res.body.message.senderUsername).toBe(a.username);
    expect(res.body.message.fromMe).toBe(true);
    const row = await db.query.directMessages.findFirst({ where: (m, { eq: equals }) => equals(m.id, res.body.message.id) });
    expect(row!.senderId).toBe(a.id);
  });

  it("re-checks the follow on every send: unfollowing ends sending but keeps history readable", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    const id = (await call(a, "POST", "/conversations", { username: b.username })).body.id;
    await call(a, "POST", `/conversations/${id}/messages`, { content: "before" });

    await call(b, "DELETE", `/users/${a.username}/follow`);
    for (const sender of [a, b]) {
      const denied = await call(sender, "POST", `/conversations/${id}/messages`, { content: "after" });
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("not_mutual");
    }
    const history = await call(a, "GET", `/conversations/${id}/messages`);
    expect(history.status).toBe(200);
    expect(history.body.canSend).toBe(false);
    expect(history.body.items.map((m: { content: string }) => m.content)).toEqual(["before"]);
    expect((await call(a, "GET", "/conversations")).body.items[0].canSend).toBe(false);

    await followAs(b, a);
    expect((await call(a, "POST", `/conversations/${id}/messages`, { content: "back" })).status).toBe(201);
  });

  it("will not message yourself, a missing member, or an ineligible member", async () => {
    const a = await member();
    const unverified = await member({ verified: false });
    expect((await call(a, "POST", "/conversations", { username: a.username })).status).toBe(400);
    expect((await call(a, "POST", "/conversations", { username: "nobody_here_zz" })).status).toBe(404);
    expect((await call(a, "POST", "/conversations", { username: unverified.username })).status).toBe(404);
  });

  it("shares a post into a conversation, and hides it from anyone who could not open it", async () => {
    const a = await member();
    const b = await member();
    const author = await member();
    await mutualFollow(a, b);
    const post = await postAs(author, "look at this");
    const id = (await call(a, "POST", "/conversations", { username: b.username })).body.id;

    const shared = await call(a, "POST", `/conversations/${id}/messages`, { postId: post.id, content: "check it" });
    expect(shared.status).toBe(201);
    expect(shared.body.message.sharedPost).toMatchObject({ id: post.id, caption: "look at this", authorUsername: author.username });
    expect((await call(b, "GET", `/conversations/${id}/messages`)).body.items[0].sharedPost.id).toBe(post.id);

    // Sharing without text is allowed; sharing nothing is not.
    expect((await call(a, "POST", `/conversations/${id}/messages`, { postId: post.id })).status).toBe(201);
    expect((await call(a, "POST", `/conversations/${id}/messages`, { postId: randomUUID() })).status).toBe(404);

    // The recipient blocks the author: the old share is no longer revealed.
    await call(b, "POST", `/users/${author.username}/block`);
    const after = (await call(b, "GET", `/conversations/${id}/messages`)).body.items[0];
    expect(after.sharedPost).toBeNull();
    expect(after.sharedPostUnavailable).toBe(true);
    // And a post by someone the recipient has blocked cannot be sent to them.
    expect((await call(a, "POST", `/conversations/${id}/messages`, { postId: post.id })).status).toBe(404);
  });
});

describe("10/11. blocking", () => {
  it("makes each member invisible to the other and removes existing follows", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    const post = await postAs(a, "before block");
    await postAs(b, "b's post");

    expect((await call(a, "POST", `/users/${b.username}/block`)).body).toEqual({ blocked: true });
    expect(await db.select().from(follows).where(inArray(follows.followerId, [a.id, b.id]))).toHaveLength(0);
    expect(await db.select().from(blocks).where(and(eq(blocks.blockerUserId, a.id), eq(blocks.blockedUserId, b.id)))).toHaveLength(1);

    for (const [viewer, other] of [[a, b], [b, a]] as const) {
      expect((await call(viewer, "GET", `/users/${other.username}`)).status).toBe(404);
      expect((await call(viewer, "GET", `/users/${other.username}/posts`)).status).toBe(404);
      expect((await call(viewer, "POST", `/users/${other.username}/follow`)).status).toBe(404);
      const search = await call(viewer, "GET", `/search?q=${other.username!.slice(0, 6)}`);
      expect(search.body.users.map((u: { username: string }) => u.username)).not.toContain(other.username);
    }
    expect((await call(b, "GET", `/posts/${post.id}`)).status).toBe(404);
    expect((await call(b, "POST", `/posts/${post.id}/like`)).status).toBe(404);
    expect((await call(b, "POST", `/posts/${post.id}/comments`, { content: "hi" })).status).toBe(404);
    const feedB = (await call(b, "GET", "/feed")).body.items.map((p: { caption: string }) => p.caption);
    expect(feedB).not.toContain("before block");
  });

  it("prevents any messaging between blocked members, in both directions, including old conversations", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    const id = (await call(a, "POST", "/conversations", { username: b.username })).body.id;
    await call(a, "POST", `/conversations/${id}/messages`, { content: "hi" });

    await call(b, "POST", `/users/${a.username}/block`);
    for (const viewer of [a, b]) {
      expect((await call(viewer, "POST", `/conversations/${id}/messages`, { content: "x" })).status).toBe(404);
      expect((await call(viewer, "GET", `/conversations/${id}/messages`)).status).toBe(404);
      expect((await call(viewer, "GET", "/conversations")).body.items).toHaveLength(0);
    }
    // Even if the follows were somehow restored (e.g. direct data change), the block still wins.
    await db.insert(follows).values([{ followerId: a.id, followeeId: b.id }, { followerId: b.id, followeeId: a.id }]);
    expect((await call(a, "POST", `/conversations/${id}/messages`, { content: "x" })).status).toBe(404);
    expect((await call(a, "POST", "/conversations", { username: b.username })).status).toBe(404);
    expect((await call(b, "POST", "/conversations", { username: a.username })).status).toBe(404);
  });

  it("unblocking restores visibility but not the follows, and you cannot block yourself", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    await call(a, "POST", `/users/${b.username}/block`);
    expect((await call(a, "DELETE", `/users/${b.username}/block`)).body).toEqual({ blocked: false });
    expect((await call(a, "GET", `/users/${b.username}`)).body.profile).toMatchObject({ isFollowing: false, followsYou: false });
    expect((await call(a, "POST", `/users/${a.username}/block`)).status).toBe(400);
    expect((await call(a, "POST", "/users/nobody_zz/block")).status).toBe(404);
  });

  it("hides a blocked member's comments and likes-based notifications from the viewer", async () => {
    const owner = await member();
    const troll = await member();
    const post = await postAs(owner);
    await call(troll, "POST", `/posts/${post.id}/comments`, { content: "rude" });
    expect((await call(owner, "GET", `/posts/${post.id}/comments`)).body.items).toHaveLength(1);
    await call(owner, "POST", `/users/${troll.username}/block`);
    expect((await call(owner, "GET", `/posts/${post.id}/comments`)).body.items).toHaveLength(0);
    expect((await call(owner, "GET", "/notifications")).body.items).toHaveLength(0);
  });
});

describe("notifications", () => {
  it("notifies for follows, likes, comments and messages, once each, and only the recipient sees them", async () => {
    const a = await member();
    const b = await member();
    const post = await postAs(a);

    await followAs(b, a);
    await call(b, "POST", `/posts/${post.id}/like`);
    await call(b, "POST", `/posts/${post.id}/comments`, { content: "nice!" });
    await followAs(a, b);
    const id = (await call(b, "POST", "/conversations", { username: a.username })).body.id;
    await call(b, "POST", `/conversations/${id}/messages`, { content: "hey" });

    const list = (await call(a, "GET", "/notifications")).body.items as Array<{ type: string; actor: { username: string }; commentPreview: string | null; postId: string | null; conversationId: string | null; read: boolean }>;
    expect(list.map((n) => n.type).sort()).toEqual(["comment", "follow", "like", "message"]);
    expect(list.every((n) => n.actor.username === b.username && n.read === false)).toBe(true);
    expect(list.find((n) => n.type === "comment")!.commentPreview).toBe("nice!");
    expect(list.find((n) => n.type === "like")!.postId).toBe(post.id);
    expect(list.find((n) => n.type === "message")!.conversationId).toBe(id);
    expect((await call(a, "GET", "/unread-counts")).body.notifications).toBe(4);

    // b is never told about b's own actions, and cannot see a's notifications.
    expect((await call(b, "GET", "/notifications")).body.items.map((n: { type: string }) => n.type)).toEqual(["follow"]);
  });

  it("does not create duplicates when an action is retried", async () => {
    const a = await member();
    const b = await member();
    const post = await postAs(a);
    for (let i = 0; i < 3; i++) {
      await call(b, "POST", `/users/${a.username}/follow`);
      await call(b, "POST", `/posts/${post.id}/like`);
    }
    await call(b, "DELETE", `/users/${a.username}/follow`);
    await call(b, "POST", `/users/${a.username}/follow`);
    await call(b, "DELETE", `/posts/${post.id}/like`);
    await call(b, "POST", `/posts/${post.id}/like`);

    const rows = await db.select().from(notifications).where(eq(notifications.userId, a.id));
    expect(rows.filter((r) => r.type === "follow")).toHaveLength(1);
    expect(rows.filter((r) => r.type === "like")).toHaveLength(1);
  });

  it("keeps a single message notification per conversation and resurfaces it on a new message", async () => {
    const a = await member();
    const b = await member();
    await mutualFollow(a, b);
    const id = (await call(a, "POST", "/conversations", { username: b.username })).body.id;
    for (let i = 0; i < 3; i++) await call(a, "POST", `/conversations/${id}/messages`, { content: `m${i}` });
    const messageRows = () => db.select().from(notifications).where(and(eq(notifications.userId, b.id), eq(notifications.type, "message")));
    expect(await messageRows()).toHaveLength(1);

    await call(b, "POST", `/conversations/${id}/read`);
    expect((await messageRows())[0]!.readAt).not.toBeNull();
    await call(a, "POST", `/conversations/${id}/messages`, { content: "again" });
    const rows = await messageRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.readAt).toBeNull();
  });

  it("marks notifications read — all, or only those named — and paginates", async () => {
    const a = await member();
    const people: User[] = [];
    for (let i = 0; i < 5; i++) {
      const p = await member();
      people.push(p);
      await followAs(p, a);
    }
    expect((await call(a, "GET", "/unread-counts")).body.notifications).toBe(5);

    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res: Result = await call(a, "GET", `/notifications?limit=2${cursor ? `&cursor=${cursor}` : ""}`);
      collected.push(...res.body.items.map((n: { id: string }) => n.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(new Set(collected).size).toBe(5);

    await call(a, "POST", "/notifications/read", { ids: collected.slice(0, 2) });
    expect((await call(a, "GET", "/unread-counts")).body.notifications).toBe(3);
    await call(a, "POST", "/notifications/read", {});
    expect((await call(a, "GET", "/unread-counts")).body.notifications).toBe(0);

    // Someone else cannot mark a's notifications read.
    const intruder = await member();
    await call(people[0]!, "POST", `/users/${a.username}/follow`);
    const ids = (await call(a, "GET", "/notifications")).body.items.map((n: { id: string }) => n.id);
    await call(intruder, "POST", "/notifications/read", { ids });
    const stillRows = await db.select().from(notifications).where(and(eq(notifications.userId, a.id), inArray(notifications.id, ids)));
    expect(stillRows.every((r) => r.readAt !== null)).toBe(true);
    expect((await call(a, "POST", "/notifications/read", { ids: ["not-a-uuid"] })).status).toBe(400);
  });
});

describe("search and reporting", () => {
  it("finds members by username prefix or display name, excluding ineligible members, and needs 2+ characters", async () => {
    const tag = randomUUID().slice(0, 6);
    const viewer = await member();
    const match = await member({ username: `find_${tag}`, displayName: "Searchable Person" });
    await member({ username: `find_${tag}_x`, verified: false });
    const res = await call(viewer, "GET", `/search?q=find_${tag}`);
    expect(res.body.users.map((u: { username: string }) => u.username)).toEqual([match.username]);
    expect((await call(viewer, "GET", `/search?q=${encodeURIComponent("searchable pers")}`)).body.users.some((u: { username: string }) => u.username === match.username)).toBe(true);
    expect((await call(viewer, "GET", "/search?q=a")).status).toBe(400);
    // Wildcards are literal characters, not patterns.
    expect((await call(viewer, "GET", "/search?q=%25%25")).body.users).toEqual([]);
  });

  it("reports a member or a post, tying the report to the post, and only for things the reporter can see", async () => {
    const reporter = await member();
    const author = await member();
    const post = await postAs(author);

    const user = await call(reporter, "POST", `/users/${author.username}/report`, { reason: "harassment", description: "rude" });
    expect(user.status).toBe(201);
    const onPost = await call(reporter, "POST", `/posts/${post.id}/report`, { reason: "spam_scam" });
    expect(onPost.status).toBe(201);
    const row = await db.query.reports.findFirst({ where: eq(reports.id, onPost.body.reportId) });
    expect(row).toMatchObject({ reporterUserId: reporter.id, reportedUserId: author.id, postId: post.id, reason: "spam_scam" });

    expect((await call(reporter, "POST", `/users/${author.username}/report`, { reason: "nonsense" })).status).toBe(400);
    expect((await call(reporter, "POST", `/posts/${randomUUID()}/report`, { reason: "other" })).status).toBe(404);
    expect((await call(author, "POST", `/users/${author.username}/report`, { reason: "other" })).status).toBe(400);

    // The report survives the post being deleted.
    await call(author, "DELETE", `/posts/${post.id}`);
    expect((await db.query.reports.findFirst({ where: eq(reports.id, onPost.body.reportId) }))!.postId).toBeNull();
  });
});
