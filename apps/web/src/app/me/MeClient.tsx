"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { GateNotice } from "@/components/social/GateNotice";
import { LoadingRows, SocialPage } from "@/components/social/StateViews";
import { ApiError, errorMessage, social, type OwnProfile } from "@/lib/social/api";

// "My profile": goes to the member's own profile page, or — if they haven't
// chosen a username yet — asks for one first.
export function MeClient() {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const [needsUsername, setNeedsUsername] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { profile } = await social<{ profile: OwnProfile }>("/me");
        if (cancelled) return;
        if (profile.hasUsername) router.replace(`/u/${encodeURIComponent(profile.username)}`);
        else setNeedsUsername(true);
      } catch (err) {
        if (!cancelled) setError(err instanceof ApiError ? err : new ApiError(errorMessage(err), 0));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, attempt]);

  const retry = () => {
    setError(null);
    setNeedsUsername(false);
    setAttempt((n) => n + 1);
  };

  return (
    <SocialPage title="My profile">
      {error && <GateNotice error={error} onResolved={retry} onRetry={retry} />}
      {needsUsername && <GateNotice error={new ApiError("Choose a username to use this feature.", 403, "username_required")} onResolved={retry} />}
      {!error && !needsUsername && <LoadingRows count={1} label="Loading your profile" />}
    </SocialPage>
  );
}
