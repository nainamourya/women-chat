"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { FollowButton } from "./FollowButton";
import { MemberAvatar } from "./MemberAvatar";
import type { UserListItem } from "@/lib/social/api";

// A member in a list: photo, names, and (for everyone but yourself) a follow button.
export function UserRow({ user, onFollowChange, trailing }: { user: UserListItem; onFollowChange?: (following: boolean) => void; trailing?: ReactNode }) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <Link href={`/u/${encodeURIComponent(user.username)}`} className="flex min-w-0 flex-1 items-center gap-3">
        <MemberAvatar user={user} size="md" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-foreground">{user.username}</span>
          <span className="block truncate text-xs text-muted">{user.displayName}</span>
        </span>
      </Link>
      {trailing}
      {!user.isSelf && onFollowChange && (
        <FollowButton username={user.username} isFollowing={user.isFollowing} size="sm" onChange={(following) => onFollowChange(following)} />
      )}
    </li>
  );
}
