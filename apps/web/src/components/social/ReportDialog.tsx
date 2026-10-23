"use client";

import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { errorMessage, social } from "@/lib/social/api";

const REASONS = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "sexual_inappropriate", label: "Sexual or inappropriate content" },
  { value: "threatening_unsafe", label: "Threatening or unsafe" },
  { value: "spam_scam", label: "Spam or scam" },
  { value: "fake_profile", label: "Fake profile" },
  { value: "not_eligible", label: "Doesn't seem eligible for GiiGirl" },
  { value: "other", label: "Something else" },
] as const;

// Reports a member or a post. Says "Reported" only after the server accepted it.
export function ReportDialog({
  open,
  onClose,
  path,
  title,
}: {
  open: boolean;
  onClose: () => void;
  // "/users/<username>/report" or "/posts/<id>/report"
  path: string;
  title: string;
}) {
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function close() {
    onClose();
    // Reset after the closing animation so the next report starts fresh.
    setTimeout(() => {
      setReason("");
      setDescription("");
      setError(null);
      setDone(false);
    }, 200);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await social(path, { method: "POST", body: { reason, description: description.trim() || null } });
      setDone(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={close} title={title} subtitle="Our team reviews every report. The person you report isn't told it was you.">
      {done ? (
        <div className="flex flex-col gap-3">
          <Alert variant="success">Thanks — your report was sent to our team.</Alert>
          <Button type="button" variant="outline" onClick={close}>
            Close
          </Button>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3">
          <fieldset className="flex flex-col gap-2">
            <legend className="sr-only">Reason</legend>
            {REASONS.map((r) => (
              <label key={r.value} className="flex items-center gap-2 text-sm text-foreground">
                <input type="radio" name="reason" value={r.value} checked={reason === r.value} onChange={() => setReason(r.value)} />
                {r.label}
              </label>
            ))}
          </fieldset>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-foreground">
            Details (optional)
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={3}
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm font-normal text-foreground focus-visible:outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
            />
          </label>
          {error && <Alert variant="danger">{error}</Alert>}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="flex-1" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" className="flex-1" loading={busy} disabled={!reason}>
              Send report
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
