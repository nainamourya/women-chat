# Matchmaking on Cloudflare (Stage D)

The Express server's matchmaking router and service
(`apps/server/src/routes/matchmaking.ts`, `services/matchmaking.service.ts`) run
unchanged inside the Worker. Only the three Redis modules underneath were swapped
at build time (`scripts/build.mjs`), so every rule below is the server's own code,
not a re-implementation:

| Express module | Worker replacement | Backed by |
|---|---|---|
| `redis/matchmakingQueue.ts` (Lua join script, waiting markers) | `src/shims/redisMatchmakingQueue.ts` | `Matchmaker` Durable Object |
| `redis/rateLimit.ts` | `src/shims/redisRateLimit.ts` | `Limiter` Durable Object |
| `redis/socketTickets.ts` | `src/shims/redisSocketTickets.ts` | `TicketStore` Durable Object |
| `socket/index.ts` (`emitToUser`) | `src/shims/socket.ts` (Stage C) | `UserHub` Durable Object |

## Rules, and where each one lives

| Rule | Where it is enforced |
|---|---|
| Women-only / eligibility: verified, 18+ confirmed, not banned, suspended or deleted | `joinMatchmaking` → `assertEligible` (server code, reused). Also checked on the socket handshake and the ticket route. |
| Already in an active match: return that match, never a second one | `joinMatchmaking` → `findActiveMatch` (Postgres is the source of truth). |
| Blocked pairs never match, in either direction; the skipped user is not lost | `getBlockedCounterpartIds` (server code) passes the block list to the queue; `Matchmaker.join` skips and re-queues them. |
| FIFO: the oldest eligible waiting user is matched first | `Matchmaker.join` (new users to the head, oldest taken from the tail). |
| Never matched with yourself | `Matchmaker.join` discards a candidate equal to the caller; a waiting user gets `already_waiting`. |
| No duplicate queue entry, no double match | `Matchmaker.join` is one synchronous transaction inside a Durable Object, which runs one call at a time. |
| Waiting expires after 20 s unless the client keeps polling status | Waiting marker + `refreshWaiting` on every status poll. A closed tab falls off; stale entries are discarded when reached, and swept out by an alarm. |
| Leave while waiting cancels; leave while matched is refused (409) | `leaveMatchmaking` (server code) + `Matchmaker.leave`. |
| Rate limits: join 5 / 10 s, leave 5 / 10 s, status 30 / 30 s, ticket 10 / 60 s, per user, fail-open | Router (server code) + `Limiter`. |
| Events: `matchmaking:started`, `:waiting`, `:match_found` (to both), `:cancelled` | `emitToUser` → `UserHub` → the user's live sockets (Stage C path). Best-effort, as on Express; the match is saved first and `status` recovers a missed push. |
| Socket disconnect does **not** leave the queue | Same as Express: liveness is the status poll, not the socket. |

## Design notes

- **One queue object for everyone.** The match decision must see every waiting
  user, and a Durable Object serializes calls. Each call is a few indexed SQLite
  statements. If the queue ever outgrows one object it must be sharded (by region
  or interest), which changes who can match whom, so it is a product decision and
  was not made here.
- **SQLite storage, not one big value.** The queue and the waiting markers are two
  tables, so the size is bounded by users, not by a single stored value.
- **`socket-ticket` is now served by the server's router too.** Stage C's
  hand-written copy of that route was removed; the real one is used.

## Behavior inherited from the Express server (found while porting, not changed)

These are properties of the existing server code, reproduced faithfully. They are
worth a product decision, but changing them would change behavior this stage was
asked to preserve:

1. **Eligibility is checked when a user joins, not when they are picked from the
   queue.** If a waiting user is banned or suspended, someone who joins within the
   next 20 s can still be matched with them. (Banning drops their sockets and
   blocks them rejoining; it does not remove them from the queue.)
2. **A failed match write loses the claimed user.** `joinMatchmaking` claims the
   waiting user in the queue first and saves the match afterward. If that insert
   fails, the claimed user is no longer queued and the joiner gets a 500; they
   would see "idle" on their next status poll and have to join again.
3. **The queue is not sharded** (see above).

## Verification

`test/matchmaking.test.ts` (28 tests) covers authentication, validation,
eligibility, matching rules, FIFO, blocks in both directions, duplicate and
simultaneous joins, 21 users joining at once, cancellation, rate limits, stale
entries (20 s expiry and polling refresh), event delivery over real sockets, and
database failure. `test/differential.test.ts` also runs the real Express router
(with real Redis) beside the Worker and requires identical status codes and bodies
for error cases and for a full join / duplicate / leave / match / rejoin / 409
sequence.

Not verified: behavior on real Cloudflare, load beyond a few dozen users, and
Durable Object pricing and limits.
