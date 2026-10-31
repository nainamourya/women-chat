# Edge Worker route coverage (Stage B)

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
| GET | /api/interests | |
| GET | /api/profile/:userId | |
| PUT | /api/profile/:userId | Uses a database transaction. |
| PUT | /api/profile/:userId/interests | Uses a database transaction. |
| POST | /api/ice-servers | Metered TURN logic is unchanged. |
| GET | /api/admin/stats/overview | |
| GET | /api/admin/users | List and search only. |

## Partial

| Method | Path | What is missing | Unblocked by |
|---|---|---|---|
| GET | /api/health/ready | Reports Postgres only. Express also pings Redis, which does not exist in the Worker yet. | Stage C |

## Blocked (answer 501)

| Method | Path | Exact blocker | Unblocked by |
|---|---|---|---|
| PATCH | /api/admin/users/:id | Suspend and ban must disconnect the user's live sockets (`disconnectUser`, Socket.IO). | Stage C |
| DELETE | /api/admin/users/:id | Deleting a user must disconnect their live sockets. | Stage C |
| * | /api/auth/* | Login and registration rate limits use Redis (`checkLimitFailOpen`) and the client IP. bcrypt CPU cost on Workers is unmeasured. | Stage C |
| * | /api/verification/* | Redis rate limits, plus verification video upload (R2, music-metadata, large bodies). | Stages C and E |
| * | /api/admin/verification/* | Reads and deletes verification videos through the R2 S3 client and music-metadata. | Stage E |
| * | /api/social/* | Redis rate limits, R2 media storage, image sanitising CPU, Socket.IO pushes. | Stages C and E |
| * | /api/account/* | Redis rate limit, matchmaking-queue removal, socket disconnect, R2 media deletion. | Stages C, D and E |
| * | /api/matchmaking/* | Redis matchmaking queue, one-time socket tickets, rate limits. | Stages C and D |
| * | /api/reports/* | Redis rate limits and evidence image storage. | Stages C and E |
| * | /api/blocks/* | Redis rate limits (`checkLimitFailOpen`). | Stage C |

## Not part of Stage B

Socket.IO (chat, notifications, WebRTC signaling), matchmaking, Redis-backed
behavior, video uploads and social features are untouched, as scoped.
