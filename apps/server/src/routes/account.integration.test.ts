import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import express from "express";
import { eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "../db/client.js";
import { comments, follows, posts, users, type User } from "../db/schema.js";
import { env } from "../config/env.js";
import { redis } from "../redis/client.js";
import { joinQueue } from "../redis/matchmakingQueue.js";
import { createMember } from "../testUtils/socialFixtures.js";
import { accountRouter } from "./account.js";
import { authRouter } from "./auth.js";
import { socialRouter } from "./social.js";

// Real router, PostgreSQL and Redis (the guarded local test instances). Image
// storage is replaced so no test can reach R2.
const removedMedia = vi.hoisted(() => [] as string[]);
vi.mock("../services/social/mediaStorage.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/social/mediaStorage.js")>();
  return { ...real, deleteMedia: async (key: string) => void removedMedia.push(key), writeMedia: async () => undefined };
});

const PASSWORD = "correct horse battery";
const created: string[] = [];
let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/account", accountRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/social", socialRouter);
  httpServer = createServer(app);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  if (created.length > 0) await db.delete(users).where(inArray(users.id, created));
  await redis.quit().catch(() => undefined);
  await closeDb();
});

async function withPassword(options: Parameters<typeof createMember>[1] = {}): Promise<User> {
  const user = await createMember(created, options);
  await db.update(users).set({ passwordHash: await bcrypt.hash(PASSWORD, 4) }).where(eq(users.id, user.id));
  return user;
}

async function request(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET, ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any, headers: res.headers };
}

const del = (body: unknown, headers?: Record<string, string>) => request("DELETE", "/api/account", body, headers);
const statusOf = async (id: string) => (await db.select().from(users).where(eq(users.id, id)))[0]!;

describe("DELETE /api/account — safeguards", () => {
  it("refuses a caller without the internal secret", async () => {
    const user = await withPassword();
    const res = await fetch(`${baseUrl}/api/account`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId: user.id, confirmation: "DELETE", password: PASSWORD }) });
    expect(res.status).toBe(401);
    expect((await statusOf(user.id)).accountStatus).toBe("active");
  });

  it.each([
    ["no body", undefined],
    ["a malformed user id", { userId: "nope", confirmation: "DELETE" }],
    ["a missing confirmation", { userId: randomUUID() }],
    ["a non-string password", { userId: randomUUID(), confirmation: "DELETE", password: 12345 }],
  ])("rejects %s with 400", async (_label, body) => {
    expect((await del(body)).status).toBe(400);
  });

  it.each(["", "delete", "Delete", "DELETE ", "YES", "DELETE\n"])("requires the exact confirmation word, not %j", async (confirmation) => {
    const user = await withPassword();
    const res = await del({ userId: user.id, confirmation, password: PASSWORD });
    expect(res.status).toBe(400);
    expect((await statusOf(user.id)).accountStatus).toBe("active");
  });

  it("requires the password for an account that has one, and does not delete on a wrong one", async () => {
    const user = await withPassword();
    const missing = await del({ userId: user.id, confirmation: "DELETE" });
    expect(missing.status).toBe(400);
    expect(missing.body.error).toMatch(/password/i);
    const wrong = await del({ userId: user.id, confirmation: "DELETE", password: "wrong password" });
    expect(wrong.status).toBe(403);
    expect(wrong.body.error).toMatch(/isn't correct/);
    expect((await statusOf(user.id)).accountStatus).toBe("active");
  });

  it("rate-limits attempts so the password cannot be guessed", async () => {
    const user = await withPassword();
    const statuses: number[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await del({ userId: user.id, confirmation: "DELETE", password: `guess ${i}` })).status);
    expect(statuses.slice(0, 5).every((s) => s === 403)).toBe(true);
    expect(statuses.slice(5)).toEqual([429, 429]);
    // Even the right password is refused while locked out, and nothing was deleted.
    const locked = await del({ userId: user.id, confirmation: "DELETE", password: PASSWORD });
    expect(locked.status).toBe(429);
    expect(locked.headers.get("retry-after")).toBeTruthy();
    expect((await statusOf(user.id)).accountStatus).toBe("active");
  });

  it("returns 404 for an account that does not exist", async () => {
    expect((await del({ userId: randomUUID(), confirmation: "DELETE", password: PASSWORD })).status).toBe(404);
  });
});

describe("DELETE /api/account — deleting", () => {
  it("deletes the account with the right password, erasing personal and social data", async () => {
    const user = await withPassword({ displayName: "Real Name" });
    const friend = await createMember(created);
    const avatarKey = `social/avatars/${randomUUID()}.jpg`;
    await db.update(users).set({ avatarKey, role: "admin" }).where(eq(users.id, user.id));
    const postId = randomUUID();
    await db.insert(posts).values({ id: postId, authorId: user.id, caption: "mine", imageKey: `social/posts/${postId}.jpg`, imageMimeType: "image/jpeg" });
    await db.insert(comments).values({ postId, authorId: friend.id, content: "nice" });
    await db.insert(follows).values({ followerId: friend.id, followeeId: user.id });

    const res = await del({ userId: user.id, confirmation: "DELETE", password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ alreadyDeleted: false });

    const row = await statusOf(user.id);
    expect(row).toMatchObject({ accountStatus: "deleted", displayName: "Deleted user", username: null, avatarKey: null, passwordHash: null, googleId: null, role: "user" });
    expect(row.email).toMatch(/^deleted-.*@deleted\.invalid$/);
    expect(await db.select().from(posts).where(eq(posts.authorId, user.id))).toHaveLength(0);
    expect(await db.select().from(follows).where(eq(follows.followeeId, user.id))).toHaveLength(0);
    expect(removedMedia).toEqual(expect.arrayContaining([`social/posts/${postId}.jpg`, avatarKey]));
  });

  it("deletes an account that signed up through Google (no password) with just the confirmation", async () => {
    const user = await createMember(created);
    // A Google sign-up has no password at all (the shared helper gives users a dummy hash).
    await db.update(users).set({ passwordHash: null }).where(eq(users.id, user.id));
    expect((await statusOf(user.id)).passwordHash).toBeNull();
    const res = await del({ userId: user.id, confirmation: "DELETE" });
    expect(res.status).toBe(200);
    expect((await statusOf(user.id)).accountStatus).toBe("deleted");
  });

  it("is idempotent: deleting twice succeeds, and the second call needs no password", async () => {
    const user = await withPassword();
    expect((await del({ userId: user.id, confirmation: "DELETE", password: PASSWORD })).status).toBe(200);
    const again = await del({ userId: user.id, confirmation: "DELETE" });
    expect(again.status).toBe(200);
    expect(again.body).toEqual({ alreadyDeleted: true });
  });

  it("removes the member from the matchmaking queue", async () => {
    const user = await withPassword();
    await joinQueue(user.id);
    expect(await redis.get(`mm:status:${user.id}`)).toBe("waiting");
    await del({ userId: user.id, confirmation: "DELETE", password: PASSWORD });
    expect(await redis.get(`mm:status:${user.id}`)).toBeNull();
  });

  it("leaves everyone else's account alone", async () => {
    const target = await withPassword();
    const bystander = await withPassword();
    await del({ userId: target.id, confirmation: "DELETE", password: PASSWORD });
    expect((await statusOf(bystander.id)).accountStatus).toBe("active");
    expect((await statusOf(bystander.id)).passwordHash).not.toBeNull();
  });
});

describe("after deletion", () => {
  it("the member can no longer use any social feature, and the web app is told the session is dead", async () => {
    const user = await withPassword();
    await del({ userId: user.id, confirmation: "DELETE", password: PASSWORD });

    const social = await request("GET", "/api/social/feed", undefined, { "x-viewer-id": user.id });
    expect(social.status).toBe(403);
    expect((await request("POST", "/api/social/posts", { imageBase64: "x", mimeType: "image/jpeg" }, { "x-viewer-id": user.id })).status).toBe(403);

    const status = await request("GET", `/api/auth/account-status/${user.id}`);
    expect(status.body).toEqual({ accountStatus: "deleted" });
  });

  it("the old password and email no longer log in", async () => {
    const user = await withPassword();
    const email = user.email;
    await del({ userId: user.id, confirmation: "DELETE", password: PASSWORD });
    const login = await request("POST", "/api/auth/login", { email, password: PASSWORD });
    expect(login.status).toBe(401);
  });

  it("a deleted admin loses admin rights", async () => {
    const admin = await withPassword();
    await db.update(users).set({ role: "admin" }).where(eq(users.id, admin.id));
    await del({ userId: admin.id, confirmation: "DELETE", password: PASSWORD });
    expect((await statusOf(admin.id)).role).toBe("user");
  });
});

describe("GET /api/auth/account-status/:userId", () => {
  it("reports the real status, 'deleted' for a member who no longer exists, and needs the secret", async () => {
    const active = await createMember(created);
    expect((await request("GET", `/api/auth/account-status/${active.id}`)).body).toEqual({ accountStatus: "active" });
    expect((await request("GET", `/api/auth/account-status/${randomUUID()}`)).body).toEqual({ accountStatus: "deleted" });
    expect((await request("GET", "/api/auth/account-status/not-a-uuid")).status).toBe(400);
    const noSecret = await fetch(`${baseUrl}/api/auth/account-status/${active.id}`);
    expect(noSecret.status).toBe(401);
  });
});
