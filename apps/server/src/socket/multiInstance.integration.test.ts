import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, describe, expect, it } from "vitest";
import { Server as SocketIOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { createRedisAdapter, type RedisAdapterHandles } from "./redisAdapter.js";

// Real multi-instance test: two independent Socket.IO servers (each its own
// HTTP server + its own dedicated Redis adapter pub/sub connections, per
// createRedisAdapter), both backed by the same Redis instance this project
// already uses. This exercises the actual adapter wiring this app depends on
// (room broadcasts and the "user:<id>" targeted-room pattern used by
// emitToUser) across two real, separate Socket.IO Server instances — rather
// than this app's full auth/chat/matchmaking handlers, which assume a single
// process-wide `io` singleton (see socket/index.ts) and so can't run twice
// in one test process. Proving the adapter itself works across instances is
// what makes those handlers safe to run on multiple real instances.

type Instance = {
  httpServer: ReturnType<typeof createServer>;
  io: SocketIOServer;
  adapterHandles: RedisAdapterHandles;
  url: string;
};

async function startInstance(): Promise<Instance> {
  const httpServer = createServer();
  const adapterHandles = await createRedisAdapter();
  const io = new SocketIOServer(httpServer, { adapter: adapterHandles.adapter });

  io.on("connection", (socket) => {
    socket.on("join", (room: string) => socket.join(room));
  });

  await new Promise<void>((resolve) => httpServer.listen(0, resolve));
  const { port } = httpServer.address() as AddressInfo;
  return { httpServer, io, adapterHandles, url: `http://localhost:${port}` };
}

async function stopInstance(instance: Instance): Promise<void> {
  await instance.io.close();
  await instance.adapterHandles.close();
}

function connect(url: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(url, { transports: ["websocket"] });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
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

function didNotReceive(socket: ClientSocket, event: string, timeoutMs = 600): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(true), timeoutMs);
    socket.once(event, () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

describe("Socket.IO Redis adapter across multiple instances", () => {
  let instanceA: Instance;
  let instanceB: Instance;

  afterAll(async () => {
    await Promise.all([
      instanceA ? stopInstance(instanceA) : Promise.resolve(),
      instanceB ? stopInstance(instanceB) : Promise.resolve(),
    ]);
  });

  it("delivers a room broadcast from one instance to a client connected to a different instance", async () => {
    instanceA = await startInstance();
    instanceB = await startInstance();

    const clientA = await connect(instanceA.url);
    const clientB = await connect(instanceB.url);

    const room = `match:${crypto.randomUUID()}`;
    clientA.emit("join", room);
    clientB.emit("join", room);
    // Let the join commands land before broadcasting — same margin the real
    // app gets implicitly via its ack-based "chat:join" round trip.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const received = waitForEvent<{ text: string }>(clientB, "room-message");
    instanceA.io.to(room).emit("room-message", { text: "hello from instance A" });

    await expect(received).resolves.toEqual({ text: "hello from instance A" });

    clientA.disconnect();
    clientB.disconnect();
  });

  it("delivers a user-targeted emit (the user:<id> room pattern) across instances", async () => {
    const clientA = await connect(instanceA.url);
    const clientB = await connect(instanceB.url);

    const userRoom = `user:${crypto.randomUUID()}`;
    clientB.emit("join", userRoom);
    await new Promise((resolve) => setTimeout(resolve, 200));

    const received = waitForEvent<{ event: string }>(clientB, "targeted-event");
    // Mirrors emitToUser()'s exact pattern: getIO().to(`user:${userId}`).emit(...)
    instanceA.io.to(userRoom).emit("targeted-event", { event: "match_found" });

    await expect(received).resolves.toEqual({ event: "match_found" });

    clientA.disconnect();
    clientB.disconnect();
  });

  it("does not deliver to a client that never joined the room", async () => {
    const clientA = await connect(instanceA.url);
    const clientB = await connect(instanceB.url);

    const room = `match:${crypto.randomUUID()}`;
    clientA.emit("join", room);
    // clientB deliberately does not join.
    await new Promise((resolve) => setTimeout(resolve, 200));

    const bNoMessage = didNotReceive(clientB, "room-message");
    instanceA.io.to(room).emit("room-message", { text: "should not reach B" });

    await expect(bNoMessage).resolves.toBe(true);

    clientA.disconnect();
    clientB.disconnect();
  });
});
