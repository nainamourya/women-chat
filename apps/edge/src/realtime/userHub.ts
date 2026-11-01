import { DurableObject } from "cloudflare:workers";
import { connFor, type RealtimeEnv } from "./env";

// One UserHub per user. It replaces three Express/Redis pieces at once:
//  - the private `user:<id>` Socket.IO room (emitToUser, disconnectUser),
//  - the Redis connection-lease sorted set (admitConnection / releaseConnection),
//  - the Redis adapter's cross-instance fan-out, for the two participants of a
//    match: each participant's UserHub forwards to that user's live sockets.
//
// The live sockets themselves are held by Conn objects (one per WebSocket); this
// object only keeps the list of connection ids. Because the list is exact (a
// socket registers on connect and unregisters on close), the concurrent-
// connection cap needs no lease or heartbeat. A connection that vanished without
// a close event is detected the next time the user hits the cap, by asking the
// Conn whether it is still alive — the same "self-heal on the next admission"
// idea as the Redis lease, without a timer.
export class UserHub extends DurableObject<RealtimeEnv> {
  private async load(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>("conns")) ?? [];
  }

  private async save(conns: string[]): Promise<void> {
    if (conns.length === 0) await this.ctx.storage.delete("conns");
    else await this.ctx.storage.put("conns", conns);
  }

  async admit(connectionId: string, limit: number): Promise<boolean> {
    let conns = await this.load();
    if (conns.length >= limit) {
      const alive = await Promise.all(
        conns.map(async (id) => {
          try {
            return await connFor(this.env, id).isAlive();
          } catch {
            return false;
          }
        }),
      );
      const dead = new Set(conns.filter((_, i) => !alive[i]));
      // Re-read: other admissions/releases may have run while we were asking.
      conns = (await this.load()).filter((id) => !dead.has(id));
    }
    if (conns.length >= limit) {
      await this.save(conns);
      return false;
    }
    if (!conns.includes(connectionId)) conns.push(connectionId);
    await this.save(conns);
    return true;
  }

  async release(connectionId: string): Promise<void> {
    await this.save((await this.load()).filter((id) => id !== connectionId));
  }

  async count(): Promise<number> {
    return (await this.load()).length;
  }

  // Runs `call` against every registered connection and forgets the ones that
  // report they are gone.
  private async fanOut(call: (conn: ReturnType<typeof connFor>, id: string) => Promise<boolean>): Promise<void> {
    const conns = await this.load();
    const results = await Promise.allSettled(conns.map((id) => call(connFor(this.env, id), id)));
    const gone = new Set(conns.filter((_, i) => {
      const r = results[i];
      return r.status === "rejected" || r.value === false;
    }));
    if (gone.size > 0) await this.save((await this.load()).filter((id) => !gone.has(id)));
  }

  /** `io.to("user:<id>").emit(event, payload)` */
  async emit(event: string, payload: unknown): Promise<void> {
    await this.fanOut((conn) => conn.deliver(event, payload));
  }

  /** `socket.to("match:<id>").emit(...)` for this user's sockets (the sender is excluded). */
  async deliverToMatch(matchId: string, event: string, payload: unknown, exceptConnectionId?: string): Promise<void> {
    await this.fanOut((conn, id) => (id === exceptConnectionId ? Promise.resolve(true) : conn.deliver(event, payload, matchId)));
  }

  /** Is any of this user's sockets in the match room? (`fetchSockets` in the call:ready check.) */
  async hasMatchSocket(matchId: string): Promise<boolean> {
    const conns = await this.load();
    const found = await Promise.allSettled(conns.map((id) => connFor(this.env, id).inMatch(matchId)));
    return found.some((r) => r.status === "fulfilled" && r.value === true);
  }

  /** `io.in("match:<id>").socketsLeave(...)` for this user's sockets. */
  async leaveMatch(matchId: string, exceptConnectionId?: string): Promise<void> {
    await this.fanOut(async (conn, id) => (id === exceptConnectionId ? true : conn.leaveMatch(matchId)));
  }

  /** `io.in("user:<id>").disconnectSockets(true)` — used when an account is banned, suspended or deleted. */
  async disconnectAll(): Promise<void> {
    const conns = await this.load();
    await Promise.allSettled(conns.map((id) => connFor(this.env, id).disconnect()));
    await this.save([]);
  }
}
