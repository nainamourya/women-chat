import { DurableObject } from "cloudflare:workers";
import type { RealtimeEnv } from "./env";

// Replaces apps/server/src/redis/matchmakingQueue.ts. The Redis version made the
// join atomic with a Lua script; here the same logic runs inside one Durable
// Object, which executes one call at a time, and every method below does its
// reads and writes in a single synchronous transaction, so two joins can never
// claim the same waiting user and a user can never be queued twice.
//
// Faithful to the script, rule by rule:
//  - the queue is FIFO: new users go on the head (LPUSH), the oldest is taken
//    from the tail (RPOP);
//  - a user who is already waiting gets "already_waiting" and nothing changes;
//  - a candidate equal to the caller is discarded;
//  - candidates in the caller's block list (either direction) are skipped, then
//    pushed back on the head so other users can still match them;
//  - a candidate whose waiting marker has expired is discarded (stale);
//  - a claimed candidate's marker is deleted, so nobody else can claim them;
//  - otherwise the caller goes on the head and gets a 20 s waiting marker.
// The marker is refreshed by the client's status poll, so a closed tab falls off.

export const WAITING_TTL_SECONDS = 20;

export type JoinQueueResult =
  | { state: "already_waiting" }
  | { state: "matched"; candidateId: string }
  | { state: "waiting" };

export class Matchmaker extends DurableObject<RealtimeEnv> {
  constructor(ctx: DurableObjectState, env: RealtimeEnv) {
    super(ctx, env);
    const sql = ctx.storage.sql;
    // `pos` orders the queue; the head gets ever-smaller numbers, the tail is the largest.
    sql.exec("CREATE TABLE IF NOT EXISTS queue (pos INTEGER PRIMARY KEY, user_id TEXT NOT NULL)");
    sql.exec("CREATE INDEX IF NOT EXISTS queue_user_idx ON queue (user_id)");
    sql.exec("CREATE TABLE IF NOT EXISTS waiting (user_id TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)");
  }

  private isLive(userId: string, now: number): boolean {
    const row = this.ctx.storage.sql.exec("SELECT expires_at FROM waiting WHERE user_id = ?", userId).toArray()[0];
    return row !== undefined && (row.expires_at as number) > now;
  }

  private pushHead(userId: string): void {
    const sql = this.ctx.storage.sql;
    const head = sql.exec("SELECT MIN(pos) AS pos FROM queue").one().pos as number | null;
    sql.exec("INSERT INTO queue (pos, user_id) VALUES (?, ?)", head === null ? 0 : head - 1, userId);
  }

  join(userId: string, blockedIds: string[] = []): JoinQueueResult {
    return this.ctx.storage.transactionSync((): JoinQueueResult => {
      const sql = this.ctx.storage.sql;
      const now = Date.now();

      if (this.isLive(userId, now)) return { state: "already_waiting" };

      const blocked = new Set(blockedIds);
      const skipped: string[] = [];
      let matched: string | null = null;

      for (;;) {
        const row = sql.exec("SELECT pos, user_id FROM queue ORDER BY pos DESC LIMIT 1").toArray()[0];
        if (!row) break;
        sql.exec("DELETE FROM queue WHERE pos = ?", row.pos);
        const candidate = row.user_id as string;
        if (candidate === userId) {
          // defensive, as in the Redis script
        } else if (blocked.has(candidate)) {
          skipped.push(candidate);
        } else if (this.isLive(candidate, now)) {
          sql.exec("DELETE FROM waiting WHERE user_id = ?", candidate);
          matched = candidate;
          break;
        }
        // else: stale (marker expired) - dropped
      }

      for (const id of skipped) this.pushHead(id);

      if (matched) return { state: "matched", candidateId: matched };

      this.pushHead(userId);
      sql.exec("INSERT OR REPLACE INTO waiting (user_id, expires_at) VALUES (?, ?)", userId, now + WAITING_TTL_SECONDS * 1000);
      return { state: "waiting" };
    });
  }

  async afterJoin(): Promise<void> {
    // Housekeeping only (matching already ignores stale entries): sweep them out
    // shortly after they expire so the queue cannot grow without bound.
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + (WAITING_TTL_SECONDS + 5) * 1000);
    }
  }

  leave(userId: string): void {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("DELETE FROM queue WHERE user_id = ?", userId);
      this.ctx.storage.sql.exec("DELETE FROM waiting WHERE user_id = ?", userId);
    });
  }

  waiting(userId: string): boolean {
    return this.isLive(userId, Date.now());
  }

  // Slides the marker forward for a user who is still waiting (EXPIRE on a live key).
  refresh(userId: string): void {
    const now = Date.now();
    this.ctx.storage.sql.exec(
      "UPDATE waiting SET expires_at = ? WHERE user_id = ? AND expires_at > ?",
      now + WAITING_TTL_SECONDS * 1000,
      userId,
      now,
    );
  }

  async alarm(): Promise<void> {
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM waiting WHERE expires_at <= ?", Date.now());
      sql.exec("DELETE FROM queue WHERE user_id NOT IN (SELECT user_id FROM waiting)");
    });
    const remaining = sql.exec("SELECT COUNT(*) AS n FROM queue").one().n as number;
    if (remaining > 0) await this.ctx.storage.setAlarm(Date.now() + (WAITING_TTL_SECONDS + 5) * 1000);
  }
}
