"use client";

import { useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";
import { ChatClient } from "./ChatClient";
import { CallClient } from "./CallClient";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";
import { Avatar } from "@/components/ui/Avatar";
import { Mascot } from "@/components/Mascot";

const MATCH_BANNER_MS = 4000;

type MatchState = "idle" | "waiting" | "matched";
type CallPhase = "idle" | "calling" | "ringing" | "active";

function ChatBubbleIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-5 w-5">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
      />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4">
      <path strokeLinecap="round" strokeLinejoin="round" d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

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
  const [showMatchBanner, setShowMatchBanner] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [callPhase, setCallPhase] = useState<CallPhase>("idle");
  const socketRef = useRef<Socket | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setChatOpen(false);
    setCallPhase("idle");
  }

  const prevStateRef = useRef<MatchState>("idle");

  useEffect(() => {
    if (state === "matched" && prevStateRef.current !== "matched") {
      setShowMatchBanner(true);
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
      bannerTimeoutRef.current = setTimeout(() => setShowMatchBanner(false), MATCH_BANNER_MS);
    }
    prevStateRef.current = state;
  }, [state]);

  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    };
  }, []);

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
        <Card className="flex flex-col items-center gap-4 p-6 text-center">
          <Avatar size="lg" />
          <div className="flex flex-col gap-1">
            <h2 className="text-base font-semibold text-foreground">Ready when you are</h2>
            <p className="text-sm text-muted">
              We&apos;ll pair you with another verified member for a private chat and video call.
            </p>
          </div>
          <Button type="button" onClick={handleFindSomeone} disabled={loading} className="w-full">
            {loading ? "Starting…" : "Find Someone"}
          </Button>
        </Card>
      )}

      {state === "waiting" && (
        <Card className="flex flex-col items-center gap-4 p-8 text-center">
          <Mascot mood="search" size="lg" caption="Looking…" />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Finding someone for you… 💜</p>
            <p className="text-xs text-muted">Hang tight — we&apos;re looking for a great match.</p>
          </div>
          <Button type="button" variant="outline" onClick={handleCancel} disabled={loading}>
            Cancel
          </Button>
        </Card>
      )}

      {state === "matched" && matchId && socket && (
        <div className="flex flex-col gap-4">
          {showMatchBanner && (
            <Card className="flex items-center gap-3 border-brand/40 bg-surface p-4">
              <Mascot mood="celebrate" size="sm" />
              <div>
                <p className="text-sm font-medium text-foreground">Someone&apos;s here!</p>
                <p className="text-xs text-muted">Say hello or start a video call when you&apos;re ready.</p>
              </div>
            </Card>
          )}
          <CallClient
            key={`call-${matchId}`}
            socket={socket}
            matchId={matchId}
            onPhaseChange={setCallPhase}
            chatOpen={chatOpen}
            onToggleChat={() => setChatOpen((v) => !v)}
          />

          {callPhase === "idle" && !chatOpen && (
            <button
              type="button"
              onClick={() => setChatOpen(true)}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface p-3 text-left"
            >
              <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground shadow-sm">
                <ChatBubbleIcon />
              </span>
              <span className="text-sm text-muted">Open chat</span>
            </button>
          )}

          {/* ChatClient stays mounted continuously (not gated by chatOpen) because its
              chat:join emission is what grants this socket Socket.IO match-room membership,
              which every call:* signaling event also depends on. Only the wrapping panel's
              visibility/position is toggled by chatOpen. */}
          <div
            aria-hidden={!chatOpen}
            className={`fixed inset-x-0 bottom-0 z-[70] flex flex-col overflow-hidden rounded-t-2xl border-t border-border bg-surface shadow-lg transition-transform duration-300 ease-in-out ${
              callPhase === "idle" ? "top-0 rounded-t-none border-t-0" : "top-[22%]"
            } ${chatOpen ? "translate-y-0 pointer-events-auto" : "translate-y-full pointer-events-none"}`}
          >
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <span className="text-sm font-medium text-foreground">Chat</span>
              <button
                type="button"
                onClick={() => setChatOpen(false)}
                aria-label="Close chat"
                title="Close chat"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-surface-hover hover:text-foreground"
              >
                <CloseIcon />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <ChatClient key={`chat-${matchId}`} socket={socket} matchId={matchId} onEnded={handleChatEnded} />
            </div>
          </div>
        </div>
      )}

      {state === "matched" && (!matchId || !socket) && (
        <Card className="flex items-center justify-center gap-2 p-6 text-center">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
          <p className="text-sm text-muted">Connecting…</p>
        </Card>
      )}

      {error && <Alert variant="danger">{error}</Alert>}
    </div>
  );
}
