import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { matches, users } from "../db/schema.js";
import { initSocketServer } from "./index.js";
import { mintSocketTicket } from "../redis/socketTickets.js";

// Integration test: exercises real Postgres + Redis + a real Socket.IO
// server/client pair (the same stack used in dev), rather than mocks, since
// the behavior under test is authorization across the actual socket
// middleware + room membership + DB-backed match state.

let serverUrl: string;
let httpServer: ReturnType<typeof createServer>;

const testUserIds: string[] = [];
const testMatchIds: string[] = [];

async function createVerifiedUser(email: string) {
  const [user] = await db
    .insert(users)
    .values({
      email,
      passwordHash: "test-hash-not-used",
      displayName: email,
      ageConfirmed18: true,
      verificationStatus: "verified",
    })
    .returning();
  testUserIds.push(user.id);
  return user;
}

async function createActiveMatch(userAId: string, userBId: string) {
  const [match] = await db.insert(matches).values({ userAId, userBId, status: "active" }).returning();
  testMatchIds.push(match.id);
  return match;
}

async function connectAs(userId: string): Promise<ClientSocket> {
  const ticket = await mintSocketTicket(userId);
  return new Promise((resolve, reject) => {
    const socket = ioClient(serverUrl, { auth: { ticket } });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<unknown> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 1500): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function didNotReceive(socket: ClientSocket, event: string, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), timeoutMs);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

beforeAll(async () => {
  httpServer = createServer();
  initSocketServer(httpServer);
  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  serverUrl = `http://localhost:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  if (testUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
});

describe("WebRTC call signaling", () => {
  it("relays offer/answer/ICE candidates only to the other match participant", async () => {
    const userA = await createVerifiedUser("call-test-a@example.com");
    const userB = await createVerifiedUser("call-test-b@example.com");
    const match = await createActiveMatch(userA.id, userB.id);

    const socketA = await connectAs(userA.id);
    const socketB = await connectAs(userB.id);

    await emitAck(socketA, "chat:join", { matchId: match.id });
    await emitAck(socketB, "chat:join", { matchId: match.id });

    const offer = { type: "offer", sdp: "v=0 fake-offer-sdp" };
    const answer = { type: "answer", sdp: "v=0 fake-answer-sdp" };
    const candidate = { candidate: "candidate:1 1 UDP 1 1.2.3.4 1234 typ host", sdpMid: "0", sdpMLineIndex: 0 };

    const bGotOffer = waitForEvent<{ sdp: unknown; from: string }>(socketB, "call:offer");
    socketA.emit("call:offer", { matchId: match.id, sdp: offer });
    const offerPayload = await bGotOffer;
    expect(offerPayload.from).toBe(userA.id);
    expect(offerPayload.sdp).toEqual(offer);

    const aGotAnswer = waitForEvent<{ sdp: unknown; from: string }>(socketA, "call:answer");
    socketB.emit("call:answer", { matchId: match.id, sdp: answer });
    const answerPayload = await aGotAnswer;
    expect(answerPayload.from).toBe(userB.id);
    expect(answerPayload.sdp).toEqual(answer);

    const bGotCandidate = waitForEvent<{ candidate: unknown; from: string }>(socketB, "call:ice-candidate");
    socketA.emit("call:ice-candidate", { matchId: match.id, candidate });
    const candidatePayload = await bGotCandidate;
    expect(candidatePayload.from).toBe(userA.id);
    expect(candidatePayload.candidate).toEqual(candidate);

    socketA.disconnect();
    socketB.disconnect();
  });

  it("does not relay signaling to or from a user outside the match", async () => {
    const userA = await createVerifiedUser("call-test-c@example.com");
    const userB = await createVerifiedUser("call-test-d@example.com");
    const outsider = await createVerifiedUser("call-test-outsider@example.com");
    const match = await createActiveMatch(userA.id, userB.id);

    const socketA = await connectAs(userA.id);
    const socketB = await connectAs(userB.id);
    const socketOutsider = await connectAs(outsider.id);

    await emitAck(socketA, "chat:join", { matchId: match.id });
    await emitAck(socketB, "chat:join", { matchId: match.id });

    // The outsider is rejected from even joining the match's room.
    const outsiderJoin = await emitAck(socketOutsider, "chat:join", { matchId: match.id });
    expect(outsiderJoin).toEqual({ ok: false, error: "You are not part of this match." });

    // Outsider attempts to inject a call offer for a match they don't belong
    // to — neither real participant should receive it.
    const aNoOffer = didNotReceive(socketA, "call:offer");
    const bNoOffer = didNotReceive(socketB, "call:offer");
    socketOutsider.emit("call:offer", { matchId: match.id, sdp: { type: "offer", sdp: "malicious" } });
    expect(await aNoOffer).toBe(true);
    expect(await bNoOffer).toBe(true);

    socketA.disconnect();
    socketB.disconnect();
    socketOutsider.disconnect();
  });

  it("stops relaying signaling once the match has ended (cleanup)", async () => {
    const userA = await createVerifiedUser("call-test-e@example.com");
    const userB = await createVerifiedUser("call-test-f@example.com");
    const match = await createActiveMatch(userA.id, userB.id);

    const socketA = await connectAs(userA.id);
    const socketB = await connectAs(userB.id);

    await emitAck(socketA, "chat:join", { matchId: match.id });
    await emitAck(socketB, "chat:join", { matchId: match.id });

    const bGotEnded = waitForEvent(socketB, "chat:ended");
    const endAck = await emitAck(socketA, "chat:end", { matchId: match.id });
    expect(endAck).toEqual({ ok: true });
    await bGotEnded;

    const [row] = await db.select().from(matches).where(eq(matches.id, match.id));
    expect(row.status).toBe("ended");

    const bNoOffer = didNotReceive(socketB, "call:offer");
    socketA.emit("call:offer", { matchId: match.id, sdp: { type: "offer", sdp: "too-late" } });
    expect(await bNoOffer).toBe(true);

    socketA.disconnect();
    socketB.disconnect();
  });
});
