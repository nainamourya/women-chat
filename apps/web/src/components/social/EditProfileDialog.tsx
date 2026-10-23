"use client";

import { useRef, useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { errorMessage, social, type OwnProfile, type ProfileView } from "@/lib/social/api";
import { ImageError, prepareImage } from "@/lib/social/prepareImage";
import { MemberAvatar } from "./MemberAvatar";

// Edits the signed-in member's own profile. There is no "which user" input
// anywhere: the server only ever updates the caller.
export function EditProfileDialog({
  open,
  onClose,
  profile,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  profile: ProfileView;
  onSaved: (profile: OwnProfile) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [username, setUsername] = useState(profile.username);
  const [displayName, setDisplayName] = useState(profile.displayName);
  const [bio, setBio] = useState(profile.bio);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<string | null>(profile.avatarUrl);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const result = await social<{ profile: OwnProfile }>("/me/profile", { method: "PUT", body: { username, displayName, bio } });
      onSaved(result.profile);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function choosePhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setPhotoBusy(true);
    setError(null);
    try {
      const prepared = await prepareImage(file, 640);
      URL.revokeObjectURL(prepared.previewUrl);
      const result = await social<{ profile: OwnProfile }>("/me/avatar", {
        method: "PUT",
        body: { imageBase64: prepared.imageBase64, mimeType: prepared.mimeType },
      });
      setAvatar(result.profile.avatarUrl);
      onSaved(result.profile);
    } catch (err) {
      setError(err instanceof ImageError ? err.message : errorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  async function removePhoto() {
    setPhotoBusy(true);
    setError(null);
    try {
      const result = await social<{ profile: OwnProfile }>("/me/avatar", { method: "DELETE" });
      setAvatar(null);
      onSaved(result.profile);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPhotoBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit profile">
      <form onSubmit={save} className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <MemberAvatar user={{ displayName, avatarUrl: avatar }} size="lg" />
          <div className="flex flex-col items-start gap-2">
            <input ref={fileInput} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose a profile photo" onChange={choosePhoto} />
            <Button type="button" size="sm" variant="outline" loading={photoBusy} onClick={() => fileInput.current?.click()}>
              {avatar ? "Change photo" : "Add photo"}
            </Button>
            {avatar && (
              <Button type="button" size="sm" variant="ghost" disabled={photoBusy} onClick={removePhoto}>
                Remove photo
              </Button>
            )}
          </div>
        </div>

        <Input label="Username" value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="off" maxLength={30} required hint="Letters, numbers, underscores and periods." />
        <Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={50} required />
        <Textarea label="Bio" value={bio} onChange={(e) => setBio(e.target.value)} maxLength={500} rows={3} hint={`${bio.length}/500`} />

        {error && <Alert variant="danger">{error}</Alert>}
        <div className="flex gap-2">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="flex-1" loading={saving}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
