import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { inArray } from "drizzle-orm";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { closeDb, db } from "../db/client.js";
import { users, type User } from "../db/schema.js";
import { env } from "../config/env.js";
import { mintSocketTicket } from "../redis/socketTickets.js";
import { socialRouter } from "../routes/social.js";
import { createMember } from "../testUtils/socialFixtures.js";
import { closeSocketServer, initSocketServer } from "./index.js";

// Real-time delivery of private messages and notifications through the real
// Socket.IO server, with REST used to send (as the web app does). Storage is
// not involved, but the module is mocked so nothing can reach R2.
vi.mock("../services/social/mediaStorage.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../services/social/mediaStorage.js")>();
  return { ...real, writeMedia: async () => undefined, readMedia: async () => Buffer.alloc(0), deleteMedia: async () => true };
});

const created: string[] = [];
const sockets: ClientSocket[] = [];
let baseUrl: string;
let httpServer: ReturnType<typeof createServer>;

beforeAll(async () => {
  const app = express();
  app.use(express.json({ limit: "8mb" }));
  app.use("/api/social", socialRouter);
  httpServer = createServer(app);
  await initSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  baseUrl = `http://localhost:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  for (const socket of sockets) socket.disconnect();
  await closeSocketServer();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  if (created.length > 0) await db.delete(users).where(inArray(users.id, created));
  await closeDb();
});

async function connectAs(user: User): Promise<ClientSocket> {
  const ticket = await mintSocketTicket(user.id);
  const socket = await new Promise<ClientSocket>((resolve, reject) => {
    const s = ioClient(baseUrl, { auth: { ticket }, transports: ["websocket"] });
    s.on("connect", () => resolve(s));
    s.on("connect_error", reject);
  });
  sockets.push(socket);
  return socket;
}

async function api(viewer: User, method: string, path: string, body?: unknown) {
  const res = await fetch(`${baseUrl}/api/social${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET, "x-viewer-id": viewer.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json().catch(() => null)) as any };
}

// Collects every `event` a socket receives from now on.
function record(socket: ClientSocket, event: string) {
  const received: any[] = [];
  socket.on(event, (payload) => received.push(payload));
  return received;
}

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitUntil(predicate: () => boolean, timeoutMs = 3000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for a real-time event");
    await settle(25);
  }
}

async function mutualPair() {
  const a = await createMember(created);
  const b = await createMember(created);
  await api(a, "POST", `/users/${b.username}/follow`);
  await api(b, "POST", `/users/${a.username}/follow`);
  const conversationId: string = (await api(a, "POST", "/conversations", { username: b.username })).body.id;
  return { a, b, conversationId };
}

describe("real-time private messages", () => {
  it("delivers a new message to both participants' sockets, each from their own point of view", async () => {
    const { a, b, conversationId } = await mutualPair();
    const sockA = await connectAs(a);
    const sockB = await connectAs(b);
    const gotA = record(sockA, "dm:message");
    const gotB = record(sockB, "dm:message");

    const sent = await api(a, "POST", `/conversations/${conversationId}/messages`, { content: "live hello" });
    expect(sent.status).toBe(201);
    await waitUntil(() => gotA.length === 1 && gotB.length === 1);

    expect(gotB[0]).toMatchObject({ conversationId, content: "live hello", fromMe: false, senderUsername: a.username });
    expect(gotA[0]).toMatchObject({ conversationId, content: "live hello", fromMe: true, senderUsername: a.username });
    expect(gotB[0].id).toBe(sent.body.message.id);
  });

  it("delivers to every open device of a member, and to nobody else", async () => {
    const { a, b, conversationId } = await mutualPair();
    const outsider = await createMember(created);
    const phoneB = await connectAs(b);
    const laptopB = await connectAs(b);
    const sockOutsider = await connectAs(outsider);
    const gotPhone = record(phoneB, "dm:message");
    const gotLaptop = record(laptopB, "dm:message");
    const gotOutsider = record(sockOutsider, "dm:message");
    const outsiderNotifications = record(sockOutsider, "notification:new");

    await api(a, "POST", `/conversations/${conversationId}/messages`, { content: "for b only" });
    await waitUntil(() => gotPhone.length === 1 && gotLaptop.length === 1);
    await settle(500);

    expect(gotOutsider).toHaveLength(0);
    expect(outsiderNotifications).toHaveLength(0);
  });

  it("pushes a notification event to the recipient only", async () => {
    const { a, b, conversationId } = await mutualPair();
    const sockA = await connectAs(a);
    const sockB = await connectAs(b);
    const noteA = record(sockA, "notification:new");
    const noteB = record(sockB, "notification:new");

    await api(a, "POST", `/conversations/${conversationId}/messages`, { content: "ping" });
    await waitUntil(() => noteB.length >= 1);
    await settle(300);
    expect(noteB[0]).toEqual({ type: "message" });
    expect(noteA).toHaveLength(0);
  });

  it("pushes follow, like and comment notification events as they happen", async () => {
    const author = await createMember(created);
    const fan = await createMember(created);
    const sockAuthor = await connectAs(author);
    const notes = record(sockAuthor, "notification:new");

    await api(fan, "POST", `/users/${author.username}/follow`);
    await waitUntil(() => notes.length === 1);
    expect(notes[0]).toEqual({ type: "follow" });

    const post = (await api(author, "POST", "/posts", { caption: "x", imageBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9]).toString("base64"), mimeType: "image/jpeg" })).body.post;
    await api(fan, "POST", `/posts/${post.id}/like`);
    await waitUntil(() => notes.length === 2);
    expect(notes[1]).toEqual({ type: "like" });
    await api(fan, "POST", `/posts/${post.id}/comments`, { content: "nice" });
    await waitUntil(() => notes.length === 3);
    expect(notes[2]).toEqual({ type: "comment" });
  });

  it("emits nothing when a send is refused: not mutual, blocked, or a stranger", async () => {
    const { a, b, conversationId } = await mutualPair();
    const stranger = await createMember(created);
    const sockA = await connectAs(a);
    const sockB = await connectAs(b);
    const sockStranger = await connectAs(stranger);
    const gotA = record(sockA, "dm:message");
    const gotB = record(sockB, "dm:message");
    const gotStranger = record(sockStranger, "dm:message");

    // A stranger writing into someone else's conversation.
    expect((await api(stranger, "POST", `/conversations/${conversationId}/messages`, { content: "intrude" })).status).toBe(404);

    // The follow ends: nobody can send, and nothing is delivered.
    await api(b, "DELETE", `/users/${a.username}/follow`);
    expect((await api(a, "POST", `/conversations/${conversationId}/messages`, { content: "denied" })).status).toBe(403);
    expect((await api(b, "POST", `/conversations/${conversationId}/messages`, { content: "denied" })).status).toBe(403);

    // A block.
    await api(b, "POST", `/users/${a.username}/follow`);
    await api(b, "POST", `/users/${a.username}/block`);
    expect((await api(a, "POST", `/conversations/${conversationId}/messages`, { content: "blocked" })).status).toBe(404);

    await settle(600);
    expect(gotA).toHaveLength(0);
    expect(gotB).toHaveLength(0);
    expect(gotStranger).toHaveLength(0);
  });

  it("does not let a socket join someone else's private room by asking for it", async () => {
    const { a, b, conversationId } = await mutualPair();
    const attacker = await createMember(created);
    const sockAttacker = await connectAs(attacker);
    const gotAttacker = record(sockAttacker, "dm:message");
    // There is no client-side way to join a user room, and the old match-chat
    // join does not grant access to direct messages either.
    await new Promise((resolve) => sockAttacker.emit("chat:join", { matchId: conversationId }, resolve));
    sockAttacker.emit("join", `user:${a.id}`);
    sockAttacker.emit("dm:join", { conversationId });

    await api(a, "POST", `/conversations/${conversationId}/messages`, { content: "private" });
    await settle(600);
    expect(gotAttacker).toHaveLength(0);
    void b;
  });
});
