import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { verificationRouter } from "./routes/verification.js";
import { profileRouter } from "./routes/profile.js";
import { interestsRouter } from "./routes/interests.js";
import { matchmakingRouter } from "./routes/matchmaking.js";
import { iceServersRouter } from "./routes/iceServers.js";
import { reportsRouter } from "./routes/reports.js";
import { blocksRouter } from "./routes/blocks.js";
import { adminUsersRouter } from "./routes/adminUsers.js";
import { adminStatsRouter } from "./routes/adminStats.js";
import { adminVerificationRouter } from "./routes/adminVerification.js";
import { healthRouter } from "./routes/health.js";
import { initSocketServer, closeSocketServer } from "./socket/index.js";
import { closeRedis } from "./redis/client.js";
import { closeDb } from "./db/client.js";
import { createGracefulShutdown } from "./lifecycle/gracefulShutdown.js";

const app = express();

// Required for req.ip (used by IP-based rate limiting, see routes/auth.ts)
// to reflect the real client address rather than the platform's own
// load balancer. "1" trusts exactly one proxy hop in front of this
// service — the correct, standard setting for a service deployed directly
// on Render with nothing else in front of it. Express validates this via
// the trusted-hop count (not by blindly trusting whatever X-Forwarded-For
// says) — but this assumption (exactly one hop) is specific to this
// deployment topology and has not been independently verified against the
// live Render service. If a CDN/WAF (e.g. Cloudflare) sits in front of
// Render for this app, this must be "2" instead, or IP-based limiting
// below will trust an attacker-supplied header one hop too far.
app.set("trust proxy", 1);

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
// Default 100kb limit is too small for base64-encoded report evidence
// (images up to 5MB decoded, ~6.7MB as base64) — see evidenceStorage.ts.
// The verification video upload needs a much larger limit still (a 25MB
// video is ~33MB base64-encoded) — rather than raising this default for
// every route, that one path is excluded here and given its own larger
// parser directly on the route (see routes/verification.ts), so the body
// is only parsed once, with the right limit, and every other endpoint
// keeps the smaller default.
const globalJsonParser = express.json({ limit: "8mb" });
app.use((req, res, next) => {
  if (req.path === "/api/verification/video") return next();
  return globalJsonParser(req, res, next);
});

app.use("/api/health", healthRouter);

app.use("/api/auth", authRouter);
app.use("/api/verification", verificationRouter);
app.use("/api/profile", profileRouter);
app.use("/api/interests", interestsRouter);
app.use("/api/matchmaking", matchmakingRouter);
app.use("/api/ice-servers", iceServersRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/blocks", blocksRouter);
app.use("/api/admin/users", adminUsersRouter);
app.use("/api/admin/stats", adminStatsRouter);
app.use("/api/admin/verification", adminVerificationRouter);

const httpServer = createServer(app);

try {
  // Awaited so the Redis adapter's pub/sub connections are confirmed ready
  // before this instance starts accepting any Socket.IO connection — see
  // initSocketServer's own comment for why that ordering matters.
  await initSocketServer(httpServer);
} catch (err) {
  console.error("Failed to initialize Socket.IO (Redis adapter unavailable):", err);
  process.exit(1);
}

httpServer.listen(env.PORT, () => {
  console.log(`women-chat server listening on port ${env.PORT}`);
});

const shutdown = createGracefulShutdown({
  closeSocketServer,
  closeRedis,
  closeDb,
  closeIdleConnections: () => httpServer.closeIdleConnections(),
  closeAllConnections: () => httpServer.closeAllConnections(),
});

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
