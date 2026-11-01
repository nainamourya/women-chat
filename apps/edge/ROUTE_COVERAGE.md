# Edge Worker route coverage (through Stage C)

The Express server in `apps/server` is the reference implementation and is
unchanged. The Worker reuses its routers and services directly; only the
database client, environment and socket modules are swapped at build time
(`scripts/build.mjs`). The table below mirrors `src/routeCoverage.ts`, and
`test/routeCoverage.test.ts` fails if a server route is missing from it or this
file drifts from it.

Blocked routes answer **501** `{"error":"Not available on the edge backend yet."}`
after the internal-secret check (so an unauthenticated caller still gets 401).
Nothing is stubbed to succeed.

## Ported (served by the Worker)

| Method | Path | Notes |
|---|---|---|
| GET | /api/health | Same response as Express. |
| GET | /api/health/ready | Reports Postgres and the real-time Durable Objects. No `redis` entry: Redis was replaced, not reproduced. |
| GET | /api/interests | |
| GET | /api/profile/:userId | |
| PUT | /api/profile/:userId | Uses a database transaction. |
| PUT | /api/profile/:userId/interests | Uses a database transaction. |
| POST | /api/ice-servers | Metered TURN logic is unchanged. |
| GET | /api/admin/stats/overview | |
| GET | /api/admin/users | List and search. |
| PATCH | /api/admin/users/:id | Ban/suspend now drops the user's live sockets (Stage C). |
| DELETE | /api/admin/users/:id | Deletion now drops the user's live sockets (Stage C). |
| POST | /api/matchmaking/socket-ticket | Only this route of the matchmaking router: it is real-time transport. |

## Blocked (answer 501)

| Method | Path | Exact blocker | Unblocked by |
|---|---|---|---|
| * | /api/auth/* | The routes import the Redis rate limiter (`checkLimitFailOpen`) and key on the client IP. The Durable Object limiter now exists but is not wired to HTTP routes yet. bcrypt CPU cost on Workers is unmeasured. | A later stage (limiter shim, `CF-Connecting-IP`) |
| * | /api/verification/* | Redis rate limiter import, plus verification video upload (R2, music-metadata, large bodies). | A later stage (limiter shim) and Stage E |
| * | /api/admin/verification/* | Reads and deletes verification videos through the R2 S3 client and music-metadata. | Stage E |
| * | /api/social/* | Redis rate limiter import, R2 media storage, image sanitising CPU. (The `dm:message` / `notification:new` push path now exists: `emitToUser` reaches the user's sockets.) | A later stage (limiter shim) and Stage E |
| * | /api/account/* | Redis rate limiter import, matchmaking-queue removal, R2 media deletion. (Socket disconnect now works.) | Stages D and E |
| * | /api/matchmaking/* (except socket-ticket) | Redis matchmaking queue and matchmaking rate limits (join, leave, status). | Stage D |
| * | /api/reports/* | Redis rate limiter import and evidence image storage. | A later stage (limiter shim) and Stage E |
| * | /api/blocks/* | Imports the Redis rate limiter (`checkLimitFailOpen`); nothing else blocks it. The Durable Object limiter exists but is not wired to HTTP routes yet. | A later stage (limiter shim) |

## Not part of Stages B and C

Matchmaking rules, video uploads and social features are untouched, as scoped.
Real-time (chat, notifications, WebRTC signaling) is described in `REALTIME.md`.
