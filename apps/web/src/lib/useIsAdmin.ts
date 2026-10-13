"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { isAllowedAdminEmail } from "@/lib/admin";

// Session role is a JWT claim set at sign-in — it goes stale the moment an
// admin promotes/demotes this user without them re-authenticating (see the
// /profile Settings panel fix for the same root cause). /api/profile already
// reads the role live from the database, so reuse it here instead of trusting
// the session for this one gate, falling back to the session value only
// while the live check is still in flight.
export function useIsAdmin(): boolean {
  const { data: session } = useSession();
  const [liveRole, setLiveRole] = useState<"user" | "admin" | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data?.profile?.role) {
          setLiveRole(data.profile.role);
        }
      })
      .catch(() => {
        // Best-effort refresh only — fall back to the session value below.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const role = liveRole ?? session?.user?.role;
  return role === "admin" && isAllowedAdminEmail(session?.user?.email);
}
