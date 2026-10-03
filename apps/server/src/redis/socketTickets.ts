import { randomUUID } from "node:crypto";
import { redis } from "./client.js";

const TICKET_PREFIX = "mm:socket-ticket:";
const TICKET_TTL_SECONDS = 30;

// The browser connects its Socket.IO client directly to this server (a
// websocket can't be proxied through a Next.js Route Handler the way REST
// calls are), so it can't carry the session cookie/JWT used elsewhere. A
// one-time ticket — minted server-to-server after the Next.js app has
// already verified the session — lets the socket handshake prove "this
// connection belongs to user X" without the browser ever holding or
// supplying a raw user id as a trust boundary.
export async function mintSocketTicket(userId: string): Promise<string> {
  const ticket = randomUUID();
  await redis.set(TICKET_PREFIX + ticket, userId, "EX", TICKET_TTL_SECONDS);
  return ticket;
}

export async function consumeSocketTicket(ticket: string): Promise<string | null> {
  const key = TICKET_PREFIX + ticket;
  const userId = await redis.get(key);
  if (!userId) return null;
  await redis.del(key);
  return userId;
}
