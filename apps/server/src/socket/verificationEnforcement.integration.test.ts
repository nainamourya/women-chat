import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { inArray } from "drizzle-orm";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { env } from "../config/env.js";
import { initSocketServer } from "./index.js";
import { mintSocketTicket } from "../redis/socketTickets.js";
import { matchmakingRouter } from "../routes/matchmaking.js";

// Integration test proving that a user who is not fully eligible
// (ageConfirmed18 && verificationStatus === "verified") cannot reach
// matchmaking, socket-ticket issuance, or the Socket.IO connection itself —
// the three enforcement points required by the introduction-video
// verification feature — even when calling each API directly rather than
// going through the normal UI flow.

let socketServerUrl: string;
let socketHttpServer: ReturnType<typeof createServer>;
let apiBaseUrl: string;
let apiHttpServer: ReturnType<typeof createServer>;

const testUserIds: string[] = [];

type UserVerificationStatus = "unverified" | "pending" | "verified" | "rejected" | "resubmission_required";

async function createUserWith(status: UserVerificationStatus) {
  const [user] = await db
    .insert(users)
    .values({
      email: `verify-enforce-${randomUUID()}@example.com`,
      passwordHash: "test-hash-not-used",
      displayName: "Test user",
      ageConfirmed18: true,
      verificationStatus: status,
    })
    .returning();
  testUserIds.push(user.id);
  return user;
}

function connectWithTicket(ticket: string): Promise<ClientSocket> {
  return new Promise((resolve, reject) => {
    const socket = ioClient(socketServerUrl, { auth: { ticket } });
    socket.on("connect", () => resolve(socket));
    socket.on("connect_error", (err) => reject(err));
  });
}

beforeAll(async () => {
  socketHttpServer = createServer();
  await initSocketServer(socketHttpServer);
  await new Promise<void>((resolve) => socketHttpServer.listen(0, resolve));
  const { port: socketPort } = socketHttpServer.address() as AddressInfo;
  socketServerUrl = `http://localhost:${socketPort}`;

  const app = express();
  app.use(express.json());
  app.use("/api/matchmaking", matchmakingRouter);
  apiHttpServer = createServer(app);
  await new Promise<void>((resolve) => apiHttpServer.listen(0, resolve));
  const { port: apiPort } = apiHttpServer.address() as AddressInfo;
  apiBaseUrl = `http://localhost:${apiPort}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => socketHttpServer.close(() => resolve()));
  await new Promise<void>((resolve) => apiHttpServer.close(() => resolve()));
  if (testUserIds.length > 0) {
    await db.delete(users).where(inArray(users.id, testUserIds));
  }
});

describe("verification enforcement cannot be bypassed", () => {
  it.each(["unverified", "pending", "rejected", "resubmission_required"] as const)(
    "rejects a Socket.IO connection for a %s user",
    async (status) => {
      const user = await createUserWith(status);
      const ticket = await mintSocketTicket(user.id);
      await expect(connectWithTicket(ticket)).rejects.toBeTruthy();
    },
  );

  it("allows a Socket.IO connection for a verified, age-confirmed user", async () => {
    const user = await createUserWith("verified");
    const ticket = await mintSocketTicket(user.id);
    const socket = await connectWithTicket(ticket);
    expect(socket.connected).toBe(true);
    socket.disconnect();
  });

  it.each(["unverified", "pending", "rejected", "resubmission_required"] as const)(
    "rejects /matchmaking/join for a %s user, calling the API directly",
    async (status) => {
      const user = await createUserWith(status);
      const res = await fetch(`${apiBaseUrl}/api/matchmaking/join`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET },
        body: JSON.stringify({ userId: user.id }),
      });
      expect(res.status).toBe(403);
    },
  );

  it.each(["unverified", "pending", "rejected", "resubmission_required"] as const)(
    "rejects /matchmaking/socket-ticket for a %s user, calling the API directly",
    async (status) => {
      const user = await createUserWith(status);
      const res = await fetch(`${apiBaseUrl}/api/matchmaking/socket-ticket`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET },
        body: JSON.stringify({ userId: user.id }),
      });
      expect(res.status).toBe(403);
    },
  );

  it("allows /matchmaking/join and /matchmaking/socket-ticket for a verified user", async () => {
    const user = await createUserWith("verified");

    const joinRes = await fetch(`${apiBaseUrl}/api/matchmaking/join`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET },
      body: JSON.stringify({ userId: user.id }),
    });
    expect(joinRes.status).toBe(200);

    const ticketRes = await fetch(`${apiBaseUrl}/api/matchmaking/socket-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET },
      body: JSON.stringify({ userId: user.id }),
    });
    expect(ticketRes.status).toBe(200);

    await fetch(`${apiBaseUrl}/api/matchmaking/leave`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-internal-api-secret": env.INTERNAL_API_SECRET },
      body: JSON.stringify({ userId: user.id }),
    });
  });
});
