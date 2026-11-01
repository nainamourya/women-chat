import { SOCKET_TICKET_TTL_MS, getRequestContext, ticketStoreFor } from "../realtime/env";

// Build-time replacement for apps/server/src/redis/socketTickets.ts (see
// scripts/build.mjs): a random UUID, valid for 30 s, stored in the TicketStore
// Durable Object (Conn consumes it on the Socket.IO handshake).
export async function mintSocketTicket(userId: string): Promise<string> {
  const { env } = getRequestContext();
  const ticket = crypto.randomUUID();
  await ticketStoreFor(env, ticket).mint(ticket, userId, SOCKET_TICKET_TTL_MS);
  return ticket;
}
