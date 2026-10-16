import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { env, CORS_ORIGINS } from "../config/env.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { consumeSocketTicket } from "../redis/socketTickets.js";
import { checkLimitFailOpen } from "../redis/rateLimit.js";
import {
  admitConnection,
  releaseConnection,
  startHeartbeat,
  DEFAULT_CONCURRENT_CONNECTION_LIMIT,
} from "../redis/connectionLimit.js";
import {
  assertActiveParticipant,
  endChat,
  getMatchForParticipant,
  getMessagesBefore,
  getRecentMessages,
  sendMessage,
} from "../services/chat.service.js";
import { AuthError, assertEligible } from "../services/auth.service.js";
import { createRedisAdapter, type RedisAdapterHandles } from "./redisAdapter.js";

let io: SocketIOServer | undefined;
let adapterHandles: RedisAdapterHandles | undefined;

function matchRoom(matchId: string): string {
  return `match:${matchId}`;
}

type Ack = (response: { ok: true; [key: string]: unknown } | { ok: false; error: string }) => void;

function errorMessage(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  console.error("chat socket error:", err);
  return "Something went wrong.";
}

const matchIdSchema = z.object({ matchId: z.string().uuid() });
const sendMessageSchema = z.object({ matchId: z.string().uuid(), content: z.string() });
const historySchema = z.object({ matchId: z.string().uuid(), beforeId: z.string().uuid() });

const sdpSchema = z.object({
  matchId: z.string().uuid(),
  sdp: z.object({ type: z.string(), sdp: z.string() }),
});
const iceCandidateSchema = z.object({
  matchId: z.string().uuid(),
  candidate: z.object({
    candidate: z.string(),
    sdpMid: z.string().nullable().optional(),
    sdpMLineIndex: z.number().nullable().optional(),
    usernameFragment: z.string().nullable().optional(),
  }),
});

// Initial suggestions (Phase 2), not measured requirements — see the
// rate-limiting audit this is based on. Keyed by the authenticated socket's
// own userId (set by authenticateSocket() below from a consumed one-time
// ticket) — never anything the browser could supply directly. Backed by
// the same Redis-backed atomic counter used everywhere else in this app,
// so the count is shared correctly across backend instances, not just this
// process.
const CHAT_MESSAGE_LIMIT = 10;
const CHAT_MESSAGE_WINDOW_SECONDS = 10; // allows a normal conversational burst, caps sustained spam
const TYPING_LIMIT = 6;
const TYPING_WINDOW_SECONDS = 5; // typing_start + typing_stop share one bucket — just event-flood protection

// Deliberately NOT applied to call:offer/answer/ice-candidate/end — real
// WebRTC negotiation (especially ICE restart) can legitimately emit many
// candidates in a quick burst, and rate-limiting that risks breaking real
// calls for no real abuse-prevention benefit (see the audit).
async function checkSocketRateLimit(
  socket: Socket,
  event: string,
  key: string,
  limit: number,
  windowSeconds: number,
  category: string,
): Promise<boolean> {
  const result = await checkLimitFailOpen(key, limit, windowSeconds, category);
  if (!result.allowed) {
    socket.emit("rate_limited", { event, retryAfterSeconds: result.retryAfterSeconds });
  }
  return result.allowed;
}

export function registerChatHandlers(socket: Socket) {
  const userId = socket.data.userId as string;

  socket.on("chat:join", async (payload, ack: Ack) => {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid match id." });

    try {
      const match = await assertActiveParticipant(userId, parsed.data.matchId);
      const room = matchRoom(match.id);
      socket.join(room);
      socket.data.joinedMatchId = match.id;

      const otherUserId = match.userAId === userId ? match.userBId : match.userAId;
      const messages = await getRecentMessages(match.id);

      socket.to(room).emit("chat:user_connected", { userId });
      ack({ ok: true, messages, otherUserId });

      // Both participants are in the room — tell them so the designated
      // caller can start the video call without a ring/accept step and
      // without sending an offer the other side isn't listening for yet.
      try {
        const members = await socket.nsp.in(room).fetchSockets();
        const userIds = new Set(members.map((s) => s.data.userId as string));
        if (userIds.size >= 2) {
          socket.nsp.server.to(room).emit("call:ready", { matchId: match.id });
        }
      } catch {
        // Best-effort: the manual "Start a video call" button still works.
      }
    } catch (err) {
      ack({ ok: false, error: errorMessage(err) });
    }
  });

  socket.on("chat:history", async (payload, ack: Ack) => {
    const parsed = historySchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid request." });
    if (socket.data.joinedMatchId !== parsed.data.matchId) {
      return ack({ ok: false, error: "Join the chat before requesting history." });
    }

    try {
      await getMatchForParticipant(userId, parsed.data.matchId);
      const messages = await getMessagesBefore(parsed.data.matchId, parsed.data.beforeId);
      ack({ ok: true, messages });
    } catch (err) {
      ack({ ok: false, error: errorMessage(err) });
    }
  });

  socket.on("chat:message", async (payload, ack: Ack) => {
    const withinLimit = await checkSocketRateLimit(
      socket,
      "chat:message",
      `ratelimit:chat:message:${userId}`,
      CHAT_MESSAGE_LIMIT,
      CHAT_MESSAGE_WINDOW_SECONDS,
      "chat:message",
    );
    if (!withinLimit) {
      return ack({ ok: false, error: "You're sending messages too quickly. Please slow down." });
    }

    const parsed = sendMessageSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid message." });
    if (socket.data.joinedMatchId !== parsed.data.matchId) {
      return ack({ ok: false, error: "Join the chat before sending messages." });
    }

    try {
      const saved = await sendMessage(userId, parsed.data.matchId, parsed.data.content);
      // Derived from this socket's own namespace rather than the module-
      // level getIO() singleton, so this function is correctly scoped to
      // whichever Socket.IO server instance it's actually running under
      // (both in production and when a test constructs a second, fully
      // independent instance in-process).
      socket.nsp.server.to(matchRoom(parsed.data.matchId)).emit("chat:message", saved);
      ack({ ok: true, message: saved });
    } catch (err) {
      ack({ ok: false, error: errorMessage(err) });
    }
  });

  socket.on("chat:typing_start", async (payload) => {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success || socket.data.joinedMatchId !== parsed.data.matchId) return;
    const withinLimit = await checkSocketRateLimit(
      socket,
      "chat:typing_start",
      `ratelimit:chat:typing:${userId}`,
      TYPING_LIMIT,
      TYPING_WINDOW_SECONDS,
      "chat:typing",
    );
    if (!withinLimit) return;
    socket.to(matchRoom(parsed.data.matchId)).emit("chat:typing_start", { userId });
  });

  socket.on("chat:typing_stop", async (payload) => {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success || socket.data.joinedMatchId !== parsed.data.matchId) return;
    const withinLimit = await checkSocketRateLimit(
      socket,
      "chat:typing_stop",
      `ratelimit:chat:typing:${userId}`,
      TYPING_LIMIT,
      TYPING_WINDOW_SECONDS,
      "chat:typing",
    );
    if (!withinLimit) return;
    socket.to(matchRoom(parsed.data.matchId)).emit("chat:typing_stop", { userId });
  });

  socket.on("chat:end", async (payload, ack: Ack) => {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid match id." });

    try {
      const { match } = await endChat(userId, parsed.data.matchId);
      const room = matchRoom(match.id);
      // Same reasoning as chat:message above — derived from this socket's
      // own server instance, not the module-level singleton.
      socket.nsp.server.to(room).emit("chat:ended", { matchId: match.id, endedBy: userId });
      socket.nsp.server.in(room).socketsLeave(room);
      ack({ ok: true });
    } catch (err) {
      ack({ ok: false, error: errorMessage(err) });
    }
  });
}

// WebRTC signaling relay only — the server never inspects or stores SDP/ICE
// payloads, it just validates that the sender is an active participant of
// the match and relays to the *other* socket in the same match room. Reuses
// the match room already joined via "chat:join" rather than a separate room.
// Not rate-limited — see the comment above CHAT_MESSAGE_LIMIT for why.
export function registerCallHandlers(socket: Socket) {
  const userId = socket.data.userId as string;

  async function requireActiveRoomMembership(matchId: string): Promise<boolean> {
    if (socket.data.joinedMatchId !== matchId) return false;
    try {
      await assertActiveParticipant(userId, matchId);
      return true;
    } catch {
      return false;
    }
  }

  socket.on("call:offer", async (payload) => {
    const parsed = sdpSchema.safeParse(payload);
    if (!parsed.success) return;
    if (!(await requireActiveRoomMembership(parsed.data.matchId))) return;
    socket.to(matchRoom(parsed.data.matchId)).emit("call:offer", { sdp: parsed.data.sdp, from: userId });
  });

  socket.on("call:answer", async (payload) => {
    const parsed = sdpSchema.safeParse(payload);
    if (!parsed.success) return;
    if (!(await requireActiveRoomMembership(parsed.data.matchId))) return;
    socket.to(matchRoom(parsed.data.matchId)).emit("call:answer", { sdp: parsed.data.sdp, from: userId });
  });

  socket.on("call:ice-candidate", async (payload) => {
    const parsed = iceCandidateSchema.safeParse(payload);
    if (!parsed.success) return;
    if (!(await requireActiveRoomMembership(parsed.data.matchId))) return;
    socket
      .to(matchRoom(parsed.data.matchId))
      .emit("call:ice-candidate", { candidate: parsed.data.candidate, from: userId });
  });

  // Ends the call only (hangup/decline) — distinct from "chat:end", which
  // ends the whole match. Text chat keeps working after a call ends.
  socket.on("call:end", async (payload) => {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success) return;
    if (!(await requireActiveRoomMembership(parsed.data.matchId))) return;
    socket.to(matchRoom(parsed.data.matchId)).emit("call:ended", { from: userId });
  });
}

// Every connection must present a one-time ticket minted by the Next.js
// server for the currently signed-in user (see socketTickets.ts) — the raw
// user id is never trusted if a client tried to supply it directly.
// Extracted into its own exported function (rather than inlined in
// initSocketServer) so a second, fully independent Socket.IO server in
// tests can apply the exact same real auth flow — see
// chatRateLimit.integration.test.ts.
// `concurrentConnectionLimit` is configurable per call (tests use a smaller
// value to exercise the limit quickly) and defaults to
// DEFAULT_CONCURRENT_CONNECTION_LIMIT otherwise.
export function authenticateSocket(concurrentConnectionLimit = DEFAULT_CONCURRENT_CONNECTION_LIMIT) {
  return async (socket: Socket, next: (err?: Error) => void) => {
    const ticket = socket.handshake.auth?.ticket;
    if (typeof ticket !== "string") {
      return next(new Error("Unauthorized"));
    }
    const userId = await consumeSocketTicket(ticket);
    if (!userId) {
      return next(new Error("Unauthorized"));
    }

    // Server-side enforcement for banned/suspended/unverified accounts: a
    // rejected connection can never join chat/call rooms, regardless of
    // what the client UI does or doesn't hide. assertEligible (shared with
    // matchmaking and the socket-ticket route) also requires ageConfirmed18
    // and verificationStatus === "verified" — this is the point that gates
    // both chat and call signaling, since both run over this same
    // connection, per the introduction-video verification requirement that
    // a pending/rejected applicant cannot reach either.
    try {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user) {
        return next(new Error("Unauthorized"));
      }
      assertEligible(user);
    } catch {
      return next(new Error("Unauthorized"));
    }

    // Enforced atomically in Redis (see connectionLimit.ts), not a
    // process-local counter, so it's correct across multiple backend
    // instances — a user can't bypass the cap by having their connections
    // spread across instances. socket.id is already assigned by this point
    // in the handshake and is unique per connection attempt.
    let admitted: boolean;
    try {
      admitted = await admitConnection(userId, socket.id, concurrentConnectionLimit);
    } catch {
      console.error("Connection limit check failed (fail-open): socket:connect");
      admitted = true;
    }
    if (!admitted) {
      return next(new Error("Too many active connections. Please close another tab or device and try again."));
    }

    socket.data.userId = userId;
    socket.data.connectionId = socket.id;
    next();
  };
}

// Also extracted (see authenticateSocket's comment) so tests can wire up a
// second real instance identically to production rather than
// re-implementing this glue.
export function registerConnectionHandlers(socket: Socket) {
  const userId = socket.data.userId as string;
  const connectionId = socket.data.connectionId as string;
  // Private per-user room so matchmaking (and later, chat) events can be
  // targeted at a specific user without the browser ever joining a room by
  // another user's id itself.
  socket.join(`user:${userId}`);
  registerChatHandlers(socket);
  registerCallHandlers(socket);

  // Keeps this connection's Redis-backed lease (see connectionLimit.ts)
  // alive for as long as the socket itself stays connected.
  const heartbeat = startHeartbeat(userId, connectionId);

  socket.on("disconnect", () => {
    clearInterval(heartbeat);
    // Frees the slot immediately rather than waiting for the lease to
    // expire, so a clean disconnect (including this server's own graceful
    // shutdown, which Socket.IO fires as a normal disconnect on every
    // socket) lets the same user reconnect right away.
    releaseConnection(userId, connectionId).catch(() => {
      // Not fatal — the lease's TTL (see connectionLimit.ts) still expires
      // it on its own. Never logs the raw error, which could echo the
      // failing Redis command/key.
      console.error("Failed to release socket connection lease (will expire via TTL).");
    });

    // No matchmaking-queue cleanup needed here: the Redis waiting marker's
    // TTL (see matchmakingQueue.ts) expires on its own if this user doesn't
    // keep polling /api/matchmaking/status, which is what actually drives
    // "waiting" liveness, not the socket connection.

    const joinedMatchId = socket.data.joinedMatchId as string | undefined;
    if (joinedMatchId) {
      socket.to(matchRoom(joinedMatchId)).emit("chat:user_disconnected", { userId });
    }
  });
}

// Async because the Redis adapter's pub/sub connections must be ready
// *before* this instance accepts any Socket.IO connection — otherwise a
// room broadcast/targeted emit made in the brief startup window would only
// ever reach sockets on this same instance, silently, which is exactly the
// bug this adapter exists to fix. Call sites must await this before
// httpServer.listen().
export async function initSocketServer(httpServer: HttpServer): Promise<SocketIOServer> {
  adapterHandles = await createRedisAdapter();

  io = new SocketIOServer(httpServer, {
    cors: {
      origin: CORS_ORIGINS,
      credentials: true,
    },
    adapter: adapterHandles.adapter,
  });

  io.use(authenticateSocket());

  io.on("connection", (socket) => {
    registerConnectionHandlers(socket);
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error("Socket.IO server has not been initialized yet.");
  }
  return io;
}

// Closes the Socket.IO server (which also closes the underlying HTTP server
// it was attached to — see initSocketServer's caller in index.ts) and the
// adapter's dedicated Redis connections together, so graceful shutdown has a
// single call site for everything socket-related.
export async function closeSocketServer(): Promise<void> {
  if (io) {
    await io.close();
  }
  if (adapterHandles) {
    await adapterHandles.close();
  }
}

export function emitToUser(userId: string, event: string, payload: unknown): void {
  getIO().to(`user:${userId}`).emit(event, payload);
}

// Forcibly drops any active connection for this user — used when an admin
// suspends/bans them, so an in-progress chat/call ends immediately rather
// than waiting for their next reconnect attempt (which io.use already
// rejects for a non-active account). No new client-facing event/payload is
// introduced; the client just sees an ordinary disconnect, the same as any
// network drop.
export function disconnectUser(userId: string): void {
  getIO().in(`user:${userId}`).disconnectSockets(true);
}
