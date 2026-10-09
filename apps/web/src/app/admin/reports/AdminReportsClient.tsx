"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Textarea } from "@/components/ui/Input";

type ReportStatus = "pending" | "under_review" | "resolved" | "dismissed";

type AdminReport = {
  id: string;
  reporterUserId: string;
  reporterDisplayName: string;
  reportedUserId: string;
  reportedDisplayName: string;
  reportedAccountStatus: "active" | "suspended" | "banned";
  matchId: string | null;
  reason: string;
  description: string | null;
  evidencePath: string | null;
  evidenceMimeType: string | null;
  status: ReportStatus;
  adminAction: "none" | "warn" | "suspend" | "ban";
  adminNote: string | null;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
};

const TABS: { value: ReportStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "under_review", label: "Under review" },
  { value: "resolved", label: "Resolved" },
  { value: "dismissed", label: "Dismissed" },
];

const REASON_LABELS: Record<string, string> = {
  harassment: "Harassment or bullying",
  sexual_inappropriate: "Sexual or inappropriate behavior",
  not_eligible: "Not eligible for JinGirl",
  fake_profile: "Fake/misleading profile",
  spam_scam: "Spam/scam",
  threatening_unsafe: "Threatening or unsafe behavior",
  other: "Other",
};

const SUSPEND_PRESETS = [
  { label: "1 day", days: 1 },
  { label: "3 days", days: 3 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "Indefinite", days: null },
];

function statusBadgeVariant(status: ReportStatus): "warning" | "info" | "success" | "neutral" {
  if (status === "pending") return "warning";
  if (status === "under_review") return "info";
  if (status === "resolved") return "success";
  return "neutral";
}

function accountBadgeVariant(status: AdminReport["reportedAccountStatus"]): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "suspended") return "warning";
  return "danger";
}

export function AdminReportsClient() {
  const [tab, setTab] = useState<ReportStatus>("pending");
  const [reports, setReports] = useState<AdminReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adminNote, setAdminNote] = useState("");
  const [suspendDays, setSuspendDays] = useState<number | null>(7);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/admin/reports?status=${tab}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error ?? "Something went wrong.");
        setReports([]);
      } else {
        setReports(data.reports ?? []);
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
    setAdminNote("");
    setActionError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const selected = reports.find((r) => r.id === selectedId) ?? null;

  async function takeAction(status: ReportStatus, adminAction: "none" | "warn" | "suspend" | "ban") {
    if (!selected) return;
    setActionPending(true);
    setActionError(null);

    const suspendUntil =
      adminAction === "suspend" && suspendDays !== null
        ? new Date(Date.now() + suspendDays * 24 * 60 * 60 * 1000).toISOString()
        : null;

    try {
      const res = await fetch(`/api/admin/reports/${selected.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, adminAction, adminNote: adminNote.trim() || null, suspendUntil }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Something went wrong.");
        setActionPending(false);
        return;
      }
      setSelectedId(null);
      setAdminNote("");
      setActionPending(false);
      await load();
    } catch {
      setActionError("Something went wrong. Please try again.");
      setActionPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5 border-b border-border">
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
      {loading && <p className="text-sm text-muted">Loading reports…</p>}
      {!loading && !loadError && reports.length === 0 && (
        <p className="text-sm text-muted">No reports in this category.</p>
      )}

      <div className="flex flex-col gap-3">
        {reports.map((r) => {
          const isOpen = selectedId === r.id;
          return (
            <Card key={r.id} className="flex flex-col gap-3 p-4">
              <button
                type="button"
                className="flex w-full flex-col gap-2 text-left"
                onClick={() => {
                  setSelectedId(isOpen ? null : r.id);
                  setAdminNote(r.adminNote ?? "");
                  setActionError(null);
                }}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">
                    {REASON_LABELS[r.reason] ?? r.reason}
                  </span>
                  <Badge variant={statusBadgeVariant(r.status)}>{r.status.replace("_", " ")}</Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
                  <span>
                    Reported: <span className="text-foreground">{r.reportedDisplayName}</span>
                  </span>
                  <span>
                    Reporter: <span className="text-foreground">{r.reporterDisplayName}</span>
                  </span>
                  <span>{new Date(r.createdAt).toLocaleString()}</span>
                  <Badge variant={accountBadgeVariant(r.reportedAccountStatus)}>
                    account: {r.reportedAccountStatus}
                  </Badge>
                </div>
              </button>

              {isOpen && (
                <div className="flex flex-col gap-3 border-t border-border pt-3">
                  {r.description && <p className="text-sm text-foreground">{r.description}</p>}
                  {r.evidencePath && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/admin/reports/${r.id}/evidence`}
                      alt="Submitted evidence"
                      className="max-h-64 w-fit rounded-md border border-border object-contain"
                    />
                  )}
                  {r.adminNote && (
                    <p className="text-xs text-muted">Previous admin note: {r.adminNote}</p>
                  )}

                  <Textarea
                    label="Admin note (never shown to users)"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value.slice(0, 1000))}
                    rows={2}
                    maxLength={1000}
                  />

                  {actionError && <Alert variant="danger">{actionError}</Alert>}

                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      value={suspendDays ?? "indefinite"}
                      onChange={(e) =>
                        setSuspendDays(e.target.value === "indefinite" ? null : Number(e.target.value))
                      }
                      className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground"
                    >
                      {SUSPEND_PRESETS.map((p) => (
                        <option key={p.label} value={p.days ?? "indefinite"}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => takeAction("under_review", "none")}
                    >
                      Mark Under Review
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => takeAction("dismissed", "none")}
                    >
                      Dismiss
                    </Button>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => takeAction("resolved", "warn")}
                    >
                      Warn User
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => takeAction("resolved", "suspend")}
                    >
                      Suspend User
                    </Button>
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={actionPending}
                      onClick={() => takeAction("resolved", "ban")}
                    >
                      Permanently Ban User
                    </Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
