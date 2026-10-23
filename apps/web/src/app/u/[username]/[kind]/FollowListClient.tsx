"use client";

import Link from "next/link";
import { GateNotice } from "@/components/social/GateNotice";
import { UserRow } from "@/components/social/UserRow";
import { EmptyState, LoadMore, LoadingRows, SocialPage } from "@/components/social/StateViews";
import { social, type Page, type UserListItem } from "@/lib/social/api";
import { usePagedList } from "@/lib/social/usePagedList";

export function FollowListClient({ username, kind }: { username: string; kind: "followers" | "following" }) {
  const list = usePagedList<UserListItem>(
    (cursor) => social<Page<UserListItem>>(`/users/${encodeURIComponent(username)}/${kind}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    `${kind}:${username}`,
  );

  return (
    <SocialPage
      title={kind === "followers" ? "Followers" : "Following"}
      actions={
        <Link href={`/u/${encodeURIComponent(username)}`} className="text-sm text-muted hover:text-foreground">
          @{username}
        </Link>
      }
    >
      {list.status === "loading" && <LoadingRows label="Loading" />}
      {list.status === "error" && list.error &&
        (list.error.status === 404 ? (
          <EmptyState title="Member not found" action={{ href: "/discover", label: "Find people" }} />
        ) : (
          <GateNotice error={list.error} onResolved={list.reload} onRetry={list.reload} />
        ))}
      {list.status === "ready" && list.items.length === 0 && (
        <EmptyState title={kind === "followers" ? "No followers yet" : "Not following anyone yet"} />
      )}
      <ul className="flex flex-col gap-2">
        {list.items.map((user) => (
          <UserRow
            key={user.username}
            user={user}
            onFollowChange={(following) => list.setItems((items) => items.map((u) => (u.username === user.username ? { ...u, isFollowing: following } : u)))}
          />
        ))}
      </ul>
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </SocialPage>
  );
}
