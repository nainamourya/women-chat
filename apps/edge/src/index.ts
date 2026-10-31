import { httpServerHandler } from "cloudflare:node";
import { app } from "./app";
import { withDb, type DbEnv } from "./db";

// The Express app runs behind Workers' Node HTTP bridge. No signal handlers,
// no server lifecycle: the platform owns the process.
app.listen(8080);
const handler = httpServerHandler({ port: 8080 });

export default {
  // Every request gets its own database client, closed when the request ends
  // (including when a handler throws) — see db.ts.
  fetch(request: Request<unknown, IncomingRequestCfProperties>, env: DbEnv, ctx: ExecutionContext): Promise<Response> {
    return withDb(env, async () => handler.fetch!(request, env, ctx));
  },
};
