# Real-time on Cloudflare (Stage C)

Replaces Redis and Socket.IO for the real-time paths. The Express server
(`apps/server/src/socket/index.ts` and `apps/server/src/redis/*`) is unchanged and
remains the reference. Behavior, event names, payloads, ack shapes and error
strings were copied from it.

## Architecture

```
browser (socket.io-client, transports: ["websocket"])
   │  wss://<worker>/socket.io/?EIO=4&transport=websocket
   ▼
Worker ──► Conn  (one Durable Object per WebSocket; speaks the Socket.IO protocol)
              │ auth: consume ticket ► TicketStore ► check account ► register ► UserHub
              │ events: chat:*, call:*  (ported handlers; database via Hyperdrive)
              ├────────────► Limiter   (rate limits: chat messages, typing, ticket route)
              └────────────► UserHub   (one per user: directory, connection cap, fan-out)
                                  └──► that user's Conn objects
REST (Worker) ► TicketStore.mint · UserHub.emit (emitToUser) · UserHub.disconnectAll (disconnectUser)
```

| Durable Object | Replaces | Notes |
|---|---|---|
| `Conn` | the Socket.IO server's per-socket handlers | WebSocket Hibernation API, so an idle connection costs nothing. |
| `UserHub` | the `user:<id>` room, the Redis connection-lease set, and the Redis adapter's fan-out | The connection cap is exact (register on connect, unregister on close), so no lease or heartbeat is needed. A vanished connection is pruned the next time the user hits the cap. |
| `TicketStore` | `redis/socketTickets.ts` | One-time by construction (read + delete inside `blockConcurrencyWhile`). 30 s expiry. 256 shards keyed by the first two hex digits of the ticket. |
| `Limiter` | `redis/rateLimit.ts` | Same atomic fixed window, one object per key. Fail-open on error, like `checkLimitFailOpen`. |

The `match:<id>` room needs no object of its own: a match's two participants come
from the database row, so a broadcast goes to each participant's `UserHub`, which
forwards to the sockets that joined that match.

## Socket events

All events are on the default namespace. Payloads and acks are identical to the
Express server.

| Event | Direction | Status |
|---|---|---|
| `chat:join` (ack `{ok, messages, otherUserId}`) | client → server | Migrated |
| `chat:history` (ack `{ok, messages}`) | client → server | Migrated |
| `chat:message` (ack `{ok, message}`) | client → server | Migrated, rate-limited 10 / 10 s |
| `chat:typing_start`, `chat:typing_stop` | client → server | Migrated, shared bucket 6 / 5 s |
| `chat:end` (ack `{ok}`) | client → server | Migrated |
| `call:offer`, `call:answer`, `call:ice-candidate`, `call:end` | client → server | Migrated; relay only, not rate-limited |
| `chat:message`, `chat:user_connected`, `chat:user_disconnected`, `chat:ended` | server → client | Migrated |
| `call:offer`, `call:answer`, `call:ice-candidate` (`{…, from}`), `call:ended`, `call:ready` | server → client | Migrated |
| `rate_limited` (`{event, retryAfterSeconds}`) | server → client | Migrated |
| `dm:message`, `notification:new` | server → client | **Transport migrated** (`emitToUser` reaches every live socket of the user). The routes that emit them are the social routes, which are not on the Worker yet (Stage E). |
| `matchmaking:started`, `:waiting`, `:match_found`, `:cancelled` | server → client | **Blocked** until matchmaking (Stage D): the same `emitToUser` path will carry them. |

Other behavior that was preserved: one-time ticket consumed before the eligibility
check, ineligible accounts (banned, suspended, deleted, unverified, under-age
confirmation) rejected, 3 concurrent connections per user, `chat:join` before
history/messages/typing/signaling, signaling re-checks that the match is active on
every event, and unknown events are ignored.

## Intentional differences from the Express server

1. **WebSocket transport only.** A Durable Object can hold a WebSocket but not an
   HTTP long-poll session. The browser must connect with
   `io(url, { transports: ["websocket"], auth })`. The web app currently uses the
   default (polling first), so that one option has to be added to the three socket
   clients and `MessagesProvider` when the frontend is switched over. Not done in
   this stage (the web app is untouched). Long-polling requests get a 400.
2. **Connection registration fails closed.** The Express server failed open if
   Redis could not count connections. Here the hub is also the delivery path to the
   socket, so a socket it does not know about would be deaf; it is refused instead.
3. **Events from one connection are handled one at a time, in order.** Needed
   because every handler does its own database check; without it ICE candidates
   were relayed shuffled (found by the burst test).
4. **No origin check on the WebSocket**, same as the Express server (the ticket is
   the gate).
5. **`disconnectUser` and `emitToUser` are fire-and-forget** through
   `ctx.waitUntil`, like the Express originals were synchronous no-await calls.
   Reconnecting is independently refused for banned/suspended accounts.

## Known costs and limits (not blockers)

- Each handled event opens a short-lived database client (the Worker rule: no
  shared client). Signaling does a database membership check per ICE candidate, as
  the Express server did, so a burst of candidates adds database round trips. Not
  measured against Neon/Hyperdrive; only against local Postgres.
- Cloudflare's Durable Object and WebSocket pricing and limits are unverified.
- A copy of the Socket.IO event schemas lives in `src/realtime/conn.ts`; the
  Express file cannot be imported (it pulls in `socket.io` and Redis). If the
  server's schemas change, change both.

## Not verified here

- Behavior on real Cloudflare (everything ran in local `wrangler dev`/workerd).
- Hibernation eviction under real idle time (local runs exercise the hibernation
  API, but not hours-long idle connections).
- Multi-user load.

## Test-only hook

`POST /__test__/emit` exists only in a build made with `EDGE_TEST_HOOKS=1`
(`scripts/build.mjs`); a test checks the normal build does not contain it. It lets
the tests trigger a server-initiated push without the social routes.
