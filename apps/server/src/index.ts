import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { verificationRouter } from "./routes/verification.js";
import { profileRouter } from "./routes/profile.js";
import { interestsRouter } from "./routes/interests.js";
import { matchmakingRouter } from "./routes/matchmaking.js";
import { reportsRouter } from "./routes/reports.js";
import { blocksRouter } from "./routes/blocks.js";
import { initSocketServer } from "./socket/index.js";
import "./redis/client.js";

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
// Default 100kb limit is too small for base64-encoded report evidence
// (images up to 5MB decoded, ~6.7MB as base64) — see evidenceStorage.ts.
app.use(express.json({ limit: "8mb" }));

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/verification", verificationRouter);
app.use("/api/profile", profileRouter);
app.use("/api/interests", interestsRouter);
app.use("/api/matchmaking", matchmakingRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/blocks", blocksRouter);

const httpServer = createServer(app);

// Matchmaking notifications only for now (started/waiting/match_found/
// cancelled) — no chat or WebRTC signaling events wired up yet.
initSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
  console.log(`women-chat server listening on port ${env.PORT}`);
});
