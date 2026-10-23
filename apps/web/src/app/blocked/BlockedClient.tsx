"use client";

import { useEffect, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { GateNotice } from "@/components/social/GateNotice";
import { MemberAvatar } from "@/components/social/MemberAvatar";
import { EmptyState, LoadingRows, SocialPage } from "@/components/social/StateViews";
import { ApiError, errorMessage, social, type UserCard } from "@/lib/social/api";

export function BlockedClient() {
  const [users, setUsers] = useState<UserCard[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await social<{ users: UserCard[] }>("/blocked");
        if (!cancelled) {
          setUsers(result.users);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err : new ApiError(errorMessage(err), 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function unblock(username: string) {
    setBusy(username);
    setActionError(null);
    try {
      await social(`/users/${encodeURIComponent(username)}/block`, { method: "DELETE" });
      setUsers((list) => list?.filter((u) => u.username !== username) ?? null);
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  const retry = () => setAttempt((n) => n + 1);

  return (
    <SocialPage title="Blocked accounts">
      <p className="text-sm text-muted">Blocked members can&apos;t see your profile or posts, follow you or message you, and you can&apos;t see theirs.</p>
      {error && <GateNotice error={error} onResolved={retry} onRetry={retry} />}
      {!error && users === null && <LoadingRows count={2} label="Loading" />}
      {users && users.length === 0 && <EmptyState title="You haven't blocked anyone" />}
      {actionError && <Alert variant="danger">{actionError}</Alert>}
      <ul className="flex flex-col gap-2">
        {users?.map((user) => (
          <li key={user.username} className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
            <MemberAvatar user={user} size="md" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{user.username}</span>
              <span className="block truncate text-xs text-muted">{user.displayName}</span>
            </span>
            <Button type="button" size="sm" variant="outline" loading={busy === user.username} onClick={() => unblock(user.username)}>
              Unblock
            </Button>
          </li>
        ))}
      </ul>
    </SocialPage>
  );
}
