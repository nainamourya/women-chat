# Object storage on Cloudflare R2 (Stage E)

The Express server's storage modules are replaced at build time (`scripts/build.mjs`)
by versions that use the Worker's R2 **binding** instead of the S3 SDK. Services and
routes (`videoVerification.service`, `posts.service`, `accountDeletion.service`,
`reports.service`, the social, reports, account and admin-verification routers) are
the server's own code, unchanged. `apps/server` is untouched.

One private bucket, one binding (`PRIVATE_BUCKET`, a **placeholder** bucket name in
`wrangler.jsonc`; nothing in this repo creates, configures or reads a real bucket).
Local runs use wrangler's simulated bucket.

| Data | Key | Replaces | Read by |
|---|---|---|---|
| Verification videos | `<uuid>.<mp4\|webm\|mov>` at the root (unchanged, so existing videos stay readable) | `services/videoStorage.ts` | admin review route only |
| Profile photos, post images | `social/avatars/<uuid>.<ext>`, `social/posts/<uuid>.<ext>` (unchanged) | `services/social/mediaStorage.ts` | authenticated media routes, after the visibility/block check |
| Report evidence | `reports/evidence/<uuid>.<jpg\|png\|webp>` | `services/evidenceStorage.ts` (was **local disk** on Express) | admin evidence route only |

## Privacy and deletion rules that are preserved

- **Never public, never presigned.** Bytes leave only through the module's read
  function, called by an authenticated route that has already checked the viewer's
  right (member visibility and blocks for social media; `assertAdmin` for videos and
  evidence). There is no signed-URL code path.
- **Keys are server-generated** UUIDs; a pattern check runs before any key reaches
  the bucket.
- **Social images have their metadata stripped**: the server's sanitizer strips
  EXIF/XMP and PNG/WebP metadata chunks before storage (tested: a GPS marker in the
  upload is absent from the stored bytes). Private cache headers, `nosniff` and the
  sandbox CSP are the server's, unchanged.
- **Deletion semantics.** Verification-video deletion is idempotent and confirmed:
  delete, then `head`; any storage failure on either step is a failure, never a
  success, so an approval is not finalized unless the video is really gone. Social
  media deletion is best-effort and logged (an unreferenced object is unreachable),
  after the database commit, as before. Account deletion removes the member's
  images and drops their live sockets.
- **Orphans.** If a submission fails after the video reached R2 (bad type, bad
  duration, duplicate submission), the object is deleted.

## Video upload: the one contract change

The Express route took the whole video as base64 inside a JSON body. A Worker has
128 MB; that path holds the body, the string, the parsed copy and the decoded bytes
together, so it is not safe, and `POST /api/verification/video` answers 501.

Replacement: `PUT /api/verification/video/:userId` (`src/verificationUpload.ts`)

```
headers: x-internal-api-secret, Content-Type: video/mp4 | video/webm | video/quicktime,
         Content-Length: <bytes>, x-acknowledged-notice: true
body:    the raw video
201 { submission }   — same errors, statuses and messages as the Express route
```

- Checks run in the Express order: secret, user id, per-user limit (5 per hour),
  notice acknowledged, user exists, no pending submission (409), declared type,
  declared size (`VERIFICATION_VIDEO_MAX_BYTES`, refused from the header before a
  byte is read; a missing Content-Length is a 411).
- The body is **streamed into R2**; the Worker never holds the upload.
- The stored object is then validated: size, magic bytes against the declared type,
  and a duration read from the container's own metadata (`music-metadata`, as on
  Express), rounded before comparing with the limit, failing closed if it cannot be
  read. The only copy in memory is the stored object, at most 25 MB, with no base64.
- On any failure the object is deleted; the partial unique index still guards a race
  between two simultaneous submissions (tested: exactly one wins, no orphan).

**Browsers do not use that endpoint.** Vercel rejects request bodies over 4.5 MB, so
the browser uploads directly with `PUT /api/verification/video-upload`
(`src/directUpload.ts`), authorized by a signed one-time token from the web app
instead of `x-internal-api-secret`. After the token is verified and spent, it runs
the same `processUpload` code as the internal route, as the token's user. See
`STAGING.md` for the token's properties and CORS.

## Other differences from Express

- Report evidence moved from local disk to R2 (a Worker has no disk). Evidence
  files that exist only on the old server's disk are not migrated. There is still
  no retention job, as before.
- The local-disk development mode of the social media module (`MEDIA_LOCAL_DIR`) has
  no equivalent; local runs use the simulated bucket.
- Admin video playback and image reads buffer the object (at most 25 MB) before
  sending, as the Express routes did, rather than streaming it.

## Not verified here

- Behavior against a real R2 bucket (everything ran on wrangler's local simulation),
  including R2 request limits and `head` consistency right after `delete`.
- A real 25 MB upload end to end and memory use on Cloudflare (the tests use a
  5,000-byte limit to make oversized uploads cheap, and small fixtures).
- bcrypt CPU cost on Cloudflare (the auth routes are ported; local wall time is
  printed by the auth test but is not Cloudflare CPU time).
