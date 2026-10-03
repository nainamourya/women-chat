"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";

export function ConfirmAgeClient() {
  const router = useRouter();
  const { update } = useSession();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (!checked) {
      setError("Please confirm the statement below to continue.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/confirm-age", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      await update({ ageConfirmed18: true });
      router.push("/eligibility");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => setChecked(e.target.checked)}
          className="mt-1"
        />
        <span>
          I confirm that I am 18 years of age or older and identify as a
          woman.
        </span>
      </label>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={handleContinue}
        disabled={submitting}
        className="mt-2 self-start rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
      >
        {submitting ? "Continuing…" : "Continue"}
      </button>
    </div>
  );
}
