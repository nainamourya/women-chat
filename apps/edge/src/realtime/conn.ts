import { DurableObject } from "cloudflare:workers";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, withDb } from "../db";
import { users } from "../../../server/src/db/schema";
import { AuthError, assertEligible } from "../../../server/src/services/auth.service";
import {
  assertActiveParticipant,
  endChat,
  getMatchForParticipant,
  getMessagesBefore,
  getRecentMessages,
  sendMessage,
} from "../../../server/src/services/chat.service";
import { checkLimitFailOpen } from "./limiter";
import {
  DEFAULT_CONCURRENT_CONNECTION_LIMIT,
  hubFor,
  isTicketShape,
  ticketStoreFor,
  type RealtimeEnv,
} from "./env";
import { ENGINE_CLOSE, ENGINE_MESSAGE, ENGINE_OPEN, ENGINE_PING, ENGINE_PONG, decodePacket, encodeEvent, encodePacket } from "./protocol";

// One Conn per WebSocket. It speaks the Socket.IO protocol to the browser and
// is the port of apps/server/src/socket/index.ts: authenticateSocket,
// registerConnectionHandlers, registerChatHandlers and registerCallHandlers.
// Behavior, event names, payloads, ack shapes and error strings are copied from
// that file, which remains the reference.

// Engine.IO / Socket.IO defaults (the Express server used them unchanged).
const PING_INTERVAL_MS = 25_000;
const PING_TIMEOUT_MS = 20_000;
const MAX_PAYLOAD_BYTES = 1_000_000;
const CONNECT_TIMEOUT_MS = 45_000;
const MAX_REMEMBERED_MATCHES = 8;

type Ack = (response: { ok: true; [key: string]: unknown } | { ok: false; error: string }) => void;

type Attachment = {
  connectionId: string;
  connectedAt: number;
  authed: boolean;
  userId?: string;
  // `socket.data.joinedMatchId`: the latest chat the socket joined. It is the
  // authorization anchor for history, messages, typing and call signaling.
  joinedMatchId?: string;
  // The Socket.IO rooms this socket is in (`match:<id>`), with each match's two
  // participants so events can be delivered without a database read.
  matches: Record<string, [string, string]>;
  awaitingPong: boolean;
  torn: boolean;
};

// --- Event payload schemas: identical to apps/server/src/socket/index.ts ----
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

const CHAT_MESSAGE_LIMIT = 10;
const CHAT_MESSAGE_WINDOW_SECONDS = 10;
const TYPING_LIMIT = 6;
const TYPING_WINDOW_SECONDS = 5;

function errorMessage(err: unknown): string {
  if (err instanceof AuthError) return err.message;
  // The error type only: a database error can echo the failing query's values
  // (message text, ids).
  console.error("chat socket error:", err instanceof Error ? err.name : "unknown error");
  return "Something went wrong.";
}

export class Conn extends DurableObject<RealtimeEnv> {
  // In memory only: it matters while handlers are in flight, which is exactly
  // when the object cannot be hibernated.
  private eventChain: Promise<void> = Promise.resolve();

  // ---- connection setup --------------------------------------------------

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("Expected a WebSocket upgrade", { status: 426 });
    }
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const connectionId = this.ctx.id.toString();

    // Hibernation API: the object can be evicted from memory while the socket
    // stays open, so all per-socket state lives in the socket's attachment.
    this.ctx.acceptWebSocket(server);
    const attachment: Attachment = { connectionId, connectedAt: Date.now(), authed: false, matches: {}, awaitingPong: false, torn: false };
    server.serializeAttachment(attachment);

    // Engine.IO handshake packet (WebSocket-only transport: no upgrades).
    server.send(
      ENGINE_OPEN +
        JSON.stringify({ sid: connectionId, upgrades: [], pingInterval: PING_INTERVAL_MS, pingTimeout: PING_TIMEOUT_MS, maxPayload: MAX_PAYLOAD_BYTES }),
    );
    await this.ctx.storage.setAlarm(Date.now() + PING_INTERVAL_MS);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- small helpers (state is always re-read, never held across an await) ----

  private socket(): WebSocket | undefined {
    return this.ctx.getWebSockets()[0];
  }

  private state(ws: WebSocket): Attachment {
    return ws.deserializeAttachment() as Attachment;
  }

  private patch(ws: WebSocket, change: (a: Attachment) => void): Attachment {
    const next = this.state(ws);
    change(next);
    ws.serializeAttachment(next);
    return next;
  }

  private send(ws: WebSocket, text: string): void {
    try {
      ws.send(text);
    } catch {
      // The peer is gone; teardown follows from the close/error event.
    }
  }

  private emitTo(ws: WebSocket, event: string, payload: unknown): void {
    this.send(ws, encodeEvent(event, payload));
  }

  private closeSocket(ws: WebSocket, code: number, reason: string): void {
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  // ---- WebSocket lifecycle -------------------------------------------------

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== "string") return; // binary packets are not used by this app
    if (message.length > MAX_PAYLOAD_BYTES) {
      this.closeSocket(ws, 1009, "message too large");
      await this.teardown(ws);
      return;
    }
    const kind = message[0];
    if (kind === ENGINE_PONG) {
      this.patch(ws, (a) => {
        a.awaitingPong = false;
      });
      return;
    }
    if (kind === ENGINE_CLOSE) {
      this.closeSocket(ws, 1000, "client closed");
      await this.teardown(ws);
      return;
    }
    if (kind !== ENGINE_MESSAGE) return; // pings are server-initiated in Engine.IO v4

    const packet = decodePacket(message.slice(1));
    if (!packet) return;

    switch (packet.type) {
      case "CONNECT":
        if (this.state(ws).authed) return;
        if (packet.nsp !== "/") return this.reject(ws, "Invalid namespace", packet.nsp);
        return this.authenticate(ws, packet.data);
      case "DISCONNECT":
        this.closeSocket(ws, 1000, "client disconnect");
        await this.teardown(ws);
        return;
      case "EVENT": {
        if (!this.state(ws).authed) return; // nothing is handled before authentication
        const [event, ...args] = packet.data as [string, ...unknown[]];
        // One event at a time per connection, in arrival order — as on a Socket.IO
        // server, where a client's events are delivered in the order it sent them.
        // Without this each handler's own database check would finish in a
        // different order and, for example, ICE candidates would be relayed
        // shuffled. (Only this connection's own events wait for each other; other
        // connections and incoming RPC deliveries are never queued behind it.)
        this.eventChain = this.eventChain.then(() => this.onEvent(ws, event, args[0], packet.id));
        await this.eventChain;
        return;
      }
      default:
        return;
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try {
      ws.close(code === 1005 || code === 1006 || code === 1015 ? 1000 : code, reason);
    } catch {
      // already closed
    }
    await this.teardown(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.teardown(ws);
  }

  // Server-initiated Engine.IO heartbeat. Also drops a socket that never
  // authenticated (Socket.IO's connectTimeout).
  async alarm(): Promise<void> {
    const ws = this.socket();
    if (!ws) return;
    const a = this.state(ws);
    if (a.torn) return;
    const now = Date.now();
    if (!a.authed && now - a.connectedAt > CONNECT_TIMEOUT_MS) {
      this.closeSocket(ws, 1008, "connect timeout");
      await this.teardown(ws);
      return;
    }
    if (a.awaitingPong) {
      this.closeSocket(ws, 1001, "ping timeout");
      await this.teardown(ws);
      return;
    }
    this.patch(ws, (s) => {
      s.awaitingPong = true;
    });
    this.send(ws, ENGINE_PING);
    await this.ctx.storage.setAlarm(now + PING_INTERVAL_MS);
  }

  // ---- authentication: port of authenticateSocket ------------------------------

  private reject(ws: WebSocket, message: string, nsp = "/"): void {
    this.send(ws, encodePacket({ type: "CONNECT_ERROR", nsp, data: { message } }));
    this.closeSocket(ws, 1000, "rejected");
  }

  private async authenticate(ws: WebSocket, auth: unknown): Promise<void> {
    const ticket = (auth as { ticket?: unknown } | undefined)?.ticket;
    if (typeof ticket !== "string" || !isTicketShape(ticket)) return this.reject(ws, "Unauthorized");

    // One-time: the ticket is consumed before anything else is checked, exactly
    // like the Express server, so a rejected account cannot retry with it.
    let userId: string | null;
    try {
      userId = await ticketStoreFor(this.env, ticket).consume(ticket);
    } catch {
      return this.reject(ws, "Unauthorized");
    }
    if (!userId) return this.reject(ws, "Unauthorized");

    // Banned, suspended, deleted and unverified accounts never get a socket.
    try {
      const user = await withDb(this.env, () => db.query.users.findFirst({ where: eq(users.id, userId!) }));
      if (!user) return this.reject(ws, "Unauthorized");
      assertEligible(user);
    } catch {
      return this.reject(ws, "Unauthorized");
    }

    const connectionId = this.state(ws).connectionId;
    let admitted: boolean;
    try {
      admitted = await hubFor(this.env, userId).admit(connectionId, DEFAULT_CONCURRENT_CONNECTION_LIMIT);
    } catch {
      // The Express server failed open here (Redis only counted connections).
      // In the Worker the hub is also the delivery path to this socket, so a
      // connection it does not know about would be deaf: refuse it instead.
      console.error("Connection registration failed: socket:connect");
      return this.reject(ws, "Service unavailable. Please try again.");
    }
    if (!admitted) {
      return this.reject(ws, "Too many active connections. Please close another tab or device and try again.");
    }

    this.patch(ws, (a) => {
      a.authed = true;
      a.userId = userId!;
    });
    this.send(ws, encodePacket({ type: "CONNECT", nsp: "/", data: { sid: connectionId } }));
  }

  // ---- disconnect handling: port of the "disconnect" listener ---------------------

  private async teardown(ws: WebSocket): Promise<void> {
    const a = this.state(ws);
    if (a.torn) return;
    this.patch(ws, (s) => {
      s.torn = true;
    });
    try {
      await this.ctx.storage.deleteAlarm();
    } catch {
      // not critical
    }
    if (!a.authed || !a.userId) return;

    try {
      await hubFor(this.env, a.userId).release(a.connectionId);
    } catch {
      console.error("Failed to release socket connection (the next admission check will prune it).");
    }
    if (a.joinedMatchId && a.matches[a.joinedMatchId]) {
      await this.deliverToOthers(a, a.joinedMatchId, "chat:user_disconnected", { userId: a.userId });
    }
  }

  // ---- delivery: the Socket.IO room operations ------------------------------------

  // `socket.to("match:<id>").emit(...)`: everyone in the room except this socket.
  private async deliverToOthers(
    a: Attachment,
    matchId: string,
    event: string,
    payload: unknown,
    knownParticipants?: [string, string],
  ): Promise<void> {
    const participants = knownParticipants ?? a.matches[matchId];
    if (!participants) return;
    await Promise.allSettled(
      participants.map((userId) => hubFor(this.env, userId).deliverToMatch(matchId, event, payload, a.connectionId)),
    );
  }

  // `io.to("match:<id>").emit(...)`: everyone in the room including this socket.
  private async deliverToAll(
    ws: WebSocket,
    matchId: string,
    event: string,
    payload: unknown,
    knownParticipants?: [string, string],
  ): Promise<void> {
    const a = this.state(ws);
    if (a.matches[matchId]) this.emitTo(ws, event, payload);
    await this.deliverToOthers(a, matchId, event, payload, knownParticipants);
  }

  // ---- RPC used by UserHub -------------------------------------------------------

  async deliver(event: string, payload: unknown, matchId?: string): Promise<boolean> {
    const ws = this.socket();
    if (!ws) return false;
    const a = this.state(ws);
    if (a.torn || !a.authed) return false;
    if (matchId !== undefined && !a.matches[matchId]) return true;
    this.emitTo(ws, event, payload);
    return true;
  }

  async inMatch(matchId: string): Promise<boolean> {
    const ws = this.socket();
    return Boolean(ws && !this.state(ws).torn && this.state(ws).matches[matchId]);
  }

  async leaveMatch(matchId: string): Promise<boolean> {
    const ws = this.socket();
    if (!ws) return false;
    this.patch(ws, (a) => {
      delete a.matches[matchId];
    });
    return true;
  }

  async disconnect(): Promise<void> {
    const ws = this.socket();
    if (!ws) return;
    this.closeSocket(ws, 1000, "disconnected by server");
    await this.teardown(ws);
  }

  async isAlive(): Promise<boolean> {
    const ws = this.socket();
    return Boolean(ws && !this.state(ws).torn);
  }

  // ---- event handlers: port of registerChatHandlers / registerCallHandlers ----------

  private async onEvent(ws: WebSocket, event: string, payload: unknown, ackId: number | undefined): Promise<void> {
    const ack: Ack = (response) => {
      if (ackId !== undefined) this.send(ws, encodePacket({ type: "ACK", nsp: "/", id: ackId, data: [response] }));
    };
    const userId = this.state(ws).userId as string;
    try {
      switch (event) {
        case "chat:join":
          return await this.onChatJoin(ws, userId, payload, ack);
        case "chat:history":
          return await this.onChatHistory(ws, userId, payload, ack);
        case "chat:message":
          return await this.onChatMessage(ws, userId, payload, ack);
        case "chat:typing_start":
        case "chat:typing_stop":
          return await this.onTyping(ws, userId, event, payload);
        case "chat:end":
          return await this.onChatEnd(ws, userId, payload, ack);
        case "call:offer":
        case "call:answer":
          return await this.onSdp(ws, userId, event, payload);
        case "call:ice-candidate":
          return await this.onIceCandidate(ws, userId, payload);
        case "call:end":
          return await this.onCallEnd(ws, userId, payload);
        default:
          return; // unknown events are ignored, as on the Express server
      }
    } catch (err) {
      // Handlers answer their own errors; this only stops an unexpected throw
      // from becoming an unhandled rejection.
      ack({ ok: false, error: errorMessage(err) });
    }
  }

  private async limited(ws: WebSocket, userId: string, event: string, key: string, limit: number, windowSeconds: number, category: string): Promise<boolean> {
    const result = await checkLimitFailOpen(this.env, `${key}:${userId}`, limit, windowSeconds, category);
    if (!result.allowed) this.emitTo(ws, "rate_limited", { event, retryAfterSeconds: result.retryAfterSeconds });
    return result.allowed;
  }

  private async onChatJoin(ws: WebSocket, userId: string, payload: unknown, ack: Ack): Promise<void> {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid match id." });

    try {
      const { match, messages } = await withDb(this.env, async () => {
        const found = await assertActiveParticipant(userId, parsed.data.matchId);
        // Join the room before reading history, as the Express handler does.
        this.patch(ws, (a) => {
          a.matches[found.id] = [found.userAId, found.userBId];
          const ids = Object.keys(a.matches);
          if (ids.length > MAX_REMEMBERED_MATCHES) delete a.matches[ids[0]];
          a.joinedMatchId = found.id;
        });
        return { match: found, messages: await getRecentMessages(found.id) };
      });

      const otherUserId = match.userAId === userId ? match.userBId : match.userAId;
      await this.deliverToOthers(this.state(ws), match.id, "chat:user_connected", { userId });
      ack({ ok: true, messages, otherUserId });

      // Both participants are in the room: tell them, so the designated caller
      // can start the call. Best-effort — the manual call button still works.
      try {
        const present = await Promise.all(
          [match.userAId, match.userBId].map((id) => hubFor(this.env, id).hasMatchSocket(match.id)),
        );
        if (present.every(Boolean)) await this.deliverToAll(ws, match.id, "call:ready", { matchId: match.id });
      } catch {
        // best effort
      }
    } catch (err) {
      ack({ ok: false, error: errorMessage(err) });
    }
  }

  private async onChatHistory(ws: WebSocket, userId: string, payload: unknown, ack: Ack): Promise<void> {
    const parsed = historySchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid request." });
    if (this.state(ws).joinedMatchId !== parsed.data.matchId) {
      return ack({ ok: false, error: "Join the chat before requesting history." });
    }
    try {
      const messages = await withDb(this.env, async () => {
        await getMatchForParticipant(userId, parsed.data.matchId);
        return getMessagesBefore(parsed.data.matchId, parsed.data.beforeId);
      });
      ack({ ok: true, messages });
    } catch (err) {
      ack({ ok: false, error: errorMessage(err) });
    }
  }

  private async onChatMessage(ws: WebSocket, userId: string, payload: unknown, ack: Ack): Promise<void> {
    const withinLimit = await this.limited(ws, userId, "chat:message", "ratelimit:chat:message", CHAT_MESSAGE_LIMIT, CHAT_MESSAGE_WINDOW_SECONDS, "chat:message");
    if (!withinLimit) return ack({ ok: false, error: "You're sending messages too quickly. Please slow down." });

    const parsed = sendMessageSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid message." });
    if (this.state(ws).joinedMatchId !== parsed.data.matchId) {
      return ack({ ok: false, error: "Join the chat before sending messages." });
    }
    try {
      const saved = await withDb(this.env, () => sendMessage(userId, parsed.data.matchId, parsed.data.content));
      await this.deliverToAll(ws, parsed.data.matchId, "chat:message", saved);
      ack({ ok: true, message: saved });
    } catch (err) {
      ack({ ok: false, error: errorMessage(err) });
    }
  }

  private async onTyping(ws: WebSocket, userId: string, event: string, payload: unknown): Promise<void> {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success || this.state(ws).joinedMatchId !== parsed.data.matchId) return;
    // typing_start and typing_stop share one bucket, as on the Express server.
    if (!(await this.limited(ws, userId, event, "ratelimit:chat:typing", TYPING_LIMIT, TYPING_WINDOW_SECONDS, "chat:typing"))) return;
    await this.deliverToOthers(this.state(ws), parsed.data.matchId, event, { userId });
  }

  private async onChatEnd(ws: WebSocket, userId: string, payload: unknown, ack: Ack): Promise<void> {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success) return ack({ ok: false, error: "Invalid match id." });
    try {
      const { match } = await withDb(this.env, () => endChat(userId, parsed.data.matchId));
      // Delivered to whoever is in the room (this socket only if it joined);
      // the participants come from the match row, not from this socket.
      const participants: [string, string] = [match.userAId, match.userBId];
      await this.deliverToAll(ws, match.id, "chat:ended", { matchId: match.id, endedBy: userId }, participants);
      // `socketsLeave`: nobody stays in the ended room.
      this.patch(ws, (a) => {
        delete a.matches[match.id];
      });
      await Promise.allSettled(participants.map((id) => hubFor(this.env, id).leaveMatch(match.id, this.state(ws).connectionId)));
      ack({ ok: true });
    } catch (err) {
      ack({ ok: false, error: errorMessage(err) });
    }
  }

  // WebRTC signaling is a relay only: the Worker never inspects or stores SDP or
  // ICE. It checks the sender is an active participant of the match it joined and
  // forwards to the other sockets in that room. Not rate-limited, for the reason
  // given in the Express server (ICE bursts are legitimate).
  private async activeRoomMembership(ws: WebSocket, userId: string, matchId: string): Promise<boolean> {
    if (this.state(ws).joinedMatchId !== matchId) return false;
    try {
      await withDb(this.env, () => assertActiveParticipant(userId, matchId));
      return true;
    } catch {
      return false;
    }
  }

  private async onSdp(ws: WebSocket, userId: string, event: string, payload: unknown): Promise<void> {
    const parsed = sdpSchema.safeParse(payload);
    if (!parsed.success) return;
    if (!(await this.activeRoomMembership(ws, userId, parsed.data.matchId))) return;
    await this.deliverToOthers(this.state(ws), parsed.data.matchId, event, { sdp: parsed.data.sdp, from: userId });
  }

  private async onIceCandidate(ws: WebSocket, userId: string, payload: unknown): Promise<void> {
    const parsed = iceCandidateSchema.safeParse(payload);
    if (!parsed.success) return;
    if (!(await this.activeRoomMembership(ws, userId, parsed.data.matchId))) return;
    await this.deliverToOthers(this.state(ws), parsed.data.matchId, "call:ice-candidate", { candidate: parsed.data.candidate, from: userId });
  }

  // Ends the call only (hangup/decline), not the match.
  private async onCallEnd(ws: WebSocket, userId: string, payload: unknown): Promise<void> {
    const parsed = matchIdSchema.safeParse(payload);
    if (!parsed.success) return;
    if (!(await this.activeRoomMembership(ws, userId, parsed.data.matchId))) return;
    await this.deliverToOthers(this.state(ws), parsed.data.matchId, "call:ended", { from: userId });
  }
}
