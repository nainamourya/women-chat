"use client";

import Link from "next/link";
import { GateNotice } from "@/components/social/GateNotice";
import { PostCard } from "@/components/social/PostCard";
import { EmptyState, LoadMore, LoadingRows, SocialPage } from "@/components/social/StateViews";
import { social, type Page, type PostView } from "@/lib/social/api";
import { usePagedList } from "@/lib/social/usePagedList";

export function FeedClient() {
  const feed = usePagedList<PostView>((cursor) => social<Page<PostView>>(`/feed${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`), "feed");

  function replace(post: PostView | null, id: string) {
    feed.setItems((items) => (post ? items.map((p) => (p.id === id ? post : p)) : items.filter((p) => p.id !== id)));
  }

  return (
    <SocialPage
      title="Home"
      actions={
        <Link href="/post/new" className="rounded-md bg-brand px-3.5 py-2 text-sm font-medium text-brand-foreground shadow-md hover:bg-brand-hover">
          Share a Gii
        </Link>
      }
    >
      {feed.status === "loading" && <LoadingRows label="Loading your circle" />}
      {feed.status === "error" && feed.error && <GateNotice error={feed.error} onResolved={feed.reload} onRetry={feed.reload} />}
      {feed.status === "ready" && feed.items.length === 0 && (
        <EmptyState
          title="Your circle is quiet"
          body="Giis from women in your circle show up here. Search for women to add, or share your first Gii."
          action={{ href: "/discover", label: "Search for women" }}
        />
      )}
      {feed.status === "ready" && (
        <div className="flex flex-col gap-4">
          {feed.items.map((post) => (
            <PostCard key={post.id} post={post} onChange={(updated) => replace(updated, post.id)} />
          ))}
        </div>
      )}
      {feed.status === "ready" && feed.error && <p role="alert" className="text-sm text-danger">{feed.error.message}</p>}
      <LoadMore hasMore={feed.hasMore} loading={feed.loadingMore} onClick={feed.loadMore} />
    </SocialPage>
  );
}
