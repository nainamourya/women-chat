"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { GateNotice } from "@/components/social/GateNotice";
import { MemberAvatar } from "@/components/social/MemberAvatar";
import { PostCard } from "@/components/social/PostCard";
import { EmptyState, LoadMore, LoadingRows, SocialPage } from "@/components/social/StateViews";
import { ApiError, errorMessage, social, timeAgo, type CommentView, type Page, type PostView } from "@/lib/social/api";
import { usePagedList } from "@/lib/social/usePagedList";

const MAX_COMMENT = 1000;

export function PostDetailClient({ postId }: { postId: string }) {
  const router = useRouter();
  const [post, setPost] = useState<PostView | null>(null);
  const [postError, setPostError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await social<{ post: PostView }>(`/posts/${postId}`);
        if (!cancelled) {
          setPost(result.post);
          setPostError(null);
        }
      } catch (err) {
        if (!cancelled) setPostError(err instanceof ApiError ? err : new ApiError(errorMessage(err), 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [postId, attempt]);

  if (postError) {
    if (postError.status === 404) {
      return (
        <SocialPage>
          <EmptyState title="This post isn't available" body="It may have been deleted, or you might not have access to it." action={{ href: "/feed", label: "Back to home" }} />
        </SocialPage>
      );
    }
    return (
      <SocialPage>
        <GateNotice error={postError} onResolved={() => setAttempt((n) => n + 1)} onRetry={() => setAttempt((n) => n + 1)} />
      </SocialPage>
    );
  }
  if (!post) {
    return (
      <SocialPage>
        <LoadingRows count={1} label="Loading post" />
      </SocialPage>
    );
  }

  return (
    <SocialPage>
      <PostCard post={post} linkToDetail={false} onChange={(updated) => (updated ? setPost(updated) : router.replace("/feed"))} />
      <Comments post={post} onCountChange={(delta) => setPost((p) => (p ? { ...p, commentCount: Math.max(0, p.commentCount + delta) } : p))} />
    </SocialPage>
  );
}

function Comments({ post, onCountChange }: { post: PostView; onCountChange: (delta: number) => void }) {
  const list = usePagedList<CommentView>(
    (cursor) => social<Page<CommentView>>(`/posts/${post.id}/comments${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`),
    `comments:${post.id}`,
  );
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!text.trim()) return;
    setPosting(true);
    setError(null);
    try {
      const { comment } = await social<{ comment: CommentView }>(`/posts/${post.id}/comments`, { method: "POST", body: { content: text } });
      list.setItems((items) => [...items, comment]);
      onCountChange(1);
      setText("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPosting(false);
    }
  }

  async function remove(comment: CommentView) {
    setError(null);
    try {
      await social(`/comments/${comment.id}`, { method: "DELETE" });
      list.setItems((items) => items.filter((c) => c.id !== comment.id));
      onCountChange(-1);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  return (
    <section id="comments" aria-label="Comments" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-foreground">Comments</h2>

      <form onSubmit={submit} className="flex flex-col gap-2">
        <label className="sr-only" htmlFor="new-comment">
          Add a comment
        </label>
        <textarea
          id="new-comment"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={MAX_COMMENT}
          rows={2}
          placeholder="Add a comment…"
          className="rounded-md border border-border bg-surface px-3 py-2.5 text-sm text-foreground placeholder:text-muted focus-visible:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
        />
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted">
            {text.length}/{MAX_COMMENT}
          </span>
          <Button type="submit" size="sm" loading={posting} disabled={!text.trim()}>
            Post
          </Button>
        </div>
      </form>
      {error && <Alert variant="danger">{error}</Alert>}

      {list.status === "loading" && <LoadingRows count={2} label="Loading comments" />}
      {list.status === "error" && list.error && <Alert variant="danger">{list.error.message}</Alert>}
      {list.status === "ready" && list.items.length === 0 && <p className="text-sm text-muted">No comments yet. Start the conversation.</p>}
      <ul className="flex flex-col gap-3">
        {list.items.map((comment) => (
          <li key={comment.id} className="flex items-start gap-3">
            <Link href={`/u/${comment.author.username}`}>
              <MemberAvatar user={comment.author} size="sm" />
            </Link>
            <div className="min-w-0 flex-1">
              <p className="whitespace-pre-wrap break-words text-sm text-foreground">
                <Link href={`/u/${comment.author.username}`} className="font-semibold">
                  {comment.author.username}
                </Link>{" "}
                {comment.content}
              </p>
              <p className="mt-0.5 flex items-center gap-3 text-xs text-muted">
                <span>{timeAgo(comment.createdAt)}</span>
                {comment.canDelete && (
                  <button type="button" onClick={() => remove(comment)} className="hover:text-danger">
                    Delete
                  </button>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
      <LoadMore hasMore={list.hasMore} loading={list.loadingMore} onClick={list.loadMore} />
    </section>
  );
}
