"use client";

import Link from "next/link";
import { GateNotice } from "@/components/social/GateNotice";
import { MemberAvatar } from "@/components/social/MemberAvatar";
import { EmptyState, LoadMore, LoadingRows, SocialPage } from "@/components/social/StateViews";
import { social, timeAgo, type ConversationView, type Page } from "@/lib/social/api";
import { useMessageStream } from "@/lib/social/MessagesProvider";
import { refreshUnreadCounts } from "@/lib/social/unreadCounts";
import { usePagedList } from "@/lib/social/usePagedList";

function preview(conversation: ConversationView): string {
  const last = conversation.lastMessage;
  if (!last) return "No messages yet";
  const body = last.isPostShare && !last.content ? "Shared a post" : last.content;
  return `${last.fromMe ? "You: " : ""}${body}`;
}

export function InboxClient() {
  const list = usePagedList<ConversationView>(
    (cursor) => social<Page<ConversationView>>(`/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    "inbox",
  );

  // A message arrived live: update that conversation's preview and unread count
  // and move it to the top; a conversation not on screen yet means reload.
  const { connected } = useMessageStream((message) => {
    const known = list.items.some((c) => c.id === message.conversationId);
    if (!known) {
      list.reload();
      void refreshUnreadCounts();
      return;
    }
    list.setItems((items) => {
      const current = items.find((c) => c.id === message.conversationId);
      if (!current) return items;
      const updated: ConversationView = {
        ...current,
        lastMessage: { content: message.content, createdAt: message.createdAt, fromMe: message.fromMe, isPostShare: message.sharedPost !== null || message.sharedPostUnavailable },
        lastMessageAt: message.createdAt,
        unreadCount: message.fromMe ? current.unreadCount : current.unreadCount + 1,
      };
      return [updated, ...items.filter((c) => c.id !== message.conversationId)];
    });
    void refreshUnreadCounts();
  });

  return (
    <SocialPage title="Messages">
      <p className="text-xs text-muted">
        {connected ? "Live" : "Connecting…"} · You can message members who follow you and whom you follow back. Messages aren&apos;t end-to-end encrypted.
      </p>
      {list.status === "loading" && <LoadingRows label="Loading conversations" />}
      {list.status === "error" && list.error && <GateNotice error={list.error} onResolved={list.reload} onRetry={list.reload} />}
      {list.status === "ready" && list.items.length === 0 && (
        <EmptyState
          title="No conversations yet"
          body="Follow someone and have them follow you back, then message them from their profile."
          action={{ href: "/discover", label: "Find people" }}
        />
      )}
      <ul className="flex flex-col gap-2">
        {list.items.map((conversation) => (
          <li key={conversation.id}>
            <Link
              href={`/messages/${conversation.id}`}
              className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3 hover:bg-surface-hover"
            >
              <MemberAvatar user={conversation.other} size="md" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className={`truncate text-sm ${conversation.unreadCount > 0 ? "font-semibold" : "font-medium"} text-foreground`}>{conversation.other.username}</span>
                  <span className="shrink-0 text-xs text-muted">{conversation.lastMessage ? timeAgo(conversation.lastMessage.createdAt) : ""}</span>
                </span>
                <span className={`block truncate text-sm ${conversation.unreadCount > 0 ? "text-foreground" : "text-muted"}`}>{preview(conversation)}</span>
                {!conversation.canSend && <span className="block text-xs text-muted">Follow each other again to send messages</span>}
              </span>
              {conversation.unreadCount > 0 && (
                <span aria-label={`${conversation.unreadCount} unread`} className="inline-flex min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-xs font-semibold text-accent-foreground">
                  {conversation.unreadCount}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </SocialPage>
  );
}
