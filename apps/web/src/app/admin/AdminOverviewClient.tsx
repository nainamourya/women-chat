"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { Alert } from "@/components/ui/Alert";

type OverviewStats = {
  totalUsers: number;
  activeUsers: number;
  suspendedUsers: number;
  bannedUsers: number;
  totalMatches: number;
  totalMessages: number;
  pendingReports: number;
  totalConversationMinutes: number;
  avgConversationMinutesPerUser: number;
};

function StatCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold text-foreground">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </Card>
  );
}

export function AdminOverviewClient() {
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/admin/stats", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "Something went wrong.");
          return;
        }
        setStats(data.stats);
      } catch {
        setError("Something went wrong. Please try again.");
      }
    }
    load();
  }, []);

  if (error) return <Alert variant="danger">{error}</Alert>;
  if (!stats) return <p className="text-sm text-muted">Loading overview…</p>;

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      <StatCard label="Total users" value={stats.totalUsers} />
      <StatCard label="Active" value={stats.activeUsers} />
      <StatCard label="Suspended" value={stats.suspendedUsers} />
      <StatCard label="Blocked" value={stats.bannedUsers} />
      <StatCard label="Pending reports" value={stats.pendingReports} />
      <StatCard label="Total matches" value={stats.totalMatches} />
      <StatCard label="Messages sent" value={stats.totalMessages} />
      <StatCard
        label="Time in conversation"
        value={`${stats.totalConversationMinutes} min`}
        hint="Summed across all users"
      />
      <StatCard
        label="Avg. per user"
        value={`${stats.avgConversationMinutesPerUser} min`}
        hint="Conversation time, per user"
      />
    </div>
  );
}
