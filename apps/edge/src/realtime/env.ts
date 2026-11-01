import { AsyncLocalStorage } from "node:async_hooks";
import type { DbEnv } from "../db";
import type { Conn } from "./conn";
import type { Limiter } from "./limiter";
import type { TicketStore } from "./ticketStore";
import type { UserHub } from "./userHub";

// Everything the real-time layer needs from the Worker's bindings.
export interface RealtimeEnv extends DbEnv {
  CONN: DurableObjectNamespace<Conn>;
  USER_HUB: DurableObjectNamespace<UserHub>;
  TICKETS: DurableObjectNamespace<TicketStore>;
  LIMITER: DurableObjectNamespace<Limiter>;
}

// Server code that is reused unchanged (for example the notification service's
// `emitToUser`, or the admin ban's `disconnectUser`) has no `env` parameter —
// the Express server reached for a module-level Socket.IO instance instead.
// The Worker's equivalent is the current request's bindings, kept in
// AsyncLocalStorage (see index.ts).
type RequestContext = { env: RealtimeEnv; ctx: ExecutionContext };
const requestContext = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(env: RealtimeEnv, ctx: ExecutionContext, fn: () => T): T {
  return requestContext.run({ env, ctx }, fn);
}

export function getRequestContext(): RequestContext {
  const current = requestContext.getStore();
  if (!current) throw new Error("No request context: real-time helpers were used outside a request");
  return current;
}

// The same limits as the Express server, in one place.
export const DEFAULT_CONCURRENT_CONNECTION_LIMIT = 3;
export const SOCKET_TICKET_TTL_MS = 30_000;
export const SOCKET_TICKET_LIMIT = 10;
export const SOCKET_TICKET_WINDOW_SECONDS = 60;

// Typed accessors, so no other file builds a Durable Object name by hand.
export const hubFor = (env: RealtimeEnv, userId: string) => env.USER_HUB.get(env.USER_HUB.idFromName(userId));
export const connFor = (env: RealtimeEnv, connectionId: string) => env.CONN.get(env.CONN.idFromString(connectionId));
export const limiterFor = (env: RealtimeEnv, key: string) => env.LIMITER.get(env.LIMITER.idFromName(key));

// Tickets are random UUIDs minted by this Worker. Only that exact shape is ever
// allowed to reach a Durable Object name, so a client cannot make us create
// objects with names of its choosing. 256 shards by the first two hex digits.
const TICKET_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isTicketShape = (ticket: string) => TICKET_SHAPE.test(ticket);
export const ticketStoreFor = (env: RealtimeEnv, ticket: string) =>
  env.TICKETS.get(env.TICKETS.idFromName(`ticket-shard:${ticket.slice(0, 2)}`));
