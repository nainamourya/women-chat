"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";

type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

const statusCopy: Record<VerificationStatus, string> = {
  unverified: "Not started",
  pending: "Pending (prototype)",
  verified: "Passed (prototype)",
  rejected: "Rejected (prototype)",
};

export function EligibilityClient({
  initialStatus,
}: {
  initialStatus: VerificationStatus;
}) {
  const { update } = useSession();
  const [status, setStatus] = useState<VerificationStatus>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSimulate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/verification/simulate", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setStatus(data.user.verificationStatus);
      await update({ verificationStatus: data.user.verificationStatus });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-md border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-800">
        <span className="font-medium">Current status: </span>
        {statusCopy[status]}
      </div>

      {status !== "verified" && (
        <button
          onClick={handleSimulate}
          disabled={loading}
          className="self-start rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
        >
          {loading ? "Running prototype check…" : "Run prototype eligibility check"}
        </button>
      )}

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
