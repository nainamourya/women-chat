"use client";

import { useState } from "react";

export type Interest = {
  id: string;
  name: string;
};

const MAX_INTERESTS = 15;
const MAX_BIO_LENGTH = 500;

export function ProfileClient({
  initialBio,
  initialSelectedIds,
  catalog,
}: {
  initialBio: string;
  initialSelectedIds: string[];
  catalog: Interest[];
}) {
  const [bio, setBio] = useState(initialBio);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedIds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function toggleInterest(id: string) {
    setSaved(false);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < MAX_INTERESTS) {
        next.add(id);
      }
      return next;
    });
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      const [profileRes, interestsRes] = await Promise.all([
        fetch("/api/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ bio: bio.trim() === "" ? null : bio }),
        }),
        fetch("/api/profile/interests", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ interestIds: [...selectedIds] }),
        }),
      ]);

      if (!profileRes.ok || !interestsRes.ok) {
        const failed = !profileRes.ok ? await profileRes.json() : await interestsRes.json();
        setError(
          typeof failed.error === "string"
            ? failed.error
            : "Please check your details and try again.",
        );
        return;
      }

      setSaved(true);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <label className="flex flex-col gap-1 text-sm">
        About you
        <textarea
          value={bio}
          maxLength={MAX_BIO_LENGTH}
          onChange={(e) => {
            setSaved(false);
            setBio(e.target.value);
          }}
          rows={4}
          placeholder="Share a little about yourself…"
          className="resize-none rounded-md border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />
        <span className="text-xs text-zinc-500">
          {bio.length}/{MAX_BIO_LENGTH}
        </span>
      </label>

      <div className="flex flex-col gap-2 text-sm">
        <span className="font-medium">
          Interests ({selectedIds.size}/{MAX_INTERESTS})
        </span>
        <div className="flex flex-wrap gap-2">
          {catalog.map((interest) => {
            const isSelected = selectedIds.has(interest.id);
            return (
              <button
                key={interest.id}
                type="button"
                onClick={() => toggleInterest(interest.id)}
                aria-pressed={isSelected}
                className={
                  isSelected
                    ? "rounded-full bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white dark:bg-white dark:text-zinc-900"
                    : "rounded-full border border-zinc-300 px-3 py-1.5 text-xs font-medium text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                }
              >
                {interest.name}
              </button>
            );
          })}
        </div>
      </div>

      {error && (
        <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      {saved && !error && (
        <p className="rounded-md bg-green-50 px-3 py-2 text-sm text-green-700 dark:bg-green-950 dark:text-green-300">
          Profile saved.
        </p>
      )}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="self-start rounded-md bg-zinc-900 px-4 py-2.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-white dark:text-zinc-900"
      >
        {saving ? "Saving…" : "Save profile"}
      </button>
    </div>
  );
}
