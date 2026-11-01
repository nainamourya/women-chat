# Staging rehearsal (Stage F)

Nothing in this stage was deployed. No Cloudflare login, no real resource, no
secret value was used or is written here. `wrangler.jsonc` has an `env.staging`
block (Worker `giigirl-edge-staging`, workers.dev only, no routes or custom
domain) whose Hyperdrive id and R2 bucket name are the **staging-only** resources
(`giigirl-private-staging`; the Hyperdrive id is an identifier, not a secret). A
`wrangler deploy --env staging --dry-run` builds it and lists the bindings
(5 Durable Objects, Hyperdrive, R2) without contacting Cloudflare.

Staging is isolated from production by construction: its own Worker name (Durable
Object storage is per Worker, so queues, tickets and limits start empty), its own
Hyperdrive config, its own bucket. **It must also use its own database** (a Neon
branch or a separate project), never the production connection string.

## Staging setup checklist (do these yourself; values never go in chat or git)

Placeholders: `<staging-worker-url>` = `https://giigirl-edge-staging.<your-subdomain>.workers.dev`,
`<staging-web-origin>` = the staging web app's exact origin (scheme + host, no path, no
trailing slash). Run every `wrangler` command from `apps/edge` **with `--env staging`**.
Without it a command targets the base config (the production-named Worker `giigirl-edge`),
so a secret or deploy would land on the wrong Worker. Stop and re-check if you forget it.

### A. Isolation rules (what keeps staging away from production)

| Resource | Staging must be | What guards it |
|---|---|---|
| Worker + Durable Objects | `giigirl-edge-staging`; Durable Object storage is per Worker, so queues, tickets, limits and socket state start empty | `env.staging.name`; `test/stagingConfig.test.ts` |
| Database | a **separate** Neon branch/project, never the production branch | **Your check** (nothing in the repo can see the real database): before creating Hyperdrive and before running migrations, compare the staging connection string's host and database name with production's and confirm they differ |
| Hyperdrive | its own config, pointing at the staging database | the staging Hyperdrive id in `env.staging` only (the base config keeps its own placeholder id, so a deploy without `--env staging` fails instead of reaching staging); `test/stagingConfig.test.ts` requires the two ids to differ |
| R2 | its own private bucket, no public access, no custom domain, no r2.dev URL | `giigirl-private-staging` in `env.staging` only; `test/stagingConfig.test.ts` requires the exact name and that it differs from the base config's |
| Secrets | new random values, never copied from production | `wrangler secret put ... --env staging` |
| Web | a Vercel **Preview** environment, variables scoped to Preview only | **Your check**: in Vercel, confirm no variable below is also ticked for Production |
| DNS / domains | none: workers.dev only, no routes, no custom domain on the Worker; none changed for the web app | `test/stagingConfig.test.ts` fails if the file gains a route, zone or account id |

Do not reuse these from production: `INTERNAL_API_SECRET`, `UPLOAD_TOKEN_SECRET`,
`AUTH_SECRET`, the database, the Hyperdrive config, the R2 bucket. Staging may reuse the
Metered TURN credentials (or use a separate Metered app).

### B. Cloudflare resources (dashboard or `wrangler`, your account)

- [ ] Workers **Paid** plan (Durable Objects with SQLite storage).
- [ ] Staging R2 bucket created (private). Put its name in `env.staging.r2_buckets[0].bucket_name`.
- [ ] Staging Neon database created and migrated (see D). Never run migrations or tests
      against production for this.
- [ ] Staging Hyperdrive config created against that database. Put its id in
      `env.staging.hyperdrive[0].id`. A Hyperdrive id is an identifier, not a secret, so the
      staging id may be committed, in `env.staging` only. Never commit the connection string,
      and never put a production id, bucket, route or secret in this file or in `env.staging`.
- [ ] Durable Object bindings (`CONN`, `USER_HUB`, `TICKETS`, `LIMITER`, `MATCHMAKER`) and
      migrations `v1`, `v2` are already in `env.staging` and applied by the first deploy.
      Nothing to create by hand. Do not rename or remove a migrated class later.

### C. Worker secrets and variables (`--env staging`)

Secrets, typed at the prompt (`npx wrangler secret put <NAME> --env staging`):
- [ ] `INTERNAL_API_SECRET`: new random value, 32+ characters
- [ ] `UPLOAD_TOKEN_SECRET`: a second, different random value, 32+ characters. The Worker
      refuses direct uploads (503) if it is missing, short, or equal to `INTERNAL_API_SECRET`.
- [ ] The Metered / TURN settings `apps/server/src/config/envSchema.ts` requires
      (`METERED_TURN_*` or `TURN_*`). The Worker ignores `DATABASE_URL`, `REDIS_URL` and `R2_*`.

Plain variables (`--var` or the dashboard, for the staging Worker only):
- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN=<staging-web-origin>`: **exact match**, comma-separated if more than one.
      No wildcard. It is used for the direct upload's CORS check, so a mismatch makes the
      browser's upload fail.
      Vercel gives every deployment its own URL, so use a **stable** Preview address: the
      branch alias for the migration branch, or a staging domain you own on the web side. A
      per-deployment URL would break CORS on every deploy.

### D. Staging database

- [ ] From your machine, with `DATABASE_URL` set to the **staging** connection string in
      that shell only (never in a committed file): `npm run db:migrate -w apps/server`.
      Re-check the host differs from production first.
- [ ] Create a staging admin account and a test member if you want to review uploads.

### E. Vercel Preview environment variables (Preview only)

- [ ] `SERVER_URL=<staging-worker-url>`: also the address the **browser** is sent to for
      video upload, so it must be the Worker's public URL.
- [ ] `NEXT_PUBLIC_SOCKET_URL=<staging-worker-url>`: inlined at build time, so redeploy the
      preview after changing it. The sockets connect with `transports: ["websocket"]`.
- [ ] `INTERNAL_API_SECRET`: the same value as the staging Worker's.
- [ ] `UPLOAD_TOKEN_SECRET`: the same value as the staging Worker's (not equal to
      `INTERNAL_API_SECRET`).
- [ ] `AUTH_SECRET` (new), `AUTH_URL=<staging-web-origin>`.
- [ ] `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: only if testing Google sign-in; add
      `<staging-web-origin>` to that OAuth client's redirect URIs (or use a separate client).
- [ ] Optional `NEXT_PUBLIC_ICE_TRANSPORT_POLICY`.
- [ ] Nothing here is ticked for Production. `VERCEL=1` is set by Vercel itself (the
      authorization address limit depends on it).

### F. Deploy (only with your explicit go-ahead and your own credentials)

- [ ] `npx wrangler deploy --env staging --dry-run` passes (it did locally in this stage).
- [ ] `npx wrangler deploy --env staging`. Confirm the output names `giigirl-edge-staging`
      on workers.dev and nothing else.
- [ ] Deploy the web Preview with the variables above.

### G. Health and readiness checks

- [ ] `GET <staging-worker-url>/api/health` returns 200 `{status:"ok"}`.
- [ ] `GET <staging-worker-url>/api/health/ready` returns 200 with `postgres: ok` and
      `realtime: ok`. A 503 names the failing dependency (database/Hyperdrive or Durable
      Objects). It does **not** check R2: that is covered by the upload smoke test below.
- [ ] Any non-health request without `x-internal-api-secret` returns 401. A 503 on every
      request means the Worker's configuration is invalid (fail closed): re-check section C.

### H. Smoke tests (staging only, with test accounts)

Verification upload:
- [ ] Sign in on the preview, open the eligibility page, tick the notice, choose a short MP4
      under 25 MB, and above 4.5 MB if you can (that is the point of the direct upload).
- [ ] In the browser's network tab: `POST /api/verification/video/authorize` returns 200 on
      the web origin; the video `PUT` goes to `<staging-worker-url>/api/verification/video-upload`
      (not to Vercel), preflight `OPTIONS` returns 204, and the final response is 201.
- [ ] The page shows "pending". Status read through the app is `pending_review`.
- [ ] As the staging admin, review the submission and approve or reject. The video plays
      through the admin route, and after the decision the object is gone from the **staging**
      bucket (R2 dashboard: check the staging bucket only).
- [ ] Failure cases: a second upload while pending is refused (409); an upload from a page
      on a different origin is blocked by CORS; the 11th authorization within an hour
      returns 429 with a message.

WebSocket:
- [ ] Two test accounts (verified) in two browsers: the socket connects (`wss://` to the
      Worker, status 101, no `transport=polling` requests), both join matchmaking and match.
- [ ] Chat messages and typing arrive both ways; a DM sent while the recipient is online
      appears live (`dm:message`); a follow produces `notification:new`.
- [ ] A video call connects between the two browsers, with TURN credentials from
      `/api/ice-servers`. Hanging up and leaving the page ends the match for both.
- [ ] Banning the test user from the admin page disconnects their live socket.

### I. Teardown / rollback of staging

- [ ] `npx wrangler delete --env staging` removes the staging Worker and its Durable Object
      state; delete the staging bucket, Hyperdrive config and database branch separately.
      None of this touches production.

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
