"use client";

import { useState } from "react";
import { AdminOverviewClient } from "./AdminOverviewClient";
import { AdminUsersClient } from "./users/AdminUsersClient";
import { AdminReportsClient } from "./reports/AdminReportsClient";

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "users", label: "Users" },
  { key: "reports", label: "Reports" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export function AdminDashboardClient() {
  const [tab, setTab] = useState<TabKey>("overview");

  return (
    <div className="flex flex-col gap-6">
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors ${
              tab === t.key
                ? "border-b-2 border-brand text-foreground"
                : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && <AdminOverviewClient />}
      {tab === "users" && <AdminUsersClient />}
      {tab === "reports" && <AdminReportsClient />}
    </div>
  );
}
