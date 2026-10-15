"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";

type SubmissionStatus = "pending_review" | "approved" | "rejected" | "resubmission_required";

type AdminSubmission = {
  id: string;
  userId: string;
  status: SubmissionStatus;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  videoDeletionPending: boolean;
};

const TABS: { value: SubmissionStatus; label: string }[] = [
  { value: "pending_review", label: "Pending review" },
  { value: "approved", label: "Approved" },
  { value: "rejected", label: "Rejected" },
  { value: "resubmission_required", label: "Resubmission requested" },
];

const REJECTION_REASONS: { value: string; label: string }[] = [
  { value: "video_unclear_or_incomplete", label: "Video unclear or incomplete" },
  { value: "duration_or_format_invalid", label: "Duration or format invalid" },
  { value: "does_not_meet_guidelines", label: "Does not meet guidelines" },
  { value: "other", label: "Other" },
];

function statusBadgeVariant(status: SubmissionStatus): "warning" | "success" | "danger" {
  if (status === "approved") return "success";
  if (status === "rejected") return "danger";
  return "warning";
}

export function AdminVerificationClient() {
  const [tab, setTab] = useState<SubmissionStatus>("pending_review");
  const [submissions, setSubmissions] = useState<AdminSubmission[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState(REJECTION_REASONS[0].value);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/verification?status=${tab}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error ?? "Something went wrong.");
        setSubmissions([]);
      } else {
        setSubmissions(data.submissions ?? []);
      }
    } catch {
      setLoadError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    setSelectedId(null);
    setActionError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const selected = submissions.find((s) => s.id === selectedId) ?? null;

  async function takeDecision(decision: SubmissionStatus, reason?: string) {
    if (!selected) return;
    setActionPending(true);
    setActionError(null);

    try {
      const res = await fetch(`/api/admin/verification/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, rejectionReason: reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Something went wrong.");
        setActionPending(false);
        return;
      }
      setSelectedId(null);
      setActionPending(false);
      await load();
    } catch {
      setActionError("Something went wrong. Please try again.");
      setActionPending(false);
    }
  }

  async function retryDeletion(id: string) {
    setActionPending(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/verification/${id}/retry-deletion`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Something went wrong.");
        setActionPending(false);
        return;
      }
      setActionPending(false);
      await load();
    } catch {
      setActionError("Something went wrong. Please try again.");
      setActionPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-1.5 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.value
                ? "border-b-2 border-brand text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {loadError && <Alert variant="danger">{loadError}</Alert>}
      {loading && <p className="text-sm text-muted">Loading submissions…</p>}
      {!loading && !loadError && submissions.length === 0 && (
        <p className="text-sm text-muted">No submissions in this category.</p>
      )}

      <div className="flex flex-col gap-3">
        {submissions.map((s) => {
          const isOpen = selectedId === s.id;
          return (
            <Card key={s.id} className="flex flex-col gap-3 p-4">
              <button
                type="button"
                className="flex w-full flex-col gap-2 text-left"
                onClick={() => {
                  setSelectedId(isOpen ? null : s.id);
                  setActionError(null);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">Submission {s.id.slice(0, 8)}</span>
                  <Badge variant={statusBadgeVariant(s.status)}>{s.status.replace(/_/g, " ")}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span>{new Date(s.createdAt).toLocaleString()}</span>
                  {s.videoDeletionPending && <Badge variant="danger">deletion pending</Badge>}
                </div>
              </button>

              {isOpen && (
                <div className="flex flex-col gap-3 border-t border-border pt-3">
                  {s.status === "pending_review" ? (
                    <video
                      src={`/api/admin/verification/${s.id}/video`}
                      controls
                      className="max-h-80 w-fit rounded-md border border-border"
                    />
                  ) : (
                    <p className="text-xs text-muted">The video has already been deleted after review.</p>
                  )}

                  {actionError && <Alert variant="danger">{actionError}</Alert>}

                  {s.videoDeletionPending && (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => retryDeletion(s.id)}
                    >
                      Retry video deletion
                    </Button>
                  )}

                  {s.status === "pending_review" && !s.videoDeletionPending && (
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        disabled={actionPending}
                        onClick={() => takeDecision("approved")}
                      >
                        Approve
                      </Button>
                      <select
                        value={rejectionReason}
                        onChange={(e) => setRejectionReason(e.target.value)}
                        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                      >
                        {REJECTION_REASONS.map((r) => (
                          <option key={r.value} value={r.value}>
                            {r.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={actionPending}
                        onClick={() => takeDecision("resubmission_required", rejectionReason)}
                      >
                        Request resubmission
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={actionPending}
                        onClick={() => takeDecision("rejected", rejectionReason)}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
