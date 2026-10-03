"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import type { Socket } from "socket.io-client";

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

  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between text-xs">
        <span
          className={
            connected
              ? "text-green-700 dark:text-green-400"
              : "text-amber-700 dark:text-amber-400"
          }
        >
          {connected ? (otherOnline ? "Connected" : "Connected — they stepped away") : "Reconnecting…"}
        </span>
        <button
          type="button"
          onClick={handleEndChat}
          disabled={ending}
          className="rounded-md border border-red-300 px-3 py-1 font-medium text-red-700 disabled:opacity-60 dark:border-red-900 dark:text-red-400"
        >
          {ending ? "Ending…" : "End Chat"}
        </button>
      </div>

      <div
        ref={listRef}
        className="flex h-80 flex-col gap-2 overflow-y-auto rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
      >
        {loadingHistory && (
          <p className="text-sm text-zinc-500">Loading conversation…</p>
        )}
        {!loadingHistory && joinError && (
          <p className="text-sm text-red-700 dark:text-red-400">{joinError}</p>
        )}
        {!loadingHistory && !joinError && messages.length === 0 && (
          <p className="text-sm text-zinc-500">
            No messages yet. Say hello!
          </p>
        )}
        {messages.map((m) => {
          const mine = m.senderId === myUserId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[75%] rounded-lg px-3 py-2 text-sm ${
                  mine
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100"
                }`}
              >
                {m.content}
              </div>
            </div>
          );
        })}
      </div>

      <div className="h-4 text-xs text-zinc-500">
        {otherTyping && "Typing…"}
      </div>

      {sendError && (
        <p className="text-sm text-red-700 dark:text-red-400">{sendError}</p>
      )}

      <div className="flex items-end gap-2">
        <textarea
          value={input}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!connected || sending}
          rows={2}
          maxLength={MAX_MESSAGE_LENGTH}
          placeholder="Type a message…"
          className="flex-1 resize-none rounded-md border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!connected || sending || !input.trim()}
          className="rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
        >
          Send
        </button>
      </div>
    </div>
  );
}
