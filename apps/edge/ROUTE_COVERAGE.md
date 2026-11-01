# Edge Worker route coverage (through Stage E)

The Express server in `apps/server` is the reference implementation and is
unchanged. The Worker reuses its routers and services directly; only the
database client, environment, socket, Redis and storage modules are swapped at
build time (`scripts/build.mjs`). The table below mirrors `src/routeCoverage.ts`,
and `test/routeCoverage.test.ts` fails if a server route is missing from it or
this file drifts from it.

A blocked route answers **501** after the internal-secret check (so an
unauthenticated caller still gets 401). Nothing is stubbed to succeed.

## Ported (served by the Worker)

| Method | Path | Notes |
|---|---|---|
| GET | /api/health | Same response as Express. |
| GET | /api/health/ready | Postgres and the real-time Durable Objects. No `redis` entry: Redis was replaced, not reproduced. |
| GET | /api/interests | |
| GET | /api/profile/:userId | |
| PUT | /api/profile/:userId | Uses a database transaction. |
| PUT | /api/profile/:userId/interests | Uses a database transaction. |
| POST | /api/ice-servers | Metered TURN logic unchanged. |
| GET | /api/admin/stats/overview | |
| GET | /api/admin/users | List and search. |
| PATCH | /api/admin/users/:id | Ban/suspend drops the user's live sockets (Stage C). |
| DELETE | /api/admin/users/:id | Deletion drops the user's live sockets (Stage C). |
| POST | /api/matchmaking/socket-ticket | Served by the server's own matchmaking router. |
| POST | /api/matchmaking/join | `Matchmaker` Durable Object replaces the Redis queue (Stage D). See `MATCHMAKING.md`. |
| POST | /api/matchmaking/leave | |
| GET | /api/matchmaking/status/:userId | Refreshes the 20 s waiting marker, as on Express. |
| * | /api/auth/* | Register, login, Google, account-status, confirm-age. Rate limits on the Durable Object limiter; the client address is `CF-Connecting-IP`. |
| * | /api/blocks/* | |
| * | /api/reports/* | Report evidence images are stored in R2 (they were local disk on Express). |
| * | /api/social/* | All 35 handlers: profiles, avatars, posts, feed, likes, comments, follows, DMs, notifications, block, report, media. Images in R2; `dm:message` and `notification:new` pushed through the real-time path. |
| * | /api/account/* | Account deletion, including R2 media deletion and dropping live sockets. |
| * | /api/admin/verification/* | Review, decide, retry deletion, stream the video. Videos are read from and deleted in R2. |
| * | /api/verification/* | Everything except the base64 video upload: `GET /video/status/:userId`, `POST /simulate` (404 outside development, as on Express). |
| PUT | /api/verification/video/:userId | **Worker-only replacement** for the base64 upload: the raw video is streamed into R2. See `STORAGE.md`. |
| POST | /api/verification/video-authorization/check | **Worker-only**, internal secret. The rate limit (per user and, when supplied, per IP) for minting upload authorizations; see `STAGING.md`. |
| PUT | /api/verification/video-upload | **Worker-only** direct browser upload, authorized by a short-lived signed one-time token (not the internal secret), CORS for the configured web origin only. See `STORAGE.md`. |

## Blocked (answer 501)

| Method | Path | Exact blocker | Unblocked by |
|---|---|---|---|
| POST | /api/verification/video | The video arrives as a base64 string inside a JSON body (~33 MB for 25 MB of video). A Worker has 128 MB of memory and that path holds the raw body, the string, the parsed copy and the decoded bytes at once, so it is not safe. Replaced by `PUT /api/verification/video/:userId`. | Replaced: browsers upload directly with PUT /api/verification/video-upload (signed one-time authorization); see STORAGE.md |

## Frontend and staging

Stage F updated the web app: the verification video goes directly from the browser
to the Worker with a signed one-time authorization (`/api/verification/video/authorize`
on Next.js, `PUT /api/verification/video-upload` on the Worker), and the socket
clients are WebSocket-only; see `STAGING.md`.
Real-time is described in `REALTIME.md`, matchmaking in
`MATCHMAKING.md`, storage in `STORAGE.md`.
