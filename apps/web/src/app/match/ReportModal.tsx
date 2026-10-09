"use client";

import { useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Alert } from "@/components/ui/Alert";

const MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;
const ALLOWED_EVIDENCE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const REASONS: { value: string; label: string }[] = [
  { value: "harassment", label: "Harassment or bullying" },
  { value: "sexual_inappropriate", label: "Sexual or inappropriate behavior" },
  { value: "not_eligible", label: "I believe this person is not eligible for GiGirl" },
  { value: "fake_profile", label: "Fake/misleading profile" },
  { value: "spam_scam", label: "Spam/scam" },
  { value: "threatening_unsafe", label: "Threatening or unsafe behavior" },
  { value: "other", label: "Other" },
];

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the "data:<mime>;base64," prefix — only the raw payload is sent.
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ReportModal({
  open,
  onClose,
  reportedUserId,
  matchId,
}: {
  open: boolean;
  onClose: () => void;
  reportedUserId: string;
  matchId: string;
}) {
  const [reason, setReason] = useState<string>("");
  const [description, setDescription] = useState("");
  const [evidenceFile, setEvidenceFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function resetAndClose() {
    setReason("");
    setDescription("");
    setEvidenceFile(null);
    setFileError(null);
    setSubmitError(null);
    setSubmitting(false);
    setSubmitted(false);
    onClose();
  }

  function handleFileChange(file: File | null) {
    setFileError(null);
    if (!file) {
      setEvidenceFile(null);
      return;
    }
    if (!ALLOWED_EVIDENCE_TYPES.includes(file.type)) {
      setFileError("Evidence must be a JPG, PNG, or WEBP image.");
      setEvidenceFile(null);
      return;
    }
    if (file.size > MAX_EVIDENCE_BYTES) {
      setFileError("Evidence must be under 5MB.");
      setEvidenceFile(null);
      return;
    }
    setEvidenceFile(file);
  }

  async function handleSubmit() {
    if (!reason) {
      setSubmitError("Please choose a reason.");
      return;
    }

    setSubmitting(true);
    setSubmitError(null);

    try {
      let evidenceBase64: string | null = null;
      let evidenceMimeType: string | null = null;
      if (evidenceFile) {
        evidenceBase64 = await readFileAsBase64(evidenceFile);
        evidenceMimeType = evidenceFile.type;
      }

      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportedUserId,
          matchId,
          reason,
          description: description.trim() || null,
          evidenceBase64,
          evidenceMimeType,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setSubmitError(data.error ?? "Something went wrong.");
        setSubmitting(false);
        return;
      }

      setSubmitted(true);
      setSubmitting(false);
    } catch {
      setSubmitError("Something went wrong. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={resetAndClose} title="Report this user" subtitle="Help us keep GiGirl safe.">
      {submitted ? (
        <div className="flex flex-col gap-4">
          <Alert variant="success">Thanks for helping keep GiGirl safe. We&apos;ll review this report.</Alert>
          <Button type="button" variant="secondary" onClick={resetAndClose}>
            Close
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium text-foreground">Reason</legend>
            {REASONS.map((r) => (
              <label
                key={r.value}
                className="flex items-center gap-2.5 rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-hover"
              >
                <input
                  type="radio"
                  name="report-reason"
                  value={r.value}
                  checked={reason === r.value}
                  onChange={() => setReason(r.value)}
                  className="h-4 w-4 accent-brand"
                />
                {r.label}
              </label>
            ))}
          </fieldset>

          <Textarea
            label="Description (optional)"
            placeholder="Add any extra context that could help our review…"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 1000))}
            rows={3}
            maxLength={1000}
          />

          <div className="flex flex-col gap-1.5">
            <label className="text-sm font-medium text-foreground">Screenshot / evidence (optional)</label>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              className="text-sm text-muted"
            />
            {fileError && <span className="text-xs text-danger">{fileError}</span>}
            {evidenceFile && !fileError && (
              <span className="text-xs text-muted">Selected: {evidenceFile.name}</span>
            )}
          </div>

          {submitError && <Alert variant="danger">{submitError}</Alert>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={resetAndClose} disabled={submitting}>
              Cancel
            </Button>
            <Button type="button" variant="danger" onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Report"}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
