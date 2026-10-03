"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { ChatClient } from "./ChatClient";
import { CallClient } from "./CallClient";

type MatchState = "idle" | "waiting" | "matched";

type StatusResponse = {
  state: MatchState;
  matchId?: string;
  otherUserId?: string;
};

const POLL_INTERVAL_MS = 4000;

export function MatchClient() {
  const [state, setState] = useState<MatchState>("idle");
  const [matchId, setMatchId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  function applyStatus(data: StatusResponse) {
    setState(data.state);
    setMatchId(data.matchId ?? null);
    if (data.state === "matched") {
      stopPolling();
    }
  }

  function handleChatEnded() {
    setMatchId(null);
    setState("idle");
  }

  async function fetchStatus() {
    const res = await fetch("/api/matchmaking/status");
    const data = await res.json();
    if (res.ok) applyStatus(data);
  }

  function startPolling() {
    if (pollRef.current) return;
    pollRef.current = setInterval(async () => {
      const res = await fetch("/api/matchmaking/status");
      const data = await res.json();
      if (res.ok) applyStatus(data);
    }, POLL_INTERVAL_MS);
  }

  // Socket connection is a fast-path notification; polling /status is the
  // fallback if a socket event is missed (e.g. brief disconnect).
  async function connectSocket() {
    if (socketRef.current) return;

    const ticketRes = await fetch("/api/matchmaking/socket-ticket", { method: "POST" });
    if (!ticketRes.ok) return;
    const { ticket } = await ticketRes.json();

    const socket = io(process.env.NEXT_PUBLIC_SOCKET_URL!, { auth: { ticket } });
    socket.on("matchmaking:match_found", (payload: { matchId: string; otherUserId: string }) => {
      setState("matched");
      setMatchId(payload.matchId);
      stopPolling();
    });
    socketRef.current = socket;
    setSocket(socket);
  }

  useEffect(() => {
    // Always connect (not just when actively searching) so that a page
    // refresh while already matched can immediately rejoin the chat room.
    // Wrapped in an async IIFE so any resulting state updates happen after
    // the effect body has already returned, not synchronously within it.
    (async () => {
      await connectSocket();
      await fetchStatus();
    })();
    return () => {
      stopPolling();
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleFindSomeone() {
    setLoading(true);
    setError(null);
    try {
      await connectSocket();
      const res = await fetch("/api/matchmaking/join", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      applyStatus(data);
      if (data.state === "waiting") {
        startPolling();
      }
    } finally {
      setLoading(false);
    }
  }

  async function handleCancel() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/matchmaking/leave", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      stopPolling();
      applyStatus(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {state === "idle" && (
        <button
          type="button"
          onClick={handleFindSomeone}
          disabled={loading}
          className="self-start rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
        >
          {loading ? "Starting…" : "Find Someone"}
        </button>
      )}

      {state === "waiting" && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Finding someone…</p>
          <button
            type="button"
            onClick={handleCancel}
            disabled={loading}
            className="self-start rounded-md border border-zinc-300 px-4 py-2.5 text-sm font-medium text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:text-white"
          >
            Cancel
          </button>
        </div>
      )}

      {state === "matched" && matchId && socket && (
        <div className="flex flex-col gap-4">
          <CallClient key={`call-${matchId}`} socket={socket} matchId={matchId} />
          <ChatClient key={`chat-${matchId}`} socket={socket} matchId={matchId} onEnded={handleChatEnded} />
        </div>
      )}

      {state === "matched" && (!matchId || !socket) && (
        <p className="text-sm text-zinc-500">Connecting…</p>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
