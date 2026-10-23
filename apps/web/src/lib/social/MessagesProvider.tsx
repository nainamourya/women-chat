"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import type { MessageView } from "./api";

// One real-time connection for the whole messages area (inbox and
// conversations share it), so opening a conversation doesn't open a second
// socket against the per-member connection limit.
//
// Socket.IO tickets are single-use, so every (re)connection fetches a fresh one
// — see MatchClient for the same pattern. The persisted messages in the
// database are the source of truth; the socket only delivers them sooner, which
// is why every screen also loads history over HTTP.

type Listener = (message: MessageView) => void;

type MessagesContextValue = {
  connected: boolean;
  subscribe: (listener: Listener) => () => void;
};

const MessagesContext = createContext<MessagesContextValue>({ connected: false, subscribe: () => () => undefined });

async function fetchTicket(): Promise<string | null> {
  try {
    const res = await fetch("/api/matchmaking/socket-ticket", { method: "POST" });
    if (!res.ok) return null;
    const data = (await res.json()) as { ticket?: string };
    return data.ticket ?? null;
  } catch {
    return null;
  }
}

export function MessagesProvider({ children }: { children: ReactNode }) {
  const [connected, setConnected] = useState(false);
  const listeners = useRef(new Set<Listener>());

  useEffect(() => {
    let socket: Socket | null = null;
    let cancelled = false;

    (async () => {
      const first = await fetchTicket();
      if (cancelled || !first) return;
      let firstTicket: string | null = first;
      socket = io(process.env.NEXT_PUBLIC_SOCKET_URL!, {
        auth: (done) => {
          if (firstTicket) {
            const ticket = firstTicket;
            firstTicket = null;
            done({ ticket });
            return;
          }
          fetchTicket().then((ticket) => done({ ticket: ticket ?? undefined }));
        },
      });
      socket.on("connect", () => setConnected(true));
      socket.on("disconnect", () => setConnected(false));
      socket.on("dm:message", (message: MessageView) => {
        for (const listener of listeners.current) listener(message);
      });
      // A handshake the server rejects is final for Socket.IO; try again later.
      socket.on("connect_error", () => {
        if (socket && !socket.active) setTimeout(() => !cancelled && socket?.connect(), 3000);
      });
    })();

    return () => {
      cancelled = true;
      socket?.disconnect();
    };
  }, []);

  const subscribe = useCallback((listener: Listener) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const value = useMemo(() => ({ connected, subscribe }), [connected, subscribe]);
  return <MessagesContext.Provider value={value}>{children}</MessagesContext.Provider>;
}

export function useMessageStream(listener: Listener): { connected: boolean } {
  const { connected, subscribe } = useContext(MessagesContext);
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => subscribe((message) => latest.current(message)), [subscribe]);
  return { connected };
}
