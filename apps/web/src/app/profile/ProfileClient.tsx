"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";
import { Input, Textarea } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export type Interest = {
  id: string;
  name: string;
};

const MAX_INTERESTS = 15;
const MAX_BIO_LENGTH = 500;
const MAX_DISPLAY_NAME_LENGTH = 50;

export function ProfileClient({
  initialDisplayName,
  initialBio,
  initialSelectedIds,
  initialProfileComplete,
  catalog,
  onDisplayNameSaved,
}: {
  initialDisplayName: string;
  initialBio: string;
  initialSelectedIds: string[];
  initialProfileComplete: boolean;
  catalog: Interest[];
  onDisplayNameSaved?: (name: string) => void;
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName);
  const [bio, setBio] = useState(initialBio);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialSelectedIds));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [profileComplete, setProfileComplete] = useState(initialProfileComplete);
  const [editing, setEditing] = useState(!initialProfileComplete);

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
          body: JSON.stringify({
            ...(displayName.trim() === "" ? {} : { displayName: displayName.trim() }),
            bio: bio.trim() === "" ? null : bio,
          }),
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

      const profileData = await profileRes.json();
      const nowComplete = Boolean(profileData.profile?.profileComplete);
      setProfileComplete(nowComplete);
      setSaved(true);
      if (nowComplete) setEditing(false);
      onDisplayNameSaved?.(displayName.trim() || initialDisplayName);
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    const selectedInterests = catalog.filter((interest) => selectedIds.has(interest.id));

    return (
      <Card className="flex flex-col gap-6 p-6">
        {profileComplete && <Alert variant="success">Your profile is complete.</Alert>}

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">Display name</span>
          <p className="text-sm text-muted">{displayName || "Not added yet"}</p>
        </div>

        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-foreground">About you</span>
          <p className="whitespace-pre-wrap text-sm text-muted">{bio || "Not added yet"}</p>
        </div>

        <div className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-foreground">Interests</span>
          {selectedInterests.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {selectedInterests.map((interest) => (
                <span
                  key={interest.id}
                  className="rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground"
                >
                  {interest.name}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted">Not added yet</p>
          )}
        </div>

        <Button type="button" onClick={() => setEditing(true)} className="w-full">
          Edit profile
        </Button>
      </Card>
    );
  }

  return (
    <Card className="flex flex-col gap-6 p-6">
      {profileComplete && <Alert variant="success">Your profile is complete.</Alert>}

      <Input
        label="Display name"
        type="text"
        value={displayName}
        maxLength={MAX_DISPLAY_NAME_LENGTH}
        onChange={(e) => {
          setSaved(false);
          setDisplayName(e.target.value);
        }}
        placeholder="What should we call you?"
      />

      <Textarea
        label="About you"
        value={bio}
        maxLength={MAX_BIO_LENGTH}
        onChange={(e) => {
          setSaved(false);
          setBio(e.target.value);
        }}
        rows={4}
        placeholder="Share a little about yourself…"
        hint={`${bio.length}/${MAX_BIO_LENGTH}`}
      />

      <div className="flex flex-col gap-2 text-sm">
        <span className="font-medium text-foreground">
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
                    ? "rounded-full bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground"
                    : "rounded-full border border-border px-3 py-1.5 text-xs font-medium text-muted hover:bg-surface-hover"
                }
              >
                {interest.name}
              </button>
            );
          })}
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {saved && !error && <Alert variant="success">Profile saved.</Alert>}

      <div className="flex gap-3">
        {profileComplete && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setDisplayName(initialDisplayName);
              setBio(initialBio);
              setSelectedIds(new Set(initialSelectedIds));
              setError(null);
              setSaved(false);
              setEditing(false);
            }}
            className="w-full"
          >
            Cancel
          </Button>
        )}
        <Button type="button" onClick={handleSave} disabled={saving} className="w-full">
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </Card>
  );
}
