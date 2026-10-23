/* eslint-disable @next/next/no-img-element -- shared-post thumbnails are served by an authenticated route */
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { GateNotice } from "@/components/social/GateNotice";
import { MemberAvatar } from "@/components/social/MemberAvatar";
import { EmptyState, LoadingRows, SocialPage } from "@/components/social/StateViews";
import { ApiError, errorMessage, social, timeAgo, type MessageView, type Page, type UserCard } from "@/lib/social/api";
import { useMessageStream } from "@/lib/social/MessagesProvider";
import { refreshUnreadCounts } from "@/lib/social/unreadCounts";

type Loaded = { other: UserCard; canSend: boolean };
const MAX_LENGTH = 2000;

export function ConversationClient({ conversationId }: { conversationId: string }) {
  const [info, setInfo] = useState<Loaded | null>(null);
  // Held oldest-first for display; the API returns newest-first.
  const [messages, setMessages] = useState<MessageView[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const markRead = useCallback(() => {
    social(`/conversations/${conversationId}/read`, { method: "POST" })
      .then(() => refreshUnreadCounts())
      .catch(() => undefined);
  }, [conversationId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const page = await social<Page<MessageView> & Loaded>(`/conversations/${conversationId}/messages?limit=30`);
        if (cancelled) return;
        setInfo({ other: page.other, canSend: page.canSend });
        setMessages([...page.items].reverse());
        setCursor(page.nextCursor);
        setError(null);
        markRead();
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err : new ApiError(errorMessage(err), 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, attempt, markRead]);

  // Live delivery. Messages we sent ourselves arrive here too, so duplicates
  // (the HTTP response and the socket event) are dropped by id.
  const addMessage = useCallback((message: MessageView) => {
    setMessages((current) => (current.some((m) => m.id === message.id) ? current : [...current, message]));
  }, []);

  const { connected } = useMessageStream((message) => {
    if (message.conversationId !== conversationId) return;
    addMessage(message);
    if (!message.fromMe) markRead();
  });

  useEffect(() => {
    if (stickToBottom.current) endRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function loadEarlier() {
    if (!cursor || loadingEarlier) return;
    setLoadingEarlier(true);
    stickToBottom.current = false;
    try {
      const page = await social<Page<MessageView> & Loaded>(`/conversations/${conversationId}/messages?limit=30&cursor=${encodeURIComponent(cursor)}`);
      setMessages((current) => [...[...page.items].reverse(), ...current]);
      setCursor(page.nextCursor);
    } catch (err) {
      setSendError(errorMessage(err));
    } finally {
      setLoadingEarlier(false);
    }
  }

  async function send(event: React.FormEvent) {
    event.preventDefault();
    const content = text.trim();
    if (!content || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const { message } = await social<{ message: MessageView }>(`/conversations/${conversationId}/messages`, { method: "POST", body: { content } });
      stickToBottom.current = true;
      addMessage(message);
      setText("");
    } catch (err) {
      // The text stays in the box so nothing the member typed is lost.
      setSendError(errorMessage(err));
      if (err instanceof ApiError && err.code === "not_mutual") setInfo((i) => (i ? { ...i, canSend: false } : i));
    } finally {
      setSending(false);
    }
  }

  if (error) {
    if (error.status === 404) {
      return (
        <SocialPage>
          <EmptyState title="Conversation not found" body="It doesn't exist, or you don't have access to it." action={{ href: "/messages", label: "Back to messages" }} />
        </SocialPage>
      );
    }
    return (
      <SocialPage>
        <GateNotice error={error} onResolved={() => setAttempt((n) => n + 1)} onRetry={() => setAttempt((n) => n + 1)} />
      </SocialPage>
    );
  }
  if (!info) {
    return (
      <SocialPage>
        <LoadingRows count={2} label="Loading conversation" />
      </SocialPage>
    );
  }

  return (
    <main className="mx-auto flex h-[calc(100dvh-9.5rem)] w-full max-w-xl flex-col px-4 py-4 sm:h-[calc(100dvh-4.5rem)]">
      <header className="mb-3 flex items-center gap-3 border-b border-border pb-3">
        <Link href="/messages" aria-label="Back to messages" className="text-muted hover:text-foreground">
          ←
        </Link>
        <Link href={`/u/${encodeURIComponent(info.other.username)}`} className="flex min-w-0 flex-1 items-center gap-3">
          <MemberAvatar user={info.other} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{info.other.displayName}</span>
            <span className="block truncate text-xs text-muted">@{info.other.username}</span>
          </span>
        </Link>
        <span className="text-xs text-muted">{connected ? "Live" : "Reconnecting…"}</span>
      </header>

      <div role="log" className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto" aria-live="polite" aria-label="Conversation">
        {cursor && (
          <Button type="button" variant="ghost" size="sm" loading={loadingEarlier} onClick={loadEarlier} className="self-center">
            Load earlier messages
          </Button>
        )}
        {messages.length === 0 && <p className="my-auto text-center text-sm text-muted">Say hello 👋</p>}
        {messages.map((message) => (
          <div key={message.id} className={`flex ${message.fromMe ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-3.5 py-2 text-sm ${message.fromMe ? "bg-brand text-brand-foreground" : "bg-surface-hover text-foreground"}`}>
              {message.sharedPost && (
                <Link href={`/post/${message.sharedPost.id}`} className="mb-2 block overflow-hidden rounded-lg border border-border/40 bg-surface text-foreground">
                  <img src={message.sharedPost.imageUrl} alt="" className="aspect-square w-full object-cover" loading="lazy" />
                  <span className="block px-2 py-1.5 text-xs">
                    <span className="font-semibold">@{message.sharedPost.authorUsername}</span> {message.sharedPost.caption}
                  </span>
                </Link>
              )}
              {message.sharedPostUnavailable && <p className="mb-1 text-xs italic opacity-80">Shared post unavailable</p>}
              {message.content && <p className="whitespace-pre-wrap break-words">{message.content}</p>}
              <p className={`mt-0.5 text-[11px] ${message.fromMe ? "text-brand-foreground/70" : "text-muted"}`}>{timeAgo(message.createdAt)}</p>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {!info.canSend ? (
        <p className="mt-3 rounded-md bg-surface-hover px-3 py-2 text-sm text-muted">
          You can only send messages while you and @{info.other.username} follow each other. Your earlier messages stay here.
        </p>
      ) : (
        <form onSubmit={send} className="mt-3 flex flex-col gap-2">
          {sendError && <Alert variant="danger">{sendError}</Alert>}
          <div className="flex items-end gap-2">
            <label className="sr-only" htmlFor="message-text">
              Message
            </label>
            <textarea
              id="message-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  e.currentTarget.form?.requestSubmit();
                }
              }}
              maxLength={MAX_LENGTH}
              rows={1}
              placeholder="Write a message…"
              className="max-h-32 min-h-[44px] flex-1 resize-none rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
            <Button type="submit" loading={sending} disabled={!text.trim()}>
              Send
            </Button>
          </div>
        </form>
      )}
    </main>
  );
}
