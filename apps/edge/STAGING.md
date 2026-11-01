# Staging rehearsal (Stage F)

Nothing in this stage was deployed. No Cloudflare login, no real resource, no
secret value was used or is written here. `wrangler.jsonc` has an `env.staging`
block (Worker `giigirl-edge-staging`, workers.dev only, no routes or custom
domain) whose Hyperdrive id and R2 bucket name are **placeholders**. A
`wrangler deploy --env staging --dry-run` builds it and lists the bindings
(5 Durable Objects, Hyperdrive, R2) without contacting Cloudflare.

Staging is isolated from production by construction: its own Worker name (Durable
Object storage is per Worker, so queues, tickets and limits start empty), its own
Hyperdrive config, its own bucket. **It must also use its own database** (a Neon
branch or a separate project), never the production connection string.

## Setup checklist (do these yourself; values never go in chat or in git)

Resources (Cloudflare dashboard or `wrangler`, on the account you choose):
- [ ] Create a **staging** R2 bucket; put its name in `env.staging.r2_buckets`
      (keep it private: no public access, no custom domain, no r2.dev URL).
- [ ] Create a **staging Neon database** (a branch of production's project is
      fine; never the production branch). Apply the migrations to it.
- [ ] Create a **staging Hyperdrive** config pointing at that database; put its id
      in `env.staging.hyperdrive`.
- [ ] Review the Workers plan: Durable Objects with SQLite need the Workers Paid
      plan for production-like use.

Secrets (`wrangler secret put <NAME> --env staging`, typed at the prompt):
- [ ] `INTERNAL_API_SECRET` (a new random value; the same value goes in the
      Vercel preview env below)
- [ ] `UPLOAD_TOKEN_SECRET` (a second, different random value, 32+ characters; also
      goes in the Vercel preview env)
- [ ] `METERED_TURN_*` / `TURN_*` settings the server's config schema requires
      (staging may reuse the Metered credentials or use a separate app)
- [ ] anything else `apps/server/src/config/envSchema.ts` marks required, minus
      `DATABASE_URL`, `REDIS_URL` and `R2_*` (the Worker does not read them)

Plain variables for staging (`--var` or the dashboard): `NODE_ENV=production`,
`CORS_ORIGIN=<staging web origin>`.

Web (a **Vercel Preview** environment, never Production):
- [ ] `UPLOAD_TOKEN_SECRET=` the same value as the Worker's secret (a new random value,
      at least 32 characters, different from `INTERNAL_API_SECRET`)
- [ ] `SERVER_URL=https://giigirl-edge-staging.<subdomain>.workers.dev`
- [ ] `NEXT_PUBLIC_SOCKET_URL=` the same URL (the browser connects with
      `transports: ["websocket"]`)
- [ ] `INTERNAL_API_SECRET=` the staging value from above
- [ ] a preview database/auth config that points at the **staging** database

Deploy (needs your explicit go-ahead and your own credentials):
`npx wrangler deploy --env staging` from `apps/edge`.

## What was rehearsed, and where

| Check | Where | Result |
|---|---|---|
| Staging config builds, bindings resolve | `wrangler deploy --env staging --dry-run` (local build only) | passes |
| Direct upload: the web app's real authorize route mints a token, the browser-shaped request goes straight to the Worker (single use, replay, cross-user, expiry, forged and mis-bound tokens, CORS, fail-closed config) | local Worker on wrangler's simulation + local Docker Postgres (`test/directUpload.test.ts`, 26 tests) | passes |
| Authorize route unit tests (session, validation, claims, secret rules) | `apps/web` vitest | passes |
| WebSocket-only socket against the Worker | already exercised by the Stage C-E tests (`transports: ["websocket"]`), not repeated | - |
| Auth, social, private media, review/deletion, matchmaking, chat, DM, signaling | Stage C-E suites, not repeated | - |

**Not rehearsed** (needs your resources/approval or a browser session against
staging): any real Cloudflare behavior (R2, Hyperdrive, Durable Objects, bcrypt CPU
time, WebSocket limits); a browser end-to-end run (login, upload, two-browser call)
against a deployed staging pair; the real Vercel request path. The Next.js app was
not run locally because its local environment file may point at real services.

## Large video upload: direct to the Worker (Vercel's 4.5 MB limit)

Vercel Functions reject request bodies over **4.5 MB** (413
`FUNCTION_PAYLOAD_TOO_LARGE`, per Vercel's Functions limits page), so a video of up
to 25 MB cannot pass through a Next.js route. The bytes now go straight from the
browser to the Worker:

1. The page calls `POST /api/verification/video/authorize` (Next.js, session
   required) with the file's type and size. It returns only `{ uploadUrl, token,
   expiresAt }`.
2. The page `PUT`s the raw file to `uploadUrl` (`/api/verification/video-upload` on
   the Worker) with `Authorization: Bearer <token>`. The Worker's side is described in
   `STORAGE.md`.

Security properties (all tested in `test/directUpload.test.ts`):
- The token is HMAC-SHA256 signed with `UPLOAD_TOKEN_SECRET`, a **separate** secret
  shared only by the Next.js server and the Worker. Both sides refuse to run if it is
  missing, under 32 characters, or equal to `INTERNAL_API_SECRET`. The internal secret
  never reaches a browser.
- Bound to the session user (`sub`), one content type and one exact byte length;
  lifetime 120 s (the Worker rejects anything over 300 s); one-time `jti`, spent
  atomically in a Durable Object before any byte is read.
- The Worker still runs every existing check after the token: 5 uploads/hour per
  user, acknowledgement header, user exists, no pending submission, declared type and
  the 25 MB limit (its own setting, not the token's), magic bytes, duration, and
  deletion of the object on any failure. The R2 object stays private; nothing returns
  a storage key or URL.
- CORS on that route only: the exact origin(s) in `CORS_ORIGIN`, no wildcard, no
  credentials (the token is a bearer header, no cookies are involved). A request or
  preflight from any other origin gets 403.

Things to know:
- The acknowledgement is still the client's `x-acknowledged-notice` header, as it
  was in the old JSON body; there is no server-side way to witness a checkbox.
- Minting is rate limited, see "Limit on minting authorizations" below.
- A token spent by a failed upload (for example a 409) is gone; the page asks for a
  new one on retry. A request whose type/length does not match the token does not
  spend it.
- Real Cloudflare behavior (a 25 MB upload, CORS through Cloudflare, memory) and a
  real browser were not tested; see "Not rehearsed" above.

## Limit on minting authorizations

Design: the Next.js authorize route calls the Worker's internal
`POST /api/verification/video-authorization/check` (internal secret) before it
signs anything, and the count lives in the Worker's existing `Limiter` Durable
Object, the same one behind every other limit. No new service. A limiter inside the
Next.js app was rejected: it runs as serverless instances with no shared store, so
a per-instance counter would not hold (and the web app has no Redis).

| Key | Limit | Why |
|---|---|---|
| session user id | 10 per hour | A real upload needs one token and uploads are already capped at 5 per hour; the rest is room for tokens that expire or are refused. Applies to every request (the route requires a session). |
| client address | 30 per hour | Stops one source cycling through many accounts; loose enough for a shared network. Only used when the address is trustworthy. |

- Over the limit: **429** `{ error }` with `Retry-After` (seconds, from the
  limiter's own window); no token is minted. The page shows the message.
- Identity is never taken from the client: the user id is the session's, and a
  session whose id is not a well-formed lowercase UUID gets 401 before anything is
  signed or counted.
- Address: used only when `VERCEL=1` and then only `x-vercel-forwarded-for` (first
  entry, validated as an IP). Vercel overwrites `x-forwarded-for` and does not
  forward external values (its request-headers docs), so on Vercel it is the real
  client. Elsewhere the headers are client-controlled and are ignored (user limit
  only). Behind a proxy placed in front of Vercel the address would be the proxy's,
  which makes the IP limit coarse, never weaker for the user limit.
- If the limiter cannot be reached the route answers **503** and mints nothing (an
  upload cannot succeed without the backend anyway). If the limiter's own Durable
  Object errors, the Worker fails open as every other limit does (logged by
  category only); the per-user upload limit (5 per hour) still bounds uploads.
- Window expiry and reset are the existing `Limiter` Durable Object's alarm logic
  (tested in the earlier real-time stages); a one-hour window cannot be waited out
  in a test, so the new tests cover the 429/Retry-After values and (in the web
  tests) recovery once the backend allows again.

Limitations: the limit is per fixed window, so a burst at a window boundary can
reach up to twice the limit across two windows; the IP limit is per address, so
IPv6 clients can rotate within a /64 (no prefix grouping was added); and none of it
was exercised on real Cloudflare or Vercel.

## Security review of the direct upload (what was checked)

Checked against the code and (where marked) tests:
- **Signature**: HMAC-SHA256 verified with `crypto.subtle.verify` (constant time);
  the signed text is domain-separated (`giigirl-verification-upload.v1.`); a token
  signed with another secret or the internal secret is refused. Tested.
- **Claims**: expiry, maximum lifetime (300 s), future-dated, and **expiry before
  issue** (found and fixed: it was accepted for up to 30 s of clock skew), user
  binding, exact content type and exact length, lowercase-UUID `sub`/`jti` (so a
  case variant cannot dodge the one-time claim). Tested.
- **One-time claim**: atomic in the Durable Object (3 concurrent uses: exactly one
  wins, tested). The claim is kept about twice the longest possible validity.
- **Type/length mismatch** and wrong origin do not spend the token; **every failure
  after the claim does**, including a database or limiter failure, so a retry always
  needs a fresh token (tested for validation failures).
- **Unexpected errors** after verification (for example the claim's Durable Object
  failing) used to escape as an uncaught exception without CORS headers; they now
  fail closed with a 503 and the CORS header, logging only the error class. Not
  exercised by a test (there is no safe way to make the Durable Object fail here).
- **Streaming**: the body goes straight to R2; a Content-Length is required, must
  equal the token's length and be within the server's limit before a byte is read.
  Afterwards only the stored object (at most 25 MB) is held, once.
- **Checks still enforced** after the token: rate limit, acknowledgement, user
  exists, no pending submission, type, size, magic bytes, duration. Tested.
- **Cleanup**: the object is deleted on every failure after it reaches R2. Found
  and fixed: if the submission row was inserted but the following user-status update
  failed, the object was deleted while the row still referenced it. The row now owns
  the object once inserted (regression test fails without the fix). A deletion that
  cannot be confirmed is now logged (without the key); before it was silent.
- **Logs and errors**: nothing logs a token, secret, key or URL; error responses are
  generic. A test captures the local Worker's output and checks it for every token
  (and its payload), both secrets and every stored key.

Not covered: a Worker crash or eviction between the R2 write and the database insert
leaves an object with no row (there is no sweeper job); real R2/Cloudflare behavior.

## Compatibility notes

- The web app now only works against the Worker for video upload: the Express
  server (reference) has neither the authorize flow's target nor the raw-byte PUT.
  `SERVER_URL` must be the Worker's public URL, because the browser is sent to it.
- Both socket clients (`MatchClient`, `MessagesProvider`) now use
  `transports: ["websocket"]`, which the Express server also accepts.
- No change to `apps/server`.
