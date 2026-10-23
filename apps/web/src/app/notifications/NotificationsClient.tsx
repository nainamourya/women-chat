/* eslint-disable @next/next/no-img-element -- thumbnails are served by an authenticated route */
"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { GateNotice } from "@/components/social/GateNotice";
import { MemberAvatar } from "@/components/social/MemberAvatar";
import { EmptyState, LoadMore, LoadingRows, SocialPage } from "@/components/social/StateViews";
import { social, timeAgo, type NotificationItem, type Page } from "@/lib/social/api";
import { refreshUnreadCounts } from "@/lib/social/unreadCounts";
import { usePagedList } from "@/lib/social/usePagedList";

function describe(n: NotificationItem): string {
  switch (n.type) {
    case "follow":
      return "started following you.";
    case "like":
      return "liked your post.";
    case "comment":
      return n.commentPreview ? `commented: “${n.commentPreview}”` : "commented on your post.";
    case "message":
      return "sent you a message.";
  }
}

function hrefFor(n: NotificationItem): string {
  if (n.type === "message" && n.conversationId) return `/messages/${n.conversationId}`;
  if ((n.type === "like" || n.type === "comment") && n.postId) return `/post/${n.postId}`;
  return `/u/${encodeURIComponent(n.actor.username)}`;
}

export function NotificationsClient() {
  const list = usePagedList<NotificationItem>(
    (cursor) => social<Page<NotificationItem>>(`/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    "notifications",
  );

  // Opening the screen marks everything read on the server. The items keep the
  // `read` state they were loaded with, so this visit still shows what was new.
  const marked = useRef(false);
  useEffect(() => {
    if (list.status !== "ready" || marked.current) return;
    marked.current = true;
    social("/notifications/read", { method: "POST", body: {} })
      .then(() => refreshUnreadCounts())
      .catch(() => undefined);
  }, [list.status]);

  return (
    <SocialPage title="Notifications">
      {list.status === "loading" && <LoadingRows label="Loading notifications" />}
      {list.status === "error" && list.error && <GateNotice error={list.error} onResolved={list.reload} onRetry={list.reload} />}
      {list.status === "ready" && list.items.length === 0 && (
        <EmptyState title="Nothing new yet" body="You'll see new followers, likes, comments and messages here." />
      )}
      <ul className="flex flex-col gap-2">
        {list.items.map((n) => (
          <li key={n.id}>
            <Link
              href={hrefFor(n)}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 hover:bg-surface-hover ${n.read ? "border-border bg-surface" : "border-brand/40 bg-brand/5"}`}
            >
              <MemberAvatar user={n.actor} size="md" />
              <span className="min-w-0 flex-1 text-sm text-foreground">
                <span className="font-semibold">{n.actor.username}</span> {describe(n)}
                <span className="block text-xs text-muted">{timeAgo(n.createdAt)}</span>
              </span>
              {!n.read && <span aria-label="New" className="h-2 w-2 shrink-0 rounded-full bg-accent" />}
              {n.postImageUrl && <img src={n.postImageUrl} alt="" className="h-11 w-11 shrink-0 rounded-md object-cover" loading="lazy" />}
            </Link>
          </li>
        ))}
      </ul>
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </SocialPage>
  );
}
