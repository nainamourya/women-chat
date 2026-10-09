"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { Socket } from "socket.io-client";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Avatar } from "@/components/ui/Avatar";
import { ReportModal } from "./ReportModal";

const MAX_MESSAGE_LENGTH = 2000;
const TYPING_STOP_DELAY_MS = 2000;

type ChatMessage = {
  id: string;
  matchId: string;
  senderId: string;
  content: string;
  createdAt: string;
};

type JoinAck =
  | { ok: true; messages: ChatMessage[]; otherUserId: string }
  | { ok: false; error: string };

type SendAck = { ok: true; message: ChatMessage } | { ok: false; error: string };
type EndAck = { ok: true } | { ok: false; error: string };

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.2s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted [animation-delay:-0.1s]" />
      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-muted" />
    </span>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4">
      <path d="M3.4 20.6c-.5.2-1-.3-.8-.8L5 13.5 2.6 4.2c-.2-.5.3-1 .8-.8l17.6 8a.8.8 0 0 1 0 1.4l-17.6 8z" />
    </svg>
  );
}

export function ChatClient({
  socket,
  matchId,
  onEnded,
}: {
  socket: Socket;
  matchId: string;
  onEnded: () => void;
}) {
  const { data: session } = useSession();
  const myUserId = session?.user?.id;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [connected, setConnected] = useState(socket.connected);
  const [otherTyping, setOtherTyping] = useState(false);
  const [otherOnline, setOtherOnline] = useState(true);
  const [input, setInput] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [ending, setEnding] = useState(false);
  const [otherUserId, setOtherUserId] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmingBlock, setConfirmingBlock] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, otherTyping]);

  useEffect(() => {
    function handleConnect() {
      setConnected(true);
    }
    function handleDisconnect() {
      setConnected(false);
    }
    function handleMessage(message: ChatMessage) {
      if (message.matchId !== matchId) return;
      setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
    }
    function handleTypingStart(payload: { userId: string }) {
      if (payload.userId !== myUserId) setOtherTyping(true);
    }
    function handleTypingStop(payload: { userId: string }) {
      if (payload.userId !== myUserId) setOtherTyping(false);
    }
    function handleUserConnected(payload: { userId: string }) {
      if (payload.userId !== myUserId) setOtherOnline(true);
    }
    function handleUserDisconnected(payload: { userId: string }) {
      if (payload.userId !== myUserId) setOtherOnline(false);
    }
    function handleEnded() {
      onEnded();
    }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("chat:message", handleMessage);
    socket.on("chat:typing_start", handleTypingStart);
    socket.on("chat:typing_stop", handleTypingStop);
    socket.on("chat:user_connected", handleUserConnected);
    socket.on("chat:user_disconnected", handleUserDisconnected);
    socket.on("chat:ended", handleEnded);

    socket.emit("chat:join", { matchId }, (ack: JoinAck) => {
      setLoadingHistory(false);
      if (ack.ok) {
        setMessages(ack.messages);
        setOtherUserId(ack.otherUserId);
      } else {
        setJoinError(ack.error);
      }
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("chat:message", handleMessage);
      socket.off("chat:typing_start", handleTypingStart);
      socket.off("chat:typing_stop", handleTypingStop);
      socket.off("chat:user_connected", handleUserConnected);
      socket.off("chat:user_disconnected", handleUserDisconnected);
      socket.off("chat:ended", handleEnded);
      if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, matchId, myUserId]);

  function stopTyping() {
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      socket.emit("chat:typing_stop", { matchId });
    }
  }

  function handleInputChange(value: string) {
    setInput(value);
    setSendError(null);

    if (value.trim().length === 0) {
      stopTyping();
      return;
    }

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      socket.emit("chat:typing_start", { matchId });
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(stopTyping, TYPING_STOP_DELAY_MS);
  }

  function handleSend() {
    const content = input.trim();
    if (!content) return;
    if (content.length > MAX_MESSAGE_LENGTH) {
      setSendError(`Message cannot exceed ${MAX_MESSAGE_LENGTH} characters.`);
      return;
    }

    setSending(true);
    setSendError(null);
    stopTyping();

    socket.emit("chat:message", { matchId, content }, (ack: SendAck) => {
      setSending(false);
      if (ack.ok) {
        setInput("");
      } else {
        setSendError(ack.error);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  async function handleBlock() {
    if (!otherUserId) return;
    setBlocking(true);
    setBlockError(null);

    try {
      const res = await fetch("/api/blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blockedUserId: otherUserId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setBlockError(data.error ?? "Something went wrong.");
        setBlocking(false);
        setConfirmingBlock(false);
        return;
      }

      // Blocking also ends the current chat — you won't be matched with this
      // user again, so there's nothing left to continue here. This reuses
      // the same "chat:end" flow as the End Chat button.
      socket.emit("chat:end", { matchId }, (ack: EndAck) => {
        setBlocking(false);
        setConfirmingBlock(false);
        if (!ack.ok) {
          setBlockError(ack.error);
        }
      });
    } catch {
      setBlockError("Something went wrong. Please try again.");
      setBlocking(false);
      setConfirmingBlock(false);
    }
  }

  function handleEndChat() {
    setEnding(true);
    socket.emit("chat:end", { matchId }, (ack: EndAck) => {
      setEnding(false);
      if (!ack.ok) {
        setSendError(ack.error);
      }
      // On success, the "chat:ended" broadcast (received by both participants,
      // including this one) is what actually triggers onEnded().
    });
  }

  const statusBadge = !connected
    ? { variant: "warning" as const, label: "Reconnecting…" }
    : otherOnline
      ? { variant: "success" as const, label: "Connected" }
      : { variant: "warning" as const, label: "They stepped away" };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-3">
        <div className="flex items-center gap-2.5">
          <span className="relative inline-flex shrink-0">
            <Avatar size="sm" />
            <span
              className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full border-2 border-surface ${
                connected && otherOnline ? "bg-success" : "bg-warning"
              }`}
            />
          </span>
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">Chat partner</span>
            <span
              className={`text-xs ${connected && otherOnline ? "text-success" : "text-warning"}`}
            >
              {statusBadge.label}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {otherUserId && (
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setReportOpen(true)}
                className="!px-2"
              >
                Report
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setConfirmingBlock(true)}
                className="!px-2"
              >
                Block
              </Button>
            </>
          )}
          <Button type="button" variant="danger" size="sm" onClick={handleEndChat} disabled={ending}>
            {ending ? "Ending…" : "End Chat"}
          </Button>
        </div>
      </div>

      {confirmingBlock && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3 text-sm">
          <p className="text-foreground">
            Block this user? You won&apos;t be matched with them again, and this chat will end.
          </p>
          {blockError && <p className="text-danger">{blockError}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => setConfirmingBlock(false)} disabled={blocking}>
              Cancel
            </Button>
            <Button type="button" variant="danger" size="sm" onClick={handleBlock} disabled={blocking}>
              {blocking ? "Blocking…" : "Block User"}
            </Button>
          </div>
        </div>
      )}

      {otherUserId && (
        <ReportModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          reportedUserId={otherUserId}
          matchId={matchId}
        />
      )}

      <div
        ref={listRef}
        className="flex h-[55vh] min-h-[280px] max-h-[480px] flex-col gap-2.5 overflow-y-auto scroll-smooth rounded-md bg-background p-3"
      >
        {loadingHistory && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted">Loading conversation…</p>
          </div>
        )}
        {!loadingHistory && joinError && (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-danger">{joinError}</p>
          </div>
        )}
        {!loadingHistory && !joinError && messages.length === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
            <Avatar size="lg" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-foreground">You&apos;re connected!</p>
              <p className="text-sm text-muted">No messages yet — say hello 👋</p>
            </div>
          </div>
        )}
        {messages.map((m) => {
          const mine = m.senderId === myUserId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`flex max-w-[80%] flex-col gap-1 ${mine ? "items-end" : "items-start"}`}>
                <div
                  className={`rounded-2xl px-3.5 py-2 text-sm leading-relaxed break-words whitespace-pre-wrap shadow-sm ${
                    mine
                      ? "bg-brand text-brand-foreground"
                      : "bg-surface-hover text-foreground"
                  }`}
                >
                  {m.content}
                </div>
                <span className="px-1 text-[11px] text-muted">{formatTime(m.createdAt)}</span>
              </div>
            </div>
          );
        })}
        {otherTyping && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-surface-hover px-3.5 py-2.5">
              <TypingDots />
            </div>
          </div>
        )}
      </div>

      {sendError && <p className="text-sm text-danger">{sendError}</p>}

      <div className="flex items-end gap-2">
        <Textarea
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!connected || sending}
          rows={1}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Type a message…"
          className="min-h-[46px] flex-1 py-3"
        />
        <Button
          type="button"
          onClick={handleSend}
          disabled={!connected || sending || !input.trim()}
          className="h-[46px] w-[46px] shrink-0 !p-0"
          aria-label="Send message"
          title="Send message"
        >
          <SendIcon />
        </Button>
      </div>
    </Card>
  );
}
