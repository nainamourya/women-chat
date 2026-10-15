import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { Server as SocketIOServer } from "socket.io";
import { inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { matches, users } from "../db/schema.js";
import { mintSocketTicket } from "../redis/socketTickets.js";
import { createRedisAdapter } from "./redisAdapter.js";
import { authenticateSocket, registerConnectionHandlers } from "./index.js";

// Integration test: exercises the real auth/chat/call handlers (via the
// exported authenticateSocket/registerConnectionHandlers, the same pieces
// initSocketServer itself uses), real Postgres and real Redis — rather than
// mocks or reimplemented handler logic, matching the convention established
// in call.integration.test.ts and multiInstance.integration.test.ts.

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

type Instance = {
  httpServer: ReturnType<typeof createServer>;
  io: SocketIOServer;
  url: string;
};

async function startInstance(): Promise<Instance> {
  const httpServer = createServer();
  const adapterHandles = await createRedisAdapter();
  const io = new SocketIOServer(httpServer, { adapter: adapterHandles.adapter });
  io.use(authenticateSocket());
  io.on("connection", (socket) => registerConnectionHandlers(socket));

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { httpServer, io, url: `http://localhost:${port}` };
}

async function connectAs(url: string, userId: string): Promise<ClientSocket> {
  const ticket = await mintSocketTicket(userId);
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { auth: { ticket }, transports: ["websocket"] });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", reject);
  });
}

function emitAck(socket: ClientSocket, event: string, payload: unknown): Promise<any> {
  return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitForEvent<T>(socket: ClientSocket, event: string, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function didNotReceive(socket: ClientSocket, event: string, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), timeoutMs);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

afterAll(async () => {
  if (testUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
});

describe("chat message rate limiting (single instance)", () => {
  it("allows a normal conversational burst, then blocks sustained spam without persisting the blocked message", async () => {
    const instance = await startInstance();
    try {
      const userA = await createVerifiedUser(`chatlimit-a-${Date.now()}@example.com`);
      const userB = await createVerifiedUser(`chatlimit-b-${Date.now()}@example.com`);
      const match = await createActiveMatch(userA.id, userB.id);

      const socketA = await connectAs(instance.url, userA.id);
      const socketB = await connectAs(instance.url, userB.id);
      await emitAck(socketA, "chat:join", { matchId: match.id });
      await emitAck(socketB, "chat:join", { matchId: match.id });

      for (let i = 0; i < 10; i++) {
        const ack = await emitAck(socketA, "chat:message", { matchId: match.id, content: `msg ${i}` });
        expect(ack.ok).toBe(true);
      }

      const rateLimited = waitForEvent<{ event: string }>(socketA, "rate_limited");
      const blockedAck = await emitAck(socketA, "chat:message", { matchId: match.id, content: "one too many" });
      expect(blockedAck.ok).toBe(false);
      await expect(rateLimited).resolves.toEqual({ event: "chat:message", retryAfterSeconds: expect.any(Number) });

      // The blocked message must never reach the other participant.
      const bNoMessage = didNotReceive(socketB, "chat:message");
      expect(await bNoMessage).toBe(true);

      socketA.disconnect();
      socketB.disconnect();
    } finally {
      await instance.io.close();
    }
  }, 15_000);

  it("throttles typing indicator flooding without breaking normal use", async () => {
    const instance = await startInstance();
    try {
      const userA = await createVerifiedUser(`typelimit-a-${Date.now()}@example.com`);
      const userB = await createVerifiedUser(`typelimit-b-${Date.now()}@example.com`);
      const match = await createActiveMatch(userA.id, userB.id);

      const socketA = await connectAs(instance.url, userA.id);
      const socketB = await connectAs(instance.url, userB.id);
      await emitAck(socketA, "chat:join", { matchId: match.id });
      await emitAck(socketB, "chat:join", { matchId: match.id });

      const firstTyping = waitForEvent(socketB, "chat:typing_start");
      socketA.emit("chat:typing_start", { matchId: match.id });
      await expect(firstTyping).resolves.toEqual({ userId: userA.id });

      // Flood well past the typing limit.
      for (let i = 0; i < 10; i++) {
        socketA.emit("chat:typing_start", { matchId: match.id });
      }

      // At least one flood event should have been silently dropped — proven
      // by the sender receiving a rate_limited notice for the event.
      const rateLimited = await waitForEvent<{ event: string }>(socketA, "rate_limited");
      expect(rateLimited.event).toBe("chat:typing_start");

      socketA.disconnect();
      socketB.disconnect();
    } finally {
      await instance.io.close();
    }
  }, 15_000);

  it("preserves WebRTC ICE candidate bursts — never rate-limited", async () => {
    const instance = await startInstance();
    try {
      const userA = await createVerifiedUser(`icelimit-a-${Date.now()}@example.com`);
      const userB = await createVerifiedUser(`icelimit-b-${Date.now()}@example.com`);
      const match = await createActiveMatch(userA.id, userB.id);

      const socketA = await connectAs(instance.url, userA.id);
      const socketB = await connectAs(instance.url, userB.id);
      await emitAck(socketA, "chat:join", { matchId: match.id });
      await emitAck(socketB, "chat:join", { matchId: match.id });

      const CANDIDATE_COUNT = 40;
      let received = 0;
      const allReceived = new Promise<void>((resolve) => {
        socketB.on("call:ice-candidate", () => {
          received++;
          if (received === CANDIDATE_COUNT) resolve();
        });
      });

      for (let i = 0; i < CANDIDATE_COUNT; i++) {
        socketA.emit("call:ice-candidate", {
          matchId: match.id,
          candidate: { candidate: `candidate:${i} 1 UDP 1 1.2.3.4 1234 typ host`, sdpMid: "0", sdpMLineIndex: 0 },
        });
      }

      await allReceived;
      expect(received).toBe(CANDIDATE_COUNT);

      socketA.disconnect();
      socketB.disconnect();
    } finally {
      await instance.io.close();
    }
  }, 15_000);
});

describe("chat message rate limiting is shared across backend instances", () => {
  it("exhausting the limit on one instance blocks the same user reconnected to a different instance", async () => {
    const instanceA = await startInstance();
    const instanceB = await startInstance();
    try {
      const userA = await createVerifiedUser(`crosslimit-a-${Date.now()}@example.com`);
      const userB = await createVerifiedUser(`crosslimit-b-${Date.now()}@example.com`);
      const match = await createActiveMatch(userA.id, userB.id);

      // userA connects to instance A, userB connects to instance B — a real
      // cross-instance match, same as production once horizontally scaled.
      const socketA = await connectAs(instanceA.url, userA.id);
      const socketB = await connectAs(instanceB.url, userB.id);
      await emitAck(socketA, "chat:join", { matchId: match.id });
      await emitAck(socketB, "chat:join", { matchId: match.id });

      for (let i = 0; i < 10; i++) {
        const ack = await emitAck(socketA, "chat:message", { matchId: match.id, content: `msg ${i}` });
        expect(ack.ok).toBe(true);
      }
      const blockedOnA = await emitAck(socketA, "chat:message", { matchId: match.id, content: "blocked on A" });
      expect(blockedOnA.ok).toBe(false);

      socketA.disconnect();

      // Reconnect as the SAME user, but to instance B this time. If the
      // limit were process-local instead of Redis-backed, this would be
      // allowed (a fresh, empty counter on instance B) — it must not be.
      const socketAonB = await connectAs(instanceB.url, userA.id);
      await emitAck(socketAonB, "chat:join", { matchId: match.id });
      const blockedOnB = await emitAck(socketAonB, "chat:message", { matchId: match.id, content: "should stay blocked" });
      expect(blockedOnB.ok).toBe(false);

      socketAonB.disconnect();
      socketB.disconnect();
    } finally {
      await Promise.all([instanceA.io.close(), instanceB.io.close()]);
    }
  }, 15_000);
});
