"use client";

import { useEffect, useState } from "react";
import { Input } from "@/components/ui/Input";
import { GateNotice } from "@/components/social/GateNotice";
import { UserRow } from "@/components/social/UserRow";
import { EmptyState, LoadingRows, SocialPage } from "@/components/social/StateViews";
import { ApiError, errorMessage, query, social, type UserListItem } from "@/lib/social/api";

const MIN_CHARS = 2;

export function DiscoverClient() {
  const [text, setText] = useState("");
  const [term, setTerm] = useState("");
  const [users, setUsers] = useState<UserListItem[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Wait for a pause in typing before searching.
  useEffect(() => {
    const timer = setTimeout(() => setTerm(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text]);

  useEffect(() => {
    if (term.length < MIN_CHARS) return;
    let cancelled = false;
    (async () => {
      try {
        const result = await social<{ users: UserListItem[] }>(`/search${query({ q: term })}`);
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
  }, [term, attempt]);

  const searching = term.length >= MIN_CHARS;
  const retry = () => {
    setError(null);
    setAttempt((n) => n + 1);
  };

  return (
    <SocialPage title="Discover">
      <Input
        label="Search members"
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Search by username or name"
        autoComplete="off"
        hint={`Type at least ${MIN_CHARS} characters.`}
      />
      {error && <GateNotice error={error} onResolved={retry} onRetry={retry} />}
      {!error && searching && users === null && <LoadingRows count={2} label="Searching" />}
      {!error && searching && users !== null && users.length === 0 && <EmptyState title="No members found" body={`Nobody matches “${term}”. Check the spelling or try part of their name.`} />}
      {!error && searching && users !== null && (
        <ul className="flex flex-col gap-2">
          {users.map((user) => (
            <UserRow key={user.username} user={user} onFollowChange={(following) => setUsers((list) => list?.map((u) => (u.username === user.username ? { ...u, isFollowing: following } : u)) ?? null)} />
          ))}
        </ul>
      )}
    </SocialPage>
  );
}
