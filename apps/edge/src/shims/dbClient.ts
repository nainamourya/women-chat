// Build-time replacement for apps/server/src/db/client.ts (see
// scripts/build.mjs). The server's version creates one shared postgres.js
// client at import time, which does not survive across Worker requests. This
// resolves `db` to the current request's client instead (see ../db.ts).
export { db } from "../db";
