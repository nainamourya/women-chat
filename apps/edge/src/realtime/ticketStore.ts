import { DurableObject } from "cloudflare:workers";
import type { RealtimeEnv } from "./env";

type StoredTicket = { userId: string; expiresAt: number };

// Replaces apps/server/src/redis/socketTickets.ts (SET ... EX 30 / GET + DEL).
// One-time by construction: consume() reads and deletes inside
// blockConcurrencyWhile, so no other call to this object can run between the
// read and the delete — two simultaneous consumes of the same ticket cannot
// both succeed.
export class TicketStore extends DurableObject<RealtimeEnv> {
  async mint(ticket: string, userId: string, ttlMs: number): Promise<void> {
    const expiresAt = Date.now() + ttlMs;
    await this.ctx.storage.put<StoredTicket>(ticket, { userId, expiresAt });
    // Housekeeping only; expiry itself is enforced in consume().
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > expiresAt) await this.ctx.storage.setAlarm(expiresAt);
  }

  async consume(ticket: string): Promise<string | null> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<StoredTicket>(ticket);
      if (!stored) return null;
      await this.ctx.storage.delete(ticket);
      return stored.expiresAt > Date.now() ? stored.userId : null;
    });
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    const all = await this.ctx.storage.list<StoredTicket>();
    let next: number | null = null;
    for (const [key, value] of all) {
      if (value.expiresAt <= now) await this.ctx.storage.delete(key);
      else next = next === null ? value.expiresAt : Math.min(next, value.expiresAt);
    }
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }
}
