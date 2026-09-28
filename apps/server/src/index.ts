import express from "express";
import cors from "cors";
import { createServer } from "node:http";
import { Server as SocketIOServer } from "socket.io";
import { env } from "./config/env.js";
import { authRouter } from "./routes/auth.js";
import { verificationRouter } from "./routes/verification.js";
import { profileRouter } from "./routes/profile.js";
import { interestsRouter } from "./routes/interests.js";
import "./redis/client.js";

const app = express();

app.use(
  cors({
    origin: env.CORS_ORIGIN,
    credentials: true,
  }),
);
app.use(express.json());

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.use("/api/auth", authRouter);
app.use("/api/verification", verificationRouter);
app.use("/api/profile", profileRouter);
app.use("/api/interests", interestsRouter);

const httpServer = createServer(app);

// Socket.IO is initialized here so the transport exists from Phase 1, but no
// matchmaking/chat/signaling handlers are wired up until later phases.
const io = new SocketIOServer(httpServer, {
  cors: {
    origin: env.CORS_ORIGIN,
    credentials: true,
  },
});

io.on("connection", (socket) => {
  console.log(`socket connected: ${socket.id}`);
  socket.on("disconnect", () => {
    console.log(`socket disconnected: ${socket.id}`);
  });
});

httpServer.listen(env.PORT, () => {
  console.log(`women-chat server listening on port ${env.PORT}`);
});
