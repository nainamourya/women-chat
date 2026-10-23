"use client";

import { signOut } from "next-auth/react";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

const CONFIRMATION = "DELETE";

// Self-service account deletion. The member must type DELETE and (if the
// account has a password) enter it; the server checks both. Success is only
// reported after the server has confirmed the deletion, and then the session
// is ended.
export function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setOpen(false);
    setConfirmation("");
    setPassword("");
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation, password: password || undefined }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? (res.status === 429 ? "Too many attempts. Please wait and try again." : "Something went wrong. Please try again."));
        setBusy(false);
        return;
      }
      await signOut({ callbackUrl: "/?account=deleted" });
    } catch {
      setError("Couldn't reach GiiGirl. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="delete-account-heading" className="mt-6 flex flex-col gap-2 border-t border-border pt-5">
      <h3 id="delete-account-heading" className="text-sm font-semibold text-foreground">
        Delete account
      </h3>
      <p className="text-sm text-muted">
        Permanently delete your GiiGirl account. Your profile, photos, posts, comments, likes, follows and verification details are removed. Messages you sent stay in other
        people&apos;s conversations, with their text replaced. This can&apos;t be undone.
      </p>
      <div>
        <Button type="button" variant="danger" size="sm" onClick={() => setOpen(true)}>
          Delete my account…
        </Button>
      </div>

      <Modal open={open} onClose={close} title="Delete your account?" subtitle="This is permanent. You'll be signed out straight away.">
        <form onSubmit={submit} className="flex flex-col gap-3">
          <Input
            label={`Type ${CONFIRMATION} to confirm`}
            value={confirmation}
            onChange={(e) => setConfirmation(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            required
          />
          <Input
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            hint="Leave blank if you signed in with Google."
          />
          {error && <Alert variant="danger">{error}</Alert>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={close} disabled={busy}>
              Keep my account
            </Button>
            <Button type="submit" variant="danger" className="flex-1" loading={busy} disabled={confirmation !== CONFIRMATION}>
              Delete forever
            </Button>
          </div>
        </form>
      </Modal>
    </section>
  );
}
