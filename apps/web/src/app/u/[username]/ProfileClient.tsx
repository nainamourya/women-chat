/* eslint-disable @next/next/no-img-element -- images are served by an authenticated route */
"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { EditProfileDialog } from "@/components/social/EditProfileDialog";
import { FollowButton } from "@/components/social/FollowButton";
import { GateNotice } from "@/components/social/GateNotice";
import { MemberAvatar } from "@/components/social/MemberAvatar";
import { ReportDialog } from "@/components/social/ReportDialog";
import { EmptyState, LoadMore, LoadingRows, SocialPage } from "@/components/social/StateViews";
import { ApiError, errorMessage, social, type OwnProfile, type Page, type PostView, type ProfileView } from "@/lib/social/api";
import { usePagedList } from "@/lib/social/usePagedList";

function Stat({ value, label, href }: { value: number; label: string; href?: string }) {
  const body = (
    <>
      <span className="block text-base font-semibold text-foreground">{value}</span>
      <span className="block text-xs text-muted">{label}</span>
    </>
  );
  return href ? (
    <Link href={href} className="text-center hover:opacity-80">
      {body}
    </Link>
  ) : (
    <div className="text-center">{body}</div>
  );
}

export function ProfileClient({ username }: { username: string }) {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileView | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [editOpen, setEditOpen] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [messaging, setMessaging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await social<{ profile: ProfileView }>(`/users/${encodeURIComponent(username)}`);
        if (!cancelled) {
          setProfile(result.profile);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err : new ApiError(errorMessage(err), 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [username, attempt]);

  const posts = usePagedList<PostView>(
    (cursor) => social<Page<PostView>>(`/users/${encodeURIComponent(username)}/posts?limit=12${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
    `profile-posts:${username}`,
  );

  async function startMessage() {
    setMessaging(true);
    setActionError(null);
    try {
      const { id } = await social<{ id: string }>("/conversations", { method: "POST", body: { username } });
      router.push(`/messages/${id}`);
    } catch (err) {
      setActionError(errorMessage(err));
      setMessaging(false);
    }
  }

  async function block() {
    setMenuOpen(false);
    if (!window.confirm(`Block @${username}? You won't see each other's profiles or posts, and any follows between you will be removed.`)) return;
    setActionError(null);
    try {
      await social(`/users/${encodeURIComponent(username)}/block`, { method: "POST" });
      router.push("/feed");
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  if (error) {
    if (error.status === 404) {
      return (
        <SocialPage>
          <EmptyState title="Member not found" body="This profile doesn't exist or isn't available to you." action={{ href: "/discover", label: "Find people" }} />
        </SocialPage>
      );
    }
    return (
      <SocialPage>
        <GateNotice error={error} onResolved={() => setAttempt((n) => n + 1)} onRetry={() => setAttempt((n) => n + 1)} />
      </SocialPage>
    );
  }
  if (!profile) {
    return (
      <SocialPage>
        <LoadingRows count={1} label="Loading profile" />
      </SocialPage>
    );
  }

  const base = `/u/${encodeURIComponent(profile.username)}`;

  return (
    <SocialPage>
      <section aria-label="Profile" className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5 shadow-sm">
        <div className="flex items-center gap-5">
          <MemberAvatar user={profile} size="xl" />
          <div className="flex flex-1 justify-around">
            <Stat value={profile.postCount} label={profile.postCount === 1 ? "post" : "posts"} />
            <Stat value={profile.followerCount} label={profile.followerCount === 1 ? "follower" : "followers"} href={`${base}/followers`} />
            <Stat value={profile.followingCount} label="following" href={`${base}/following`} />
          </div>
        </div>

        <div className="flex flex-col gap-0.5">
          <h1 className="text-base font-semibold text-foreground">{profile.displayName}</h1>
          <p className="text-sm text-muted">@{profile.username}</p>
          {profile.bio && <p className="mt-1 whitespace-pre-wrap break-words text-sm text-foreground">{profile.bio}</p>}
          {!profile.isSelf && profile.followsYou && <p className="mt-1 text-xs text-muted">Follows you</p>}
        </div>

        <div className="flex flex-wrap items-start gap-2">
          {profile.isSelf ? (
            <>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)}>
                Edit profile
              </Button>
              <Link href="/post/new" className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground shadow-md hover:bg-brand-hover">
                New post
              </Link>
              <Link href="/blocked" className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-hover">
                Blocked accounts
              </Link>
            </>
          ) : (
            <>
              <FollowButton
                username={profile.username}
                isFollowing={profile.isFollowing}
                followsYou={profile.followsYou}
                size="sm"
                onChange={(following, followerCount) => setProfile({ ...profile, isFollowing: following, isMutual: following && profile.followsYou, followerCount })}
              />
              {profile.isMutual ? (
                <Button type="button" variant="outline" size="sm" loading={messaging} onClick={startMessage}>
                  Message
                </Button>
              ) : (
                <span className="self-center text-xs text-muted">You can message each other once you both follow each other.</span>
              )}
              <div className="relative ml-auto">
                <button type="button" aria-label="More options" aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)} className="rounded-md p-1.5 text-muted hover:text-foreground">
                  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
                    <circle cx="5" cy="12" r="1.7" />
                    <circle cx="12" cy="12" r="1.7" />
                    <circle cx="19" cy="12" r="1.7" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="absolute right-0 z-10 mt-1 w-36 overflow-hidden rounded-md border border-border bg-surface shadow-md">
                    <button type="button" className="block w-full px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover" onClick={() => { setMenuOpen(false); setReportOpen(true); }}>
                      Report
                    </button>
                    <button type="button" className="block w-full px-3 py-2 text-left text-sm text-danger hover:bg-danger-bg" onClick={block}>
                      Block
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
        {actionError && <Alert variant="danger">{actionError}</Alert>}
      </section>

      <section aria-label="Posts">
        {posts.status === "loading" && <LoadingRows count={2} label="Loading posts" />}
        {posts.status === "error" && posts.error && <Alert variant="danger">{posts.error.message}</Alert>}
        {posts.status === "ready" && posts.items.length === 0 && (
          <EmptyState
            title={profile.isSelf ? "Share your first photo" : "No posts yet"}
            body={profile.isSelf ? "Your photos will show up here." : `@${profile.username} hasn't posted anything yet.`}
            action={profile.isSelf ? { href: "/post/new", label: "Create a post" } : undefined}
          />
        )}
        <ul className="grid grid-cols-3 gap-1">
          {posts.items.map((post) => (
            <li key={post.id}>
              <Link href={`/post/${post.id}`} aria-label={post.caption ? `Open post: ${post.caption.slice(0, 60)}` : "Open post"}>
                <img src={post.imageUrl} alt="" loading="lazy" className="aspect-square w-full bg-background object-cover" />
              </Link>
            </li>
          ))}
        </ul>
        <div className="mt-3">
          <LoadMore hasMore={posts.hasMore} loading={posts.loadingMore} onClick={posts.loadMore} />
        </div>
      </section>

      {profile.isSelf ? (
        <EditProfileDialog
          key={`${profile.username}:${profile.displayName}:${editOpen}`}
          open={editOpen}
          onClose={() => setEditOpen(false)}
          profile={profile}
          onSaved={(saved: OwnProfile) => {
            setProfile(saved);
            if (saved.username !== username) router.replace(`/u/${encodeURIComponent(saved.username)}`);
          }}
        />
      ) : (
        <ReportDialog open={reportOpen} onClose={() => setReportOpen(false)} path={`/users/${encodeURIComponent(profile.username)}/report`} title={`Report @${profile.username}`} />
      )}
    </SocialPage>
  );
}
