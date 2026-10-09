"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

type AccountStatus = "active" | "suspended" | "banned";

type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  role: "user" | "admin";
  accountStatus: AccountStatus;
  suspendedUntil: string | null;
  createdAt: string;
  timeSpentMinutes: number;
};

const SUSPEND_PRESETS = [
  { label: "1 day", days: 1 },
  { label: "3 days", days: 3 },
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "Indefinite", days: null },
];

function accountBadgeVariant(status: AccountStatus): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "suspended") return "warning";
  return "danger";
}

export function AdminUsersClient() {
  const { data: session } = useSession();
  const [search, setSearch] = useState("");
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionPendingId, setActionPendingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [suspendDays, setSuspendDays] = useState<Record<string, number | null>>({});
  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");

  async function load(query: string) {
    setLoading(true);
    setLoadError(null);
    try {
      const qs = query ? `?search=${encodeURIComponent(query)}` : "";
      const res = await fetch(`/api/admin/users${qs}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) {
        setLoadError(data.error ?? "Something went wrong.");
        setUsers([]);
      } else {
        setUsers(data.users ?? []);
      }
    } catch {
      setLoadError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load("");
  }, []);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    load(search);
  }

  async function takeAction(
    userId: string,
    action: "suspend" | "unsuspend" | "ban" | "unban",
    suspendUntil?: string | null,
  ) {
    setActionPendingId(userId);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, suspendUntil: suspendUntil ?? null }),
      });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Something went wrong.");
        return;
      }
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, ...data.user } : u)));
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setActionPendingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setActionPendingId(deleteTarget.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/admin/users/${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) {
        setActionError(data.error ?? "Something went wrong.");
        return;
      }
      setUsers((prev) => prev.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
      setDeleteConfirmText("");
    } catch {
      setActionError("Something went wrong. Please try again.");
    } finally {
      setActionPendingId(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <form onSubmit={handleSearchSubmit} className="flex items-end gap-2">
        <div className="flex-1">
          <Input
            label="Search"
            placeholder="Search by email or name…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {actionError && <Alert variant="danger">{actionError}</Alert>}
      {loadError && <Alert variant="danger">{loadError}</Alert>}
      {loading && <p className="text-sm text-muted">Loading users…</p>}
      {!loading && !loadError && users.length === 0 && (
        <p className="text-sm text-muted">No users found.</p>
      )}

      <div className="flex flex-col gap-3">
        {users.map((u) => {
          const isSelf = session?.user?.id === u.id;
          const pending = actionPendingId === u.id;
          const days = suspendDays[u.id] ?? 7;

          return (
            <Card key={u.id} className="flex flex-col gap-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{u.displayName}</p>
                  <p className="text-xs text-muted">{u.email}</p>
                  <p className="text-xs text-muted">{u.timeSpentMinutes} min in conversation</p>
                </div>
                <div className="flex items-center gap-2">
                  {u.role === "admin" && <Badge variant="info">admin</Badge>}
                  <Badge variant={accountBadgeVariant(u.accountStatus)}>
                    {u.accountStatus}
                    {u.accountStatus === "suspended" && u.suspendedUntil
                      ? ` until ${new Date(u.suspendedUntil).toLocaleDateString()}`
                      : ""}
                  </Badge>
                </div>
              </div>

              {isSelf ? (
                <p className="text-xs text-muted">This is your own account — actions are disabled here.</p>
              ) : (
                <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
                  {u.accountStatus === "suspended" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => takeAction(u.id, "unsuspend")}
                    >
                      Unsuspend
                    </Button>
                  ) : (
                    <>
                      <select
                        value={days ?? "indefinite"}
                        onChange={(e) =>
                          setSuspendDays((prev) => ({
                            ...prev,
                            [u.id]: e.target.value === "indefinite" ? null : Number(e.target.value),
                          }))
                        }
                        disabled={u.accountStatus === "banned"}
                        className="rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-foreground disabled:opacity-60"
                      >
                        {SUSPEND_PRESETS.map((p) => (
                          <option key={p.label} value={p.days ?? "indefinite"}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <Button
                        type="button"
                        variant="danger"
                        size="sm"
                        disabled={pending || u.accountStatus === "banned"}
                        onClick={() =>
                          takeAction(
                            u.id,
                            "suspend",
                            days !== null ? new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString() : null,
                          )
                        }
                      >
                        Suspend
                      </Button>
                    </>
                  )}

                  {u.accountStatus === "banned" ? (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={pending}
                      onClick={() => takeAction(u.id, "unban")}
                    >
                      Unblock
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="danger"
                      size="sm"
                      disabled={pending}
                      onClick={() => takeAction(u.id, "ban")}
                    >
                      Block
                    </Button>
                  )}

                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={pending}
                    onClick={() => {
                      setDeleteTarget(u);
                      setDeleteConfirmText("");
                    }}
                  >
                    Delete account
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Delete this account?"
        subtitle={`This permanently deletes ${deleteTarget?.displayName ?? ""} (${deleteTarget?.email ?? ""}) and all their matches, messages, and reports. This cannot be undone.`}
      >
        <Input
          label={`Type DELETE to confirm`}
          value={deleteConfirmText}
          onChange={(e) => setDeleteConfirmText(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => setDeleteTarget(null)}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={deleteConfirmText !== "DELETE" || actionPendingId === deleteTarget?.id}
            onClick={handleDelete}
          >
            Delete permanently
          </Button>
        </div>
      </Modal>
    </div>
  );
}
