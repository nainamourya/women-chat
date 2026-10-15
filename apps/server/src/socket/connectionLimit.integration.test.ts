import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { Server as SocketIOServer } from "socket.io";
import { inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { mintSocketTicket } from "../redis/socketTickets.js";
import { createRedisAdapter } from "./redisAdapter.js";
import { authenticateSocket, registerConnectionHandlers } from "./index.js";

// Integration test: exercises the real authenticateSocket/
// registerConnectionHandlers pieces (the same ones initSocketServer uses in
// production) against real Postgres and real Redis — not mocks — matching
// the convention established in call.integration.test.ts and the other
// Phase 2/3 integration tests.

const testUserIds: string[] = [];

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

type Instance = {
  httpServer: ReturnType<typeof createServer>;
  io: SocketIOServer;
  url: string;
};

async function startInstance(connectionLimit: number): Promise<Instance> {
  const httpServer = createServer();
  const adapterHandles = await createRedisAdapter();
  const io = new SocketIOServer(httpServer, { adapter: adapterHandles.adapter });
  io.use(authenticateSocket(connectionLimit));
  io.on("connection", (socket) => registerConnectionHandlers(socket));

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { httpServer, io, url: `http://localhost:${port}` };
}

async function connectAs(url: string, userId: string): Promise<ClientSocket> {
  const ticket = await mintSocketTicket(userId);
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { auth: { ticket }, transports: ["websocket"], reconnection: false });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
}

function waitForDisconnect(socket: ClientSocket): Promise<void> {
  return new Promise((resolve) => socket.once("disconnect", () => resolve()));
}

afterAll(async () => {
  if (testUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
});

describe("concurrent Socket.IO connection limit (single instance)", () => {
  it("admits connections up to the configured limit, rejects the one after with a clear message", async () => {
    const instance = await startInstance(2);
    try {
      const user = await createVerifiedUser(`connlimit-a-${Date.now()}@example.com`);

      const socket1 = await connectAs(instance.url, user.id);
      const socket2 = await connectAs(instance.url, user.id);

      const ticket = await mintSocketTicket(user.id);
      await expect(
        new Promise((resolve, reject) => {
          const s = ioClient(instance.url, { auth: { ticket }, transports: ["websocket"], reconnection: false });
          s.once("connect", () => reject(new Error("should not have connected")));
          s.once("connect_error", reject);
        }),
      ).rejects.toThrow(/Too many active connections/);

      socket1.disconnect();
      socket2.disconnect();
    } finally {
      await instance.io.close();
    }
  }, 15_000);

  it("frees a slot on disconnect, letting a new connection in right away", async () => {
    const instance = await startInstance(1);
    try {
      const user = await createVerifiedUser(`connlimit-b-${Date.now()}@example.com`);

      const socket1 = await connectAs(instance.url, user.id);

      const ticketReject = await mintSocketTicket(user.id);
      await expect(
        new Promise((resolve, reject) => {
          const s = ioClient(instance.url, { auth: { ticket: ticketReject }, transports: ["websocket"], reconnection: false });
          s.once("connect", () => resolve(undefined));
          s.once("connect_error", reject);
        }),
      ).rejects.toThrow();

      const disconnected = waitForDisconnect(socket1);
      socket1.disconnect();
      await disconnected;
      // Give the server a brief moment to process the disconnect and
      // release the Redis-backed lease before trying again.
      await new Promise((resolve) => setTimeout(resolve, 300));

      const socket2 = await connectAs(instance.url, user.id);
      expect(socket2.connected).toBe(true);

      socket2.disconnect();
    } finally {
      await instance.io.close();
    }
  }, 15_000);

  it("keeps limits independent per user", async () => {
    const instance = await startInstance(1);
    try {
      const userA = await createVerifiedUser(`connlimit-c-${Date.now()}@example.com`);
      const userB = await createVerifiedUser(`connlimit-d-${Date.now()}@example.com`);

      const socketA = await connectAs(instance.url, userA.id);
      const socketB = await connectAs(instance.url, userB.id);
      expect(socketA.connected).toBe(true);
      expect(socketB.connected).toBe(true);

      socketA.disconnect();
      socketB.disconnect();
    } finally {
      await instance.io.close();
    }
  }, 15_000);
});

describe("concurrent Socket.IO connection limit is shared across backend instances", () => {
  it("rejects a connection on a different instance once the shared limit is reached", async () => {
    const instanceA = await startInstance(2);
    const instanceB = await startInstance(2);
    try {
      const user = await createVerifiedUser(`connlimit-cross-${Date.now()}@example.com`);

      const socket1 = await connectAs(instanceA.url, user.id);
      const socket2 = await connectAs(instanceB.url, user.id);

      // Both slots are now consumed — one on each instance. A third
      // connection attempt, to either instance, must be rejected. If the
      // limit were process-local instead of Redis-backed, instance A would
      // wrongly think only 1 slot (its own) was in use and admit this.
      const ticket = await mintSocketTicket(user.id);
      await expect(
        new Promise((resolve, reject) => {
          const s = ioClient(instanceA.url, { auth: { ticket }, transports: ["websocket"], reconnection: false });
          s.once("connect", () => resolve(undefined));
          s.once("connect_error", reject);
        }),
      ).rejects.toThrow(/Too many active connections/);

      socket1.disconnect();
      socket2.disconnect();
    } finally {
      await Promise.all([instanceA.io.close(), instanceB.io.close()]);
    }
  }, 15_000);
});
