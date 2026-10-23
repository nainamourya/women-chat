/* eslint-disable @next/next/no-img-element -- images are served by an authenticated route */
"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { errorMessage, social, timeAgo, type PostView } from "@/lib/social/api";
import { MemberAvatar } from "./MemberAvatar";
import { ReportDialog } from "./ReportDialog";
import { ShareDialog } from "./ShareDialog";

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M12 20s-7-4.4-9.3-8.8C1.2 7.8 3 4.5 6.4 4.5c2 0 3.5 1.1 5.6 3 2.1-1.9 3.6-3 5.6-3 3.4 0 5.2 3.3 3.7 6.7C19 15.6 12 20 12 20z" strokeLinejoin="round" />
    </svg>
  );
}

const iconButton = "inline-flex items-center gap-1.5 rounded-md p-1 text-foreground transition-colors hover:text-brand focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-60";

// One post: author, photo, like / comment / share, caption, and an overflow menu
// (delete for the author, report for everyone else). `onChange` receives the
// updated post, or null once it has been deleted.
export function PostCard({
  post,
  onChange,
  linkToDetail = true,
}: {
  post: PostView;
  onChange: (post: PostView | null) => void;
  linkToDetail?: boolean;
}) {
  const [liking, setLiking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggleLike() {
    if (liking) return;
    setLiking(true);
    setError(null);
    try {
      const result = await social<{ liked: boolean; likeCount: number }>(`/posts/${post.id}/like`, {
        method: post.likedByViewer ? "DELETE" : "POST",
      });
      onChange({ ...post, likedByViewer: result.liked, likeCount: result.likeCount });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLiking(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setError(null);
    try {
      await social(`/posts/${post.id}`, { method: "DELETE" });
      onChange(null);
    } catch (err) {
      setError(errorMessage(err));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const detailHref = `/post/${post.id}`;

  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface shadow-sm" aria-label={`Post by ${post.author.username}`}>
      <header className="flex items-center gap-3 px-4 py-3">
        <Link href={`/u/${post.author.username}`} className="flex min-w-0 flex-1 items-center gap-3">
          <MemberAvatar user={post.author} size="sm" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{post.author.username}</span>
            <span className="block text-xs text-muted">{timeAgo(post.createdAt)}</span>
          </span>
        </Link>
        <div className="relative">
          <button
            type="button"
            aria-label="More options"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
            className="rounded-md p-1.5 text-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="1.7" />
              <circle cx="12" cy="12" r="1.7" />
              <circle cx="19" cy="12" r="1.7" />
            </svg>
          </button>
          {menuOpen && (
            <div className="absolute right-0 z-10 mt-1 w-40 overflow-hidden rounded-md border border-border bg-surface shadow-md">
              {post.isOwner ? (
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-danger-bg"
                  onClick={() => {
                    setMenuOpen(false);
                    setConfirmDelete(true);
                  }}
                >
                  Delete post
                </button>
              ) : (
                <button
                  type="button"
                  className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover"
                  onClick={() => {
                    setMenuOpen(false);
                    setReportOpen(true);
                  }}
                >
                  Report post
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      {linkToDetail ? (
        <Link href={detailHref} aria-label="Open post">
          <img src={post.imageUrl} alt={post.caption ? `Photo: ${post.caption.slice(0, 100)}` : `Photo by ${post.author.username}`} loading="lazy" className="aspect-square w-full bg-background object-cover" />
        </Link>
      ) : (
        <img src={post.imageUrl} alt={post.caption ? `Photo: ${post.caption.slice(0, 100)}` : `Photo by ${post.author.username}`} className="aspect-square w-full bg-background object-cover" />
      )}

      <div className="flex flex-col gap-2 px-4 py-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={toggleLike}
            disabled={liking}
            aria-pressed={post.likedByViewer}
            aria-label={post.likedByViewer ? "Unlike" : "Like"}
            className={`${iconButton} ${post.likedByViewer ? "text-accent hover:text-accent" : ""}`}
          >
            <HeartIcon filled={post.likedByViewer} />
          </button>
          <Link href={`${detailHref}#comments`} className={iconButton} aria-label="Comments">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinejoin="round" d="M4 11c0-4 3.6-7 8-7s8 3 8 7-3.6 7-8 7c-1 0-2-.15-2.9-.45L5 19.5l1.2-3.6C4.8 14.6 4 12.9 4 11z" />
            </svg>
          </Link>
          <button type="button" onClick={() => setShareOpen(true)} className={iconButton} aria-label="Share">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 3 10 14M21 3l-6.5 18-3.5-7-7-3.5L21 3z" />
            </svg>
          </button>
        </div>

        <p className="text-sm font-semibold text-foreground" aria-live="polite">
          {post.likeCount === 1 ? "1 like" : `${post.likeCount} likes`}
        </p>
        {post.caption && (
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">
            <Link href={`/u/${post.author.username}`} className="font-semibold">
              {post.author.username}
            </Link>{" "}
            {post.caption}
          </p>
        )}
        {linkToDetail && post.commentCount > 0 && (
          <Link href={`${detailHref}#comments`} className="text-sm text-muted hover:text-foreground">
            View {post.commentCount === 1 ? "1 comment" : `all ${post.commentCount} comments`}
          </Link>
        )}
        {error && <Alert variant="danger">{error}</Alert>}
        {confirmDelete && (
          <div role="alertdialog" aria-label="Confirm delete" className="flex items-center justify-between gap-2 rounded-md bg-danger-bg px-3 py-2 text-sm text-danger">
            <span>Delete this post?</span>
            <span className="flex gap-2">
              <button type="button" className="font-medium" onClick={() => setConfirmDelete(false)} disabled={deleting}>
                Cancel
              </button>
              <button type="button" className="font-semibold underline" onClick={remove} disabled={deleting}>
                {deleting ? "Deleting…" : "Delete"}
              </button>
            </span>
          </div>
        )}
      </div>

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} postId={post.id} />
      <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} path={`/posts/${post.id}/report`} title="Report this post" />
    </article>
  );
}
