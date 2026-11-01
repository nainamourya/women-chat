import { io, type Socket } from "socket.io-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { TEST_INTERNAL_SECRET, startLocalWorker, type RunningWorker } from "./localWorker";
import { Fixtures } from "./seed";

// Exercises the server's own matchmaking router and service, running on the
// Worker with the Matchmaker Durable Object in place of the Redis queue.
const SECRET = { "x-internal-api-secret": TEST_INTERNAL_SECRET };
const JSON_HEADERS = { ...SECRET, "content-type": "application/json" };

let worker: RunningWorker;
let fx: Fixtures;
const sockets: Socket[] = [];
const touched = new Set<string>();

beforeAll(async () => {
  fx = new Fixtures();
  worker = await startLocalWorker(8830);
});
afterEach(async () => {
  // Nobody may be left in the (shared) queue for the next test to match with.
  for (const id of touched) await call("POST", "/api/matchmaking/leave", { userId: id });
  touched.clear();
  sockets.splice(0).forEach((s) => s.close());
});
afterAll(async () => {
  worker?.stop();
  await fx?.cleanup();
});

async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = JSON_HEADERS) {
  const res = await fetch(`${worker.baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => undefined)) as Record<string, any> | undefined;
  return { status: res.status, json, headers: res.headers };
}

const join = (userId: string) => {
  touched.add(userId);
  return call("POST", "/api/matchmaking/join", { userId });
};
const leave = (userId: string) => call("POST", "/api/matchmaking/leave", { userId });
const status = (userId: string) => call("GET", `/api/matchmaking/status/${userId}`, undefined, SECRET);

describe("REST: authentication, validation and eligibility", () => {
  it("requires the internal secret on every route", async () => {
    const id = (await fx.member()).id;
    const open = { "content-type": "application/json" };
    for (const [method, path, body] of [
      ["POST", "/api/matchmaking/join", { userId: id }],
      ["POST", "/api/matchmaking/leave", { userId: id }],
      ["GET", `/api/matchmaking/status/${id}`, undefined],
    ] as const) {
      const res = await call(method, path, body, open);
      expect(res.status, path).toBe(401);
      expect(res.json).toEqual({ error: "Unauthorized." });
    }
  });

  it("rejects malformed user ids with 400", async () => {
    for (const [method, path, body] of [
      ["POST", "/api/matchmaking/join", { userId: "nope" }],
      ["POST", "/api/matchmaking/join", {}],
      ["POST", "/api/matchmaking/leave", { userId: 5 }],
      ["GET", "/api/matchmaking/status/not-a-uuid", undefined],
    ] as const) {
      const res = await call(method, path, body, method === "GET" ? SECRET : JSON_HEADERS);
      expect(res.status, path).toBe(400);
      expect(res.json).toEqual({ error: "Invalid user id." });
    }
  });

  it("an unknown user cannot join (404)", async () => {
    const res = await join(crypto.randomUUID());
    expect(res.status).toBe(404);
    expect(res.json).toEqual({ error: "User not found." });
  });

  it("only eligible members can join: unverified, no age confirmation, banned and suspended are refused and never queued", async () => {
    const refused = [
      await fx.member({ verificationStatus: "unverified" }),
      await fx.member({ ageConfirmed18: false }),
      await fx.member({ accountStatus: "banned" }),
      await fx.member({ accountStatus: "suspended", suspendedUntil: new Date(Date.now() + 86_400_000) }),
    ];
    for (const user of refused) {
      const res = await join(user.id);
      expect(res.status, user.id).toBe(403);
      expect(res.json).not.toHaveProperty("state");
      expect((await status(user.id)).json).toEqual({ state: "idle" });
    }
    // None of them is in the queue: a real member who joins just waits.
    const member = await fx.member();
    expect((await join(member.id)).json).toEqual({ state: "waiting" });
  });
});

describe("matching rules", () => {
  it("the second joiner is matched with the waiting user, and both see the same match with the other's intro", async () => {
    const a = await fx.member({ displayName: "Asha" });
    const b = await fx.member({ displayName: "Bela" });
    await fx.setBio(a.id, "Likes hiking");

    expect((await join(a.id)).json).toEqual({ state: "waiting" });
    const joined = await join(b.id);
    expect(joined.status).toBe(200);
    expect(joined.json).toEqual({
      state: "matched",
      matchId: expect.any(String),
      otherUserId: a.id,
      otherDisplayName: "Asha",
      otherBio: "Likes hiking",
    });

    const seenByA = await status(a.id);
    expect(seenByA.json).toEqual({
      state: "matched",
      matchId: joined.json!.matchId,
      otherUserId: b.id,
      otherDisplayName: "Bela",
      otherBio: null,
    });

    const matches = await fx.activeMatches(a.id);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ id: joined.json!.matchId, userAId: a.id, userBId: b.id, status: "active" });
  });

  it("a user is never matched with themselves, even when joining repeatedly", async () => {
    const a = await fx.member();
    for (let i = 0; i < 3; i++) expect((await join(a.id)).json).toEqual({ state: "waiting" });
    expect((await status(a.id)).json).toEqual({ state: "waiting" });
    expect(await fx.activeMatches(a.id)).toHaveLength(0);
  });

  it("a duplicate join does not queue the user twice", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const c = await fx.member();
    await join(a.id);
    await join(a.id); // double-click
    expect((await join(b.id)).json).toMatchObject({ state: "matched", otherUserId: a.id });
    // If A had been queued twice, C would be matched with a ghost entry.
    expect((await join(c.id)).json).toEqual({ state: "waiting" });
    expect(await fx.activeMatches(a.id)).toHaveLength(1);
  });

  it("five simultaneous joins by one user still queue them once", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const c = await fx.member();
    const results = await Promise.all(Array.from({ length: 5 }, () => join(a.id)));
    expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(results.every((r) => r.json!.state === "waiting")).toBe(true);
    expect((await join(b.id)).json).toMatchObject({ state: "matched", otherUserId: a.id });
    expect((await join(c.id)).json).toEqual({ state: "waiting" });
  });

  it("a user already in an active match gets that match back instead of a new one", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const c = await fx.member();
    await join(a.id);
    const first = await join(b.id);
    const again = await join(b.id);
    expect(again.json).toMatchObject({ state: "matched", matchId: first.json!.matchId, otherUserId: a.id });
    // Not queued either: C does not match B.
    expect((await join(c.id)).json).toEqual({ state: "waiting" });
    expect(await fx.activeMatches(b.id)).toHaveLength(1);
  });

  it("blocked pairs are never matched, in either direction, and the skipped user is not lost", async () => {
    for (const blocker of ["a", "b"] as const) {
      const a = await fx.member();
      const b = await fx.member();
      const c = await fx.member();
      if (blocker === "a") await fx.block(a.id, b.id);
      else await fx.block(b.id, a.id);

      await join(a.id);
      // B is blocked with A (either way): B must wait, not match.
      expect((await join(b.id)).json).toEqual({ state: "waiting" });
      expect(await fx.activeMatches(a.id)).toHaveLength(0);
      // A was skipped, not lost: C is matched with A (the oldest eligible).
      const c2 = await join(c.id);
      expect(c2.json, `blocker=${blocker}`).toMatchObject({ state: "matched", otherUserId: a.id });
      // And B is still waiting.
      expect((await status(b.id)).json).toEqual({ state: "waiting" });
      // Leave the shared queue clean for the next iteration.
      await leave(b.id);
    }
  });

  it("matches the oldest eligible waiting user first (FIFO)", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const c = await fx.member();
    const d = await fx.member();
    // A and B are blocked, so both stay in the queue; A is older.
    await fx.block(a.id, b.id);
    await join(a.id);
    await join(b.id);
    expect((await join(c.id)).json).toMatchObject({ otherUserId: a.id });
    expect((await join(d.id)).json).toMatchObject({ otherUserId: b.id });
  });

  it("many simultaneous joins: everyone ends up in at most one match, nobody twice, nobody with themselves", async () => {
    const users = await Promise.all(Array.from({ length: 21 }, () => fx.member()));
    const joins = await Promise.all(users.map((u) => join(u.id)));
    expect(joins.every((r) => r.status === 200)).toBe(true);

    const statuses = await Promise.all(users.map((u) => status(u.id)));
    const matched = statuses.filter((s) => s.json!.state === "matched");
    const waiting = statuses.filter((s) => s.json!.state === "waiting");
    expect(matched).toHaveLength(20); // 10 pairs
    expect(waiting).toHaveLength(1); // the odd one out waits

    // Every match is symmetric, between two different people, and unique.
    const byUser = new Map(users.map((u, i) => [u.id, statuses[i].json!]));
    for (const [id, s] of byUser) {
      if (s.state !== "matched") continue;
      expect(s.otherUserId).not.toBe(id);
      const theirs = byUser.get(s.otherUserId)!;
      expect(theirs).toMatchObject({ state: "matched", matchId: s.matchId, otherUserId: id });
    }
    for (const u of users) expect((await fx.activeMatches(u.id)).length, u.id).toBeLessThanOrEqual(1);
  }, 60_000);
});

describe("cancellation", () => {
  it("leave removes a waiting user from the queue and says so", async () => {
    const a = await fx.member();
    const b = await fx.member();
    await join(a.id);
    const left = await leave(a.id);
    expect(left.status).toBe(200);
    expect(left.json).toEqual({ state: "idle" });
    expect((await status(a.id)).json).toEqual({ state: "idle" });
    // A is really gone: B just waits.
    expect((await join(b.id)).json).toEqual({ state: "waiting" });
  });

  it("leave when not waiting is a harmless no-op", async () => {
    const a = await fx.member();
    expect((await leave(a.id)).json).toEqual({ state: "idle" });
  });

  it("a user in an active match cannot leave (409) and stays matched", async () => {
    const a = await fx.member();
    const b = await fx.member();
    await join(a.id);
    const matched = await join(b.id);
    const res = await leave(b.id);
    expect(res.status).toBe(409);
    expect(res.json).toEqual({ error: "Cannot leave matchmaking: already in an active match." });
    expect((await status(b.id)).json).toMatchObject({ state: "matched", matchId: matched.json!.matchId });
  });

  it("a user can rejoin after leaving", async () => {
    const a = await fx.member();
    const b = await fx.member();
    await join(a.id);
    await leave(a.id);
    expect((await join(a.id)).json).toEqual({ state: "waiting" });
    expect((await join(b.id)).json).toMatchObject({ state: "matched", otherUserId: a.id });
  });
});

describe("rate limits", () => {
  it("join: 5 per 10 s, then a generic 429 with Retry-After", async () => {
    const a = await fx.member();
    for (let i = 0; i < 5; i++) expect((await join(a.id)).status).toBe(200);
    const limited = await join(a.id);
    expect(limited.status).toBe(429);
    expect(limited.json).toEqual({ error: "Too many attempts. Please try again later." });
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
    // Other users are unaffected.
    expect((await join((await fx.member()).id)).status).toBe(200);
  });

  it("leave: 5 per 10 s", async () => {
    const a = await fx.member();
    for (let i = 0; i < 5; i++) expect((await leave(a.id)).status).toBe(200);
    expect((await leave(a.id)).status).toBe(429);
  });

  it("status: 30 per 30 s", async () => {
    const a = await fx.member();
    for (let i = 0; i < 30; i++) expect((await status(a.id)).status).toBe(200);
    expect((await status(a.id)).status).toBe(429);
  });
});

describe("stale queue entries", () => {
  it("a waiting user who stops polling expires after 20 s; one who keeps polling stays", async () => {
    const quiet = await fx.member(); // closes the tab: never polls again
    const polling = await fx.member(); // keeps the tab open
    const newcomer = await fx.member();
    await fx.block(quiet.id, polling.id); // so they queue side by side instead of matching each other

    await join(quiet.id);
    await join(polling.id);
    await new Promise((r) => setTimeout(r, 12_000));
    expect((await status(polling.id)).json).toEqual({ state: "waiting" }); // refreshes its marker
    await new Promise((r) => setTimeout(r, 10_000)); // t ≈ 22 s: quiet is stale, polling is not

    const joined = await join(newcomer.id);
    // The stale entry is discarded, not matched; the live one is matched.
    expect(joined.json).toMatchObject({ state: "matched", otherUserId: polling.id });
    expect((await status(quiet.id)).json).toEqual({ state: "idle" });
    expect(await fx.activeMatches(quiet.id)).toHaveLength(0);
  }, 60_000);

  it("a user whose entry went stale can join again", async () => {
    const a = await fx.member();
    const b = await fx.member();
    await join(a.id);
    await new Promise((r) => setTimeout(r, 21_000));
    expect((await status(a.id)).json).toEqual({ state: "idle" });
    expect((await join(a.id)).json).toEqual({ state: "waiting" });
    expect((await join(b.id)).json).toMatchObject({ state: "matched", otherUserId: a.id });
    expect(await fx.activeMatches(a.id)).toHaveLength(1);
  }, 60_000);
});

// ---- socket events ---------------------------------------------------------------

async function connectAs(userId: string): Promise<Socket> {
  const ticket = (await call("POST", "/api/matchmaking/socket-ticket", { userId })).json!.ticket as string;
  const socket = io(worker.baseUrl, { transports: ["websocket"], auth: { ticket }, reconnection: false, forceNew: true });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once("connect", () => resolve());
    socket.once("connect_error", (err) => reject(new Error(err.message)));
  });
  return socket;
}

const record = (socket: Socket) => {
  const seen: Array<{ event: string; payload: unknown }> = [];
  socket.onAny((event, payload) => {
    if (event.startsWith("matchmaking:")) seen.push({ event, payload });
  });
  return seen;
};
const settleEvents = () => new Promise((r) => setTimeout(r, 700));

describe("matchmaking:* events over the real-time path", () => {
  it("started + waiting for the joiner, then started + match_found for the second joiner and match_found for the first", async () => {
    const a = await fx.member({ displayName: "Asha" });
    const b = await fx.member({ displayName: "Bela" });
    await fx.setBio(b.id, "Chess");
    const sa = await connectAs(a.id);
    const sb = await connectAs(b.id);
    const atA = record(sa);
    const atB = record(sb);

    await join(a.id);
    await settleEvents();
    expect(atA).toEqual([
      { event: "matchmaking:started", payload: {} },
      { event: "matchmaking:waiting", payload: {} },
    ]);

    const matched = await join(b.id);
    await settleEvents();
    expect(atB).toEqual([
      { event: "matchmaking:started", payload: {} },
      {
        event: "matchmaking:match_found",
        payload: { matchId: matched.json!.matchId, otherUserId: a.id, otherDisplayName: "Asha", otherBio: null },
      },
    ]);
    expect(atA.slice(2)).toEqual([
      {
        event: "matchmaking:match_found",
        payload: { matchId: matched.json!.matchId, otherUserId: b.id, otherDisplayName: "Bela", otherBio: "Chess" },
      },
    ]);
  });

  it("leave sends matchmaking:cancelled", async () => {
    const a = await fx.member();
    const sa = await connectAs(a.id);
    const seen = record(sa);
    await join(a.id);
    await leave(a.id);
    await settleEvents();
    expect(seen.map((e) => e.event)).toEqual(["matchmaking:started", "matchmaking:waiting", "matchmaking:cancelled"]);
    expect(seen[2].payload).toEqual({});
  });

  it("events reach every connection of the user and nobody else", async () => {
    const a = await fx.member();
    const other = await fx.member();
    const a1 = await connectAs(a.id);
    const a2 = await connectAs(a.id);
    const bystander = await connectAs(other.id);
    const seen1 = record(a1);
    const seen2 = record(a2);
    const seenOther = record(bystander);
    await join(a.id);
    await settleEvents();
    expect(seen1.map((e) => e.event)).toEqual(["matchmaking:started", "matchmaking:waiting"]);
    expect(seen2.map((e) => e.event)).toEqual(["matchmaking:started", "matchmaking:waiting"]);
    expect(seenOther).toEqual([]);
  });

  it("a failed or missing delivery is recoverable: the match is saved and status finds it", async () => {
    const a = await fx.member();
    const b = await fx.member();
    await join(a.id); // A has no socket open at all
    const matched = await join(b.id);
    expect(matched.json).toMatchObject({ state: "matched" });
    expect((await status(a.id)).json).toMatchObject({ state: "matched", matchId: matched.json!.matchId, otherUserId: b.id });
  });

  it("a socket disconnect does not remove a waiting user (liveness is the status poll, as on Express)", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const sa = await connectAs(a.id);
    await join(a.id);
    sa.close();
    await settleEvents();
    expect((await status(a.id)).json).toEqual({ state: "waiting" });
    expect((await join(b.id)).json).toMatchObject({ state: "matched", otherUserId: a.id });
  });

  it("the match found over REST is the room both users can then join over the socket", async () => {
    const a = await fx.member();
    const b = await fx.member();
    const sa = await connectAs(a.id);
    const sb = await connectAs(b.id);
    await join(a.id);
    const matched = await join(b.id);
    const matchId = matched.json!.matchId as string;
    const ack = (s: Socket) => new Promise<any>((resolve) => s.emit("chat:join", { matchId }, resolve));
    expect(await ack(sa)).toMatchObject({ ok: true, otherUserId: b.id });
    expect(await ack(sb)).toMatchObject({ ok: true, otherUserId: a.id });
  });
});

describe("database failure", () => {
  let broken: RunningWorker;
  beforeAll(async () => {
    broken = await startLocalWorker(8831, { databaseUrl: "postgresql://u:p@127.0.0.1:1/unreachable_test" });
  });
  afterAll(() => broken?.stop());

  it("join, leave and status answer the generic 500 and leak nothing", async () => {
    const id = crypto.randomUUID();
    const calls = [
      fetch(`${broken.baseUrl}/api/matchmaking/join`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ userId: id }) }),
      fetch(`${broken.baseUrl}/api/matchmaking/leave`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ userId: id }) }),
      fetch(`${broken.baseUrl}/api/matchmaking/status/${id}`, { headers: SECRET }),
    ];
    for (const res of await Promise.all(calls)) {
      expect(res.status).toBe(500);
      const text = await res.text();
      expect(JSON.parse(text)).toEqual({ error: "Something went wrong." });
      expect(text).not.toMatch(/127\.0\.0\.1|ECONNREFUSED|postgres|u:p/i);
    }
  });
});
