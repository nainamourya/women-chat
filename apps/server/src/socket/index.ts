import type { Server as HttpServer } from "node:http";
import { Server as SocketIOServer, type Socket } from "socket.io";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { env } from "../config/env.js";
import { db } from "../db/client.js";
import { users } from "../db/schema.js";
import { consumeSocketTicket } from "../redis/socketTickets.js";
import {
  assertActiveParticipant,
  endChat,
  getMatchForParticipant,
  getMessagesBefore,
  getRecentMessages,
  sendMessage,
} from "../services/chat.service.js";
import { AuthError, assertAccountActive } from "../services/auth.service.js";

let io: SocketIOServer | undefined;

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

function registerChatHandlers(socket: Socket) {
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
    const parsed = sendMessageSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid message." });
    if (socket.data.joinedMatchId !== parsed.data.matchId) {
      return ack({ ok: false, error: "Join the chat before sending messages." });
    }

    try {
      const saved = await sendMessage(userId, parsed.data.matchId, parsed.data.content);
      getIO().to(matchRoom(parsed.data.matchId)).emit("chat:message", saved);
      ack({ ok: true, message: saved });
    } catch (err) {
      ack({ ok: false, error: errorMessage(err) });
    }
  });

  socket.on("chat:typing_start", (payload) => {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success || socket.data.joinedMatchId !== parsed.data.matchId) return;
    socket.to(matchRoom(parsed.data.matchId)).emit("chat:typing_start", { userId });
  });

  socket.on("chat:typing_stop", (payload) => {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success || socket.data.joinedMatchId !== parsed.data.matchId) return;
    socket.to(matchRoom(parsed.data.matchId)).emit("chat:typing_stop", { userId });
  });

  socket.on("chat:end", async (payload, ack: Ack) => {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid match id." });

    try {
      const { match } = await endChat(userId, parsed.data.matchId);
      const room = matchRoom(match.id);
      getIO().to(room).emit("chat:ended", { matchId: match.id, endedBy: userId });
      getIO().in(room).socketsLeave(room);
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
function registerCallHandlers(socket: Socket) {
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

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  io = new SocketIOServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  // Every connection must present a one-time ticket minted by the Next.js
  // server for the currently signed-in user (see socketTickets.ts) — the raw
  // user id is never trusted if a client tried to supply it directly.
  io.use(async (socket, next) => {
    const ticket = socket.handshake.auth?.ticket;
    if (typeof ticket !== "string") {
      return next(new Error("Unauthorized"));
    }
    const userId = await consumeSocketTicket(ticket);
    if (!userId) {
      return next(new Error("Unauthorized"));
    }

    // Server-side enforcement for banned/suspended accounts: a rejected
    // connection can never join chat/call rooms, regardless of what the
    // client UI does or doesn't hide.
    try {
      const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
      if (!user) {
        return next(new Error("Unauthorized"));
      }
      assertAccountActive(user);
    } catch {
      return next(new Error("Unauthorized"));
    }

    socket.data.userId = userId;
    next();
  });

  io.on("connection", (socket) => {
    const userId = socket.data.userId as string;
    // Private per-user room so matchmaking (and later, chat) events can be
    // targeted at a specific user without the browser ever joining a room by
    // another user's id itself.
    socket.join(`user:${userId}`);
    registerChatHandlers(socket);
    registerCallHandlers(socket);

    socket.on("disconnect", () => {
      // No matchmaking-queue cleanup needed here: the Redis waiting marker's
      // TTL (see matchmakingQueue.ts) expires on its own if this user doesn't
      // keep polling /api/matchmaking/status, which is what actually drives
      // "waiting" liveness, not the socket connection.

      const joinedMatchId = socket.data.joinedMatchId as string | undefined;
      if (joinedMatchId) {
        socket.to(matchRoom(joinedMatchId)).emit("chat:user_disconnected", { userId });
      }
    });
  });

  return io;
}

export function getIO(): SocketIOServer {
  if (!io) {
    throw new Error("Socket.IO server has not been initialized yet.");
  }
  return io;
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
