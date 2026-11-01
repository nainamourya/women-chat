import { spawnSync } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { io, type Socket } from "socket.io-client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_INTERNAL_SECRET, startLocalWorker, type RunningWorker } from "./localWorker";
import { Fixtures } from "./seed";

// Uses the real `socket.io-client` — the library the web app uses — against the
// Worker, so a pass here means an unmodified client works over the Durable
// Object transport (given `transports: ["websocket"]`).
const SECRET = { "x-internal-api-secret": TEST_INTERNAL_SECRET };
const JSON_HEADERS = { ...SECRET, "content-type": "application/json" };

let worker: RunningWorker;
let fx: Fixtures;
const open: Socket[] = [];

beforeAll(async () => {
  fx = new Fixtures();
  worker = await startLocalWorker(8820, { testHooks: true });
});
afterAll(async () => {
  open.forEach((s) => s.close());
  worker?.stop();
  await fx?.cleanup();
});

async function post(path: string, body: unknown, headers: Record<string, string> = JSON_HEADERS) {
  const res = await fetch(`${worker.baseUrl}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { status: res.status, json: (await res.json().catch(() => undefined)) as Record<string, any> | undefined, headers: res.headers };
}

const ticketFor = async (userId: string) => {
  const res = await post("/api/matchmaking/socket-ticket", { userId });
  expect(res.status, "ticket request").toBe(200);
  return res.json!.ticket as string;
};

function rawSocket(auth: Record<string, unknown> | undefined): Socket {
  const socket = io(worker.baseUrl, { transports: ["websocket"], auth, reconnection: false, forceNew: true });
  open.push(socket);
  return socket;
}

const settle = (socket: Socket) =>
  new Promise<{ connected: true } | { connected: false; message: string }>((resolve) => {
    socket.once("connect", () => resolve({ connected: true }));
    socket.once("connect_error", (err) => resolve({ connected: false, message: err.message }));
  });

async function connectAs(userId: string): Promise<Socket> {
  const socket = rawSocket({ ticket: await ticketFor(userId) });
  const result = await settle(socket);
  expect(result, "socket should connect").toEqual({ connected: true });
  return socket;
}

const nextEvent = <T = any>(socket: Socket, event: string, timeoutMs = 5000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

// Resolves true if the event arrives, false if it does not within the window.
const arrives = (socket: Socket, event: string, windowMs = 600) =>
  new Promise<boolean>((resolve) => {
    const handler = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve(false);
    }, windowMs);
    socket.once(event, handler);
  });

const emitAck = <T = any>(socket: Socket, event: string, payload: unknown) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ack for "${event}"`)), 5000);
    socket.emit(event, payload, (response: T) => {
      clearTimeout(timer);
      resolve(response);
    });
  });

// A match with both members connected and joined.
async function joinedPair() {
  const a = await fx.member();
  const b = await fx.member();
  const match = await fx.match(a.id, b.id);
  const sa = await connectAs(a.id);
  const sb = await connectAs(b.id);
  expect(await emitAck(sa, "chat:join", { matchId: match.id })).toMatchObject({ ok: true });
  expect(await emitAck(sb, "chat:join", { matchId: match.id })).toMatchObject({ ok: true });
  return { a, b, match, sa, sb };
}

describe("socket tickets (REST)", () => {
  it("requires the internal secret", async () => {
    const m = await fx.member();
    const res = await post("/api/matchmaking/socket-ticket", { userId: m.id }, { "content-type": "application/json" });
    expect(res.status).toBe(401);
    expect(res.json).toEqual({ error: "Unauthorized." });
  });

  it("rejects an invalid user id", async () => {
    const res = await post("/api/matchmaking/socket-ticket", { userId: "nope" });
    expect(res.status).toBe(400);
    expect(res.json).toEqual({ error: "Invalid user id." });
  });

  it("404 for an unknown user", async () => {
    const res = await post("/api/matchmaking/socket-ticket", { userId: crypto.randomUUID() });
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: "User not found." });
  });

  it("refuses accounts that may not use chat (unverified, under-age-confirmation, banned)", async () => {
    for (const overrides of [{ verificationStatus: "unverified" as const }, { ageConfirmed18: false }, { accountStatus: "banned" as const }]) {
      const m = await fx.member(overrides);
      const res = await post("/api/matchmaking/socket-ticket", { userId: m.id });
      expect(res.status, JSON.stringify(overrides)).toBe(403);
      expect(typeof res.json?.error).toBe("string");
      expect(res.json).not.toHaveProperty("ticket");
    }
  });

  it("mints an opaque UUID ticket for an eligible member", async () => {
    const m = await fx.member();
    const res = await post("/api/matchmaking/socket-ticket", { userId: m.id });
    expect(res.status).toBe(200);
    expect(res.json!.ticket).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });

  it("limits to 10 per minute per user with a generic 429 and Retry-After", async () => {
    const m = await fx.member();
    for (let i = 0; i < 10; i++) expect((await post("/api/matchmaking/socket-ticket", { userId: m.id })).status).toBe(200);
    const limited = await post("/api/matchmaking/socket-ticket", { userId: m.id });
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({ error: "Too many attempts. Please try again later." });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    // Another user is unaffected.
    const other = await fx.member();
    expect((await post("/api/matchmaking/socket-ticket", { userId: other.id })).status).toBe(200);
  });
});

describe("socket authentication", () => {
  it("accepts a valid ticket and gives the socket an id", async () => {
    const m = await fx.member();
    const socket = await connectAs(m.id);
    expect(typeof socket.id).toBe("string");
    expect(socket.id!.length).toBeGreaterThan(10);
  });

  it("rejects a connection with no ticket", async () => {
    expect(await settle(rawSocket(undefined))).toEqual({ connected: false, message: "Unauthorized" });
    expect(await settle(rawSocket({}))).toEqual({ connected: false, message: "Unauthorized" });
  });

  it("rejects a non-string ticket, a malformed ticket and an unknown well-formed ticket", async () => {
    for (const ticket of [123, "not-a-ticket", "../../etc", crypto.randomUUID()]) {
      expect(await settle(rawSocket({ ticket })), String(ticket)).toEqual({ connected: false, message: "Unauthorized" });
    }
  });

  it("a ticket works exactly once (replay is rejected)", async () => {
    const m = await fx.member();
    const ticket = await ticketFor(m.id);
    expect(await settle(rawSocket({ ticket }))).toEqual({ connected: true });
    expect(await settle(rawSocket({ ticket }))).toEqual({ connected: false, message: "Unauthorized" });
  });

  it("two simultaneous connections with one ticket: exactly one wins", async () => {
    const m = await fx.member();
    const ticket = await ticketFor(m.id);
    const results = await Promise.all([settle(rawSocket({ ticket })), settle(rawSocket({ ticket }))]);
    expect(results.filter((r) => r.connected)).toHaveLength(1);
    expect(results.filter((r) => !r.connected)).toHaveLength(1);
  });

  it("a ticket is consumed even when the account is rejected (no retry with it)", async () => {
    const m = await fx.member();
    const ticket = await ticketFor(m.id);
    await fx.setStatus(m.id, "banned");
    expect(await settle(rawSocket({ ticket }))).toEqual({ connected: false, message: "Unauthorized" });
    await fx.setStatus(m.id, "active");
    expect(await settle(rawSocket({ ticket }))).toEqual({ connected: false, message: "Unauthorized" });
  });

  it("a ticket minted before a ban cannot be used afterwards", async () => {
    const m = await fx.member();
    const ticket = await ticketFor(m.id);
    await fx.setStatus(m.id, "banned");
    expect(await settle(rawSocket({ ticket }))).toEqual({ connected: false, message: "Unauthorized" });
  });

  it("a ticket expires after 30 seconds", async () => {
    const m = await fx.member();
    const ticket = await ticketFor(m.id);
    await new Promise((r) => setTimeout(r, 31_000));
    expect(await settle(rawSocket({ ticket }))).toEqual({ connected: false, message: "Unauthorized" });
  }, 60_000);

  it("refuses a non-default namespace", async () => {
    const m = await fx.member();
    const socket = io(`${worker.baseUrl}/admin`, { transports: ["websocket"], auth: { ticket: await ticketFor(m.id) }, reconnection: false, forceNew: true });
    open.push(socket);
    expect(await settle(socket)).toEqual({ connected: false, message: "Invalid namespace" });
  });

  it("does not serve long-polling or other protocol versions", async () => {
    const polling = await fetch(`${worker.baseUrl}/socket.io/?EIO=4&transport=polling`);
    expect(polling.status).toBe(400);
    expect(await polling.json()).toMatchObject({ code: 0 });
    const old = await fetch(`${worker.baseUrl}/socket.io/?EIO=3&transport=websocket`);
    expect(old.status).toBe(400);
    expect(await old.json()).toMatchObject({ code: 5 });
    const plainGet = await fetch(`${worker.baseUrl}/socket.io/?EIO=4&transport=websocket`);
    expect(plainGet.status).toBe(400);
  });
});

describe("connection lifecycle and limits", () => {
  it("allows 3 concurrent connections per user, refuses a 4th, and frees a slot on disconnect", async () => {
    const m = await fx.member();
    const first = await connectAs(m.id);
    await connectAs(m.id);
    await connectAs(m.id);

    const fourth = rawSocket({ ticket: await ticketFor(m.id) });
    expect(await settle(fourth)).toEqual({
      connected: false,
      message: "Too many active connections. Please close another tab or device and try again.",
    });

    first.close();
    await new Promise((r) => setTimeout(r, 700));
    const replacement = rawSocket({ ticket: await ticketFor(m.id) });
    expect(await settle(replacement)).toEqual({ connected: true });
  });

  it("the cap is per user, not global", async () => {
    const x = await fx.member();
    const y = await fx.member();
    await connectAs(x.id);
    await connectAs(x.id);
    await connectAs(x.id);
    await connectAs(y.id);
  });

  it("a client that disconnects cleanly is announced to the chat room", async () => {
    const { b, sa, sb } = await joinedPair();
    const gone = nextEvent(sa, "chat:user_disconnected");
    sb.close();
    expect(await gone).toEqual({ userId: b.id });
  });
});

describe("chat events", () => {
  it("chat:join acks with history and the other participant, and announces to the room", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const match = await fx.match(a.id, b.id);
    const sa = await connectAs(a.id);
    const sb = await connectAs(b.id);

    const joinedA = await emitAck(sa, "chat:join", { matchId: match.id });
    expect(joinedA).toEqual({ ok: true, messages: [], otherUserId: b.id });

    const announced = nextEvent(sa, "chat:user_connected");
    const ready = Promise.all([nextEvent(sa, "call:ready"), nextEvent(sb, "call:ready")]);
    const joinedB = await emitAck(sb, "chat:join", { matchId: match.id });
    expect(joinedB).toEqual({ ok: true, messages: [], otherUserId: a.id });
    expect(await announced).toEqual({ userId: b.id });
    // Both are in the room: both are told, so the caller can start the call.
    expect(await ready).toEqual([{ matchId: match.id }, { matchId: match.id }]);
  });

  it("call:ready is not sent while only one participant is present", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const match = await fx.match(a.id, b.id);
    const sa = await connectAs(a.id);
    const quiet = arrives(sa, "call:ready", 800);
    await emitAck(sa, "chat:join", { matchId: match.id });
    expect(await quiet).toBe(false);
  });

  it("chat:join validation and authorization errors use the Express ack shape", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const outsider = await fx.member();
    const active = await fx.match(a.id, b.id);
    const ended = await fx.match(a.id, b.id, "ended");
    const so = await connectAs(outsider.id);
    const sa = await connectAs(a.id);

    expect(await emitAck(sa, "chat:join", { matchId: "not-a-uuid" })).toEqual({ ok: false, error: "Invalid match id." });
    expect(await emitAck(sa, "chat:join", undefined)).toEqual({ ok: false, error: "Invalid match id." });
    expect(await emitAck(sa, "chat:join", { matchId: crypto.randomUUID() })).toEqual({ ok: false, error: "Match not found." });
    expect(await emitAck(sa, "chat:join", { matchId: ended.id })).toEqual({ ok: false, error: "This chat has ended." });
    const refused = await emitAck(so, "chat:join", { matchId: active.id });
    expect(refused.ok).toBe(false);
    expect(typeof refused.error).toBe("string");
  });

  it("chat:message is saved, broadcast to both participants, and acked", async () => {
    const { a, match, sa, sb } = await joinedPair();
    const gotA = nextEvent(sa, "chat:message");
    const gotB = nextEvent(sb, "chat:message");
    const ack = await emitAck(sa, "chat:message", { matchId: match.id, content: "  hello there  " });

    expect(ack.ok).toBe(true);
    expect(ack.message).toMatchObject({ matchId: match.id, senderId: a.id, content: "hello there" });
    expect(typeof ack.message.id).toBe("string");
    expect(Date.parse(ack.message.createdAt)).not.toBeNaN();
    expect(await gotA).toEqual(ack.message);
    expect(await gotB).toEqual(ack.message);
    expect(await fx.messageCount(match.id)).toBe(1);
  });

  it("chat:message rejects bad input, un-joined senders and empty content", async () => {
    const { match, sa } = await joinedPair();
    expect(await emitAck(sa, "chat:message", { matchId: "x", content: "hi" })).toEqual({ ok: false, error: "Invalid message." });
    expect(await emitAck(sa, "chat:message", { matchId: match.id })).toEqual({ ok: false, error: "Invalid message." });

    const c = await fx.member();
    const sc = await connectAs(c.id);
    expect(await emitAck(sc, "chat:message", { matchId: match.id, content: "hi" })).toEqual({
      ok: false,
      error: "Join the chat before sending messages.",
    });

    const empty = await emitAck(sa, "chat:message", { matchId: match.id, content: "   " });
    expect(empty.ok).toBe(false);
    expect(await fx.messageCount(match.id)).toBe(0);
  });

  it("a connected participant who never joined cannot send into the match", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const match = await fx.match(a.id, b.id);
    const sa = await connectAs(a.id);
    expect(await emitAck(sa, "chat:message", { matchId: match.id, content: "sneaky" })).toEqual({
      ok: false,
      error: "Join the chat before sending messages.",
    });
    expect(await fx.messageCount(match.id)).toBe(0);
  });

  it("rate-limits chat messages (10 per 10 s) with the Express ack and a rate_limited event", async () => {
    const { match, sa } = await joinedPair();
    const limitedEvent = nextEvent(sa, "rate_limited");
    const acks = [];
    for (let i = 0; i < 11; i++) acks.push(await emitAck(sa, "chat:message", { matchId: match.id, content: `m${i}` }));
    expect(acks.slice(0, 10).every((a) => a.ok)).toBe(true);
    expect(acks[10]).toEqual({ ok: false, error: "You're sending messages too quickly. Please slow down." });
    const event = await limitedEvent;
    expect(event).toMatchObject({ event: "chat:message" });
    expect(event.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    expect(await fx.messageCount(match.id)).toBe(10);
  }, 30_000);

  it("typing indicators reach the other participant only", async () => {
    const { a, match, sa, sb } = await joinedPair();
    const selfHears = arrives(sa, "chat:typing_start");
    const otherHears = nextEvent(sb, "chat:typing_start");
    sa.emit("chat:typing_start", { matchId: match.id });
    expect(await otherHears).toEqual({ userId: a.id });
    expect(await selfHears).toBe(false);

    const stop = nextEvent(sb, "chat:typing_stop");
    sa.emit("chat:typing_stop", { matchId: match.id });
    expect(await stop).toEqual({ userId: a.id });
  });

  it("chat:history pages older messages and requires joining first", async () => {
    const { match, sa } = await joinedPair();
    const sent = [];
    for (let i = 0; i < 3; i++) sent.push((await emitAck(sa, "chat:message", { matchId: match.id, content: `msg ${i}` })).message);

    const page = await emitAck(sa, "chat:history", { matchId: match.id, beforeId: sent[2].id });
    expect(page.ok).toBe(true);
    expect(page.messages.map((m: any) => m.content)).toEqual(["msg 0", "msg 1"]);

    const stranger = await fx.member();
    const ss = await connectAs(stranger.id);
    expect(await emitAck(ss, "chat:history", { matchId: match.id, beforeId: sent[2].id })).toEqual({
      ok: false,
      error: "Join the chat before requesting history.",
    });
    expect(await emitAck(sa, "chat:history", { matchId: "bad", beforeId: "bad" })).toEqual({ ok: false, error: "Invalid request." });
  });

  it("join returns recent history in chronological order", async () => {
    const { match, sa, b } = await joinedPair();
    await emitAck(sa, "chat:message", { matchId: match.id, content: "first" });
    await emitAck(sa, "chat:message", { matchId: match.id, content: "second" });
    const late = await connectAs(b.id); // a second tab for the same user
    const joined = await emitAck(late, "chat:join", { matchId: match.id });
    expect(joined.messages.map((m: any) => m.content)).toEqual(["first", "second"]);
  });

  it("chat:end notifies both, ends the match, and stops further messages and signaling", async () => {
    const { a, match, sa, sb } = await joinedPair();
    const endedA = nextEvent(sa, "chat:ended");
    const endedB = nextEvent(sb, "chat:ended");
    expect(await emitAck(sa, "chat:end", { matchId: match.id })).toEqual({ ok: true });
    expect(await endedA).toEqual({ matchId: match.id, endedBy: a.id });
    expect(await endedB).toEqual({ matchId: match.id, endedBy: a.id });

    const after = await emitAck(sb, "chat:message", { matchId: match.id, content: "too late" });
    expect(after).toEqual({ ok: false, error: "This chat has ended." });

    const offerHeard = arrives(sa, "call:offer");
    sb.emit("call:offer", { matchId: match.id, sdp: { type: "offer", sdp: "v=0" } });
    expect(await offerHeard).toBe(false);
  });

  it("chat:end by a non-participant is refused", async () => {
    const { match } = await joinedPair();
    const intruder = await fx.member();
    const si = await connectAs(intruder.id);
    const res = await emitAck(si, "chat:end", { matchId: match.id });
    expect(res.ok).toBe(false);
    expect(await emitAck(si, "chat:end", { matchId: "nope" })).toEqual({ ok: false, error: "Invalid match id." });
  });

  it("a second tab of the same user also receives the room's messages", async () => {
    const { a, b, match, sa } = await joinedPair();
    const tab2 = await connectAs(a.id);
    await emitAck(tab2, "chat:join", { matchId: match.id });
    const sb2 = await connectAs(b.id);
    await emitAck(sb2, "chat:join", { matchId: match.id });

    const both = Promise.all([nextEvent(sa, "chat:message"), nextEvent(tab2, "chat:message")]);
    await emitAck(sb2, "chat:message", { matchId: match.id, content: "to every tab" });
    const [one, two] = await both;
    expect(one.content).toBe("to every tab");
    expect(two.content).toBe("to every tab");
  });

  it("unknown events are ignored and the connection stays usable", async () => {
    const { match, sa } = await joinedPair();
    sa.emit("definitely:not-an-event", { x: 1 });
    expect(await emitAck(sa, "chat:message", { matchId: match.id, content: "still works" })).toMatchObject({ ok: true });
  });
});

describe("WebRTC signaling between two clients", () => {
  const sdp = { type: "offer", sdp: "v=0\r\no=- 46117 2 IN IP4 127.0.0.1\r\ns=-\r\n" };
  const candidate = { candidate: "candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host", sdpMid: "0", sdpMLineIndex: 0, usernameFragment: "abcd" };

  it("relays offer, answer, ICE candidates and hang-up, with the sender's id, to the other side only", async () => {
    const { a, b, match, sa, sb } = await joinedPair();

    // offer: A -> B
    const offerAtB = nextEvent(sb, "call:offer");
    const offerEchoAtA = arrives(sa, "call:offer");
    sa.emit("call:offer", { matchId: match.id, sdp });
    expect(await offerAtB).toEqual({ sdp, from: a.id });
    expect(await offerEchoAtA).toBe(false);

    // answer: B -> A
    const answer = { type: "answer", sdp: "v=0\r\ns=answer\r\n" };
    const answerAtA = nextEvent(sa, "call:answer");
    sb.emit("call:answer", { matchId: match.id, sdp: answer });
    expect(await answerAtA).toEqual({ sdp: answer, from: b.id });

    // ICE both ways, several in a burst (signaling is deliberately not rate-limited)
    const burst = Array.from({ length: 25 }, (_, i) => ({ ...candidate, candidate: `${candidate.candidate} ${i}` }));
    const received: any[] = [];
    sb.on("call:ice-candidate", (p) => received.push(p));
    for (const c of burst) sa.emit("call:ice-candidate", { matchId: match.id, candidate: c });
    const back = nextEvent(sa, "call:ice-candidate");
    sb.emit("call:ice-candidate", { matchId: match.id, candidate });
    expect(await back).toEqual({ candidate, from: b.id });
    await new Promise((r) => setTimeout(r, 800));
    expect(received).toHaveLength(25);
    expect(received[0]).toEqual({ candidate: burst[0], from: a.id });
    expect(received[24].candidate.candidate).toMatch(/ 24$/);

    // hang-up: ends the call, not the match
    const endedAtB = nextEvent(sb, "call:ended");
    sa.emit("call:end", { matchId: match.id });
    expect(await endedAtB).toEqual({ from: a.id });
    expect(await emitAck(sb, "chat:message", { matchId: match.id, content: "chat survives the call" })).toMatchObject({ ok: true });
  });

  it("accepts the optional ICE fields being null or missing", async () => {
    const { match, sa, sb } = await joinedPair();
    const got = nextEvent(sb, "call:ice-candidate");
    sa.emit("call:ice-candidate", { matchId: match.id, candidate: { candidate: "c", sdpMid: null } });
    expect(await got).toMatchObject({ candidate: { candidate: "c", sdpMid: null } });
  });

  it("drops malformed signaling payloads without delivering them", async () => {
    const { match, sa, sb } = await joinedPair();
    const heard = arrives(sb, "call:offer");
    sa.emit("call:offer", { matchId: match.id, sdp: "not an object" });
    sa.emit("call:offer", { matchId: "bad", sdp });
    sa.emit("call:offer", { sdp });
    sa.emit("call:offer", undefined);
    expect(await heard).toBe(false);
  });

  it("does not relay for a socket that never joined the match", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const match = await fx.match(a.id, b.id);
    const sa = await connectAs(a.id); // connected but not joined
    const sb = await connectAs(b.id);
    await emitAck(sb, "chat:join", { matchId: match.id });
    const heard = arrives(sb, "call:offer");
    sa.emit("call:offer", { matchId: match.id, sdp });
    expect(await heard).toBe(false);
  });

  it("does not relay for an outsider, even one who knows the match id", async () => {
    const { match, sa, sb } = await joinedPair();
    const outsider = await fx.member();
    const so = await connectAs(outsider.id);
    expect((await emitAck(so, "chat:join", { matchId: match.id })).ok).toBe(false);

    const heardA = arrives(sa, "call:offer");
    const heardB = arrives(sb, "call:offer");
    so.emit("call:offer", { matchId: match.id, sdp });
    so.emit("call:end", { matchId: match.id });
    expect(await heardA).toBe(false);
    expect(await heardB).toBe(false);
    expect(await arrives(sb, "call:ended", 300)).toBe(false);
  });

  it("stops relaying once the other side ended the match", async () => {
    const { match, sa, sb } = await joinedPair();
    await emitAck(sb, "chat:end", { matchId: match.id });
    const heard = arrives(sb, "call:ice-candidate");
    sa.emit("call:ice-candidate", { matchId: match.id, candidate });
    expect(await heard).toBe(false);
  });
});

describe("server-initiated pushes and forced disconnects", () => {
  it("emitToUser reaches every live connection of that user and nobody else (dm:message, notification:new)", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const a1 = await connectAs(a.id);
    const a2 = await connectAs(a.id);
    const bs = await connectAs(b.id);

    const dm = { conversationId: crypto.randomUUID(), message: { id: crypto.randomUUID(), body: "hi", createdAt: new Date().toISOString() } };
    const heard = Promise.all([nextEvent(a1, "dm:message"), nextEvent(a2, "dm:message")]);
    const bHears = arrives(bs, "dm:message");
    expect((await post("/__test__/emit", { userId: a.id, event: "dm:message", payload: dm })).status).toBe(200);
    expect(await heard).toEqual([dm, dm]);
    expect(await bHears).toBe(false);

    const note = { id: crypto.randomUUID(), type: "follow" };
    const noteAtB = nextEvent(bs, "notification:new");
    await post("/__test__/emit", { userId: b.id, event: "notification:new", payload: note });
    expect(await noteAtB).toEqual(note);
  });

  it("the emit helper needs the internal secret", async () => {
    const m = await fx.member();
    const res = await post("/__test__/emit", { userId: m.id, event: "x", payload: 1 }, { "content-type": "application/json" });
    expect(res.status).toBe(401);
  });

  it("emitting to a user with no connection is a harmless no-op", async () => {
    const m = await fx.member();
    expect((await post("/__test__/emit", { userId: m.id, event: "dm:message", payload: {} })).status).toBe(200);
  });

  it("an admin ban drops the user's live sockets, and they cannot get back in", async () => {
    const admin = await fx.member({ role: "admin" });
    const victim = await fx.member();
    const other = await fx.member();
    const v1 = await connectAs(victim.id);
    const v2 = await connectAs(victim.id);
    const bystander = await connectAs(other.id);

    const dropped = Promise.all([new Promise((r) => v1.once("disconnect", r)), new Promise((r) => v2.once("disconnect", r))]);
    const res = await fetch(`${worker.baseUrl}/api/admin/users/${victim.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ adminUserId: admin.id, action: "ban" }),
    });
    expect(res.status).toBe(200);
    await dropped;
    expect(v1.connected).toBe(false);
    expect(v2.connected).toBe(false);
    expect(bystander.connected).toBe(true);

    const again = await post("/api/matchmaking/socket-ticket", { userId: victim.id });
    expect(again.status).toBe(403);
  });

  it("an admin delete also drops the user's live sockets", async () => {
    const admin = await fx.member({ role: "admin" });
    const victim = await fx.member();
    const sv = await connectAs(victim.id);
    const dropped = new Promise((r) => sv.once("disconnect", r));
    const res = await fetch(`${worker.baseUrl}/api/admin/users/${victim.id}?adminUserId=${admin.id}`, { method: "DELETE", headers: SECRET });
    expect(res.status).toBe(200);
    await dropped;
    expect(sv.connected).toBe(false);
  });
});

describe("readiness and build hygiene", () => {
  it("a normal build contains no test-only routes; only EDGE_TEST_HOOKS=1 adds them", () => {
    const out = (hooks: string) => {
      const file = path.join(os.tmpdir(), `edge-build-${hooks}-${process.pid}.mjs`);
      const run = spawnSync(process.execPath, [path.resolve(import.meta.dirname, "../scripts/build.mjs")], {
        env: { ...process.env, EDGE_TEST_HOOKS: hooks, EDGE_BUILD_OUT: file },
        encoding: "utf8",
      });
      expect(run.status, run.stderr).toBe(0);
      const text = readFileSync(file, "utf8");
      rmSync(file);
      return text;
    };
    expect(out("0")).not.toContain("__test__/emit");
    expect(out("1")).toContain("__test__/emit");
  });

  it("readiness reports Postgres and the real-time layer, and makes no claim about Redis", async () => {
    const res = await fetch(`${worker.baseUrl}/api/health/ready`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", dependencies: { postgres: "ok", realtime: "ok" } });
  });
});
