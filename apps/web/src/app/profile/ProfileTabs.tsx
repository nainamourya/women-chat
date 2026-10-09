"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import { Avatar } from "@/components/ui/Avatar";
import { Badge } from "@/components/ui/Badge";
import { ProfileClient, type Interest } from "./ProfileClient";
import { SettingsPanel } from "./SettingsPanel";
import type { AccountStatus, VerificationStatus } from "@/types/next-auth";

type Tab = "profile" | "settings";

const TABS: { value: Tab; label: string }[] = [
  { value: "profile", label: "Profile" },
  { value: "settings", label: "Settings" },
];

export function ProfileTabs({
  initialDisplayName,
  initialBio,
  initialSelectedIds,
  initialProfileComplete,
  catalog,
  email,
  verificationStatus,
  accountStatus,
  suspendedUntil,
  ageConfirmed18,
  createdAt,
}: {
  initialDisplayName: string;
  initialBio: string;
  initialSelectedIds: string[];
  initialProfileComplete: boolean;
  catalog: Interest[];
  email: string;
  verificationStatus: VerificationStatus;
  accountStatus: AccountStatus;
  suspendedUntil: string | null;
  ageConfirmed18: boolean;
  createdAt: string | null;
}) {
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<Tab>(searchParams.get("tab") === "settings" ? "settings" : "profile");
  const [displayName, setDisplayName] = useState(initialDisplayName);

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: "easeOut" }}
      className="flex flex-col gap-6"
    >
      <div className="flex items-center gap-4">
        <Avatar name={displayName || "?"} size="lg" />
        <div className="flex flex-col gap-1.5">
          <span className="text-lg font-semibold text-foreground">{displayName || "Your profile"}</span>
          {accountStatus !== "active" && (
            <Badge variant={accountStatus === "banned" ? "danger" : "warning"}>
              {accountStatus === "banned" ? "Banned" : "Suspended"}
            </Badge>
          )}
        </div>
      </div>

      <div className="flex gap-1.5 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            className={`px-3 py-2 text-sm font-medium transition-colors ${
              tab === t.value ? "border-b-2 border-brand text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "profile" ? (
        <ProfileClient
          initialDisplayName={initialDisplayName}
          initialBio={initialBio}
          initialSelectedIds={initialSelectedIds}
          initialProfileComplete={initialProfileComplete}
          catalog={catalog}
          onDisplayNameSaved={setDisplayName}
        />
      ) : (
        <SettingsPanel
          email={email}
          verificationStatus={verificationStatus}
          accountStatus={accountStatus}
          suspendedUntil={suspendedUntil}
          ageConfirmed18={ageConfirmed18}
          createdAt={createdAt}
        />
      )}
    </motion.div>
  );
}
