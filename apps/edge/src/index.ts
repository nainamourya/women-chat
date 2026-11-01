import { httpServerHandler } from "cloudflare:node";
import { app } from "./app";
import { getConfig } from "./config";
import { withDb } from "./db";
import { runWithRequestContext, type RealtimeEnv } from "./realtime/env";

// Durable Object classes must be exported from the Worker entry.
export { Conn } from "./realtime/conn";
export { UserHub } from "./realtime/userHub";
export { TicketStore } from "./realtime/ticketStore";
export { Limiter } from "./realtime/limiter";

// The Express app runs behind Workers' Node HTTP bridge. No signal handlers,
// no server lifecycle: the platform owns the process.
app.listen(8080);
const handler = httpServerHandler({ port: 8080 });

// The Socket.IO endpoint. Only the WebSocket transport is served: a Durable
// Object can hold a WebSocket, but not an HTTP long-poll session, so the client
// must connect with `transports: ["websocket"]`. (That is the one change the web
// app needs; it is not made in this stage.)
function isSocketIoPath(pathname: string): boolean {
  return pathname === "/socket.io" || pathname === "/socket.io/";
}

function handleSocketRequest(request: Request, env: RealtimeEnv): Promise<Response> | Response {
  // Same fail-closed rule as every other route.
  if (!getConfig().ok) return Response.json({ error: "Service unavailable." }, { status: 503 });

  const url = new URL(request.url);
  // Engine.IO error shape, as a Socket.IO client expects it.
  if (url.searchParams.get("EIO") !== "4") {
    return Response.json({ code: 5, message: "Unsupported protocol version" }, { status: 400 });
  }
  if (url.searchParams.get("transport") !== "websocket" || request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return Response.json({ code: 0, message: "Transport unknown (this server supports the websocket transport only)" }, { status: 400 });
  }
  // One Durable Object per connection. Authentication happens inside it, on the
  // Socket.IO CONNECT packet, exactly as the Express server did.
  return env.CONN.get(env.CONN.newUniqueId()).fetch(request);
}

export default {
  fetch(request: Request<unknown, IncomingRequestCfProperties>, env: RealtimeEnv, ctx: ExecutionContext): Promise<Response> | Response {
    if (isSocketIoPath(new URL(request.url).pathname)) return handleSocketRequest(request, env);

    // Every request gets its own database client, closed when the request ends
    // (including when a handler throws) — see db.ts. The request's bindings are
    // also made available to reused server code that has no `env` parameter.
    return runWithRequestContext(env, ctx, () => withDb(env, async () => handler.fetch!(request, env, ctx)));
  },
};
