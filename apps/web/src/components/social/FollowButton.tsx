"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { errorMessage, social } from "@/lib/social/api";

// Follow / unfollow. Updates only after the server confirms, so the button
// never claims a follow that didn't happen; on failure it shows why.
export function FollowButton({
  username,
  isFollowing,
  followsYou = false,
  size = "md",
  onChange,
}: {
  username: string;
  isFollowing: boolean;
  followsYou?: boolean;
  size?: "sm" | "md";
  onChange: (following: boolean, followerCount: number) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      const result = await social<{ following: boolean; followerCount: number }>(`/users/${encodeURIComponent(username)}/follow`, {
        method: isFollowing ? "DELETE" : "POST",
      });
      onChange(result.following, result.followerCount);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <Button type="button" size={size} variant={isFollowing ? "outline" : "primary"} loading={busy} onClick={toggle}>
        {isFollowing ? "Following" : followsYou ? "Follow back" : "Follow"}
      </Button>
      {error && (
        <span role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
