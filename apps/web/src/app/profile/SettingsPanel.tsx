import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import type { AccountStatus, VerificationStatus } from "@/types/next-auth";

function verificationBadgeVariant(status: VerificationStatus): "success" | "warning" | "danger" | "neutral" {
  if (status === "verified") return "success";
  if (status === "pending") return "warning";
  if (status === "rejected") return "danger";
  return "neutral";
}

function verificationLabel(status: VerificationStatus): string {
  if (status === "verified") return "Verified";
  if (status === "pending") return "Pending review";
  if (status === "rejected") return "Rejected";
  return "Not verified";
}

function accountBadgeVariant(status: AccountStatus): "success" | "warning" | "danger" {
  if (status === "active") return "success";
  if (status === "suspended") return "warning";
  return "danger";
}

function accountLabel(status: AccountStatus, suspendedUntil: string | null): string {
  if (status === "active") return "Active";
  if (status === "banned") return "Permanently banned";
  if (!suspendedUntil) return "Suspended";
  return `Suspended until ${new Date(suspendedUntil).toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  })}`;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-foreground">{children}</span>
    </div>
  );
}

export function SettingsPanel({
  email,
  verificationStatus,
  accountStatus,
  suspendedUntil,
  ageConfirmed18,
  createdAt,
}: {
  email: string;
  verificationStatus: VerificationStatus;
  accountStatus: AccountStatus;
  suspendedUntil: string | null;
  ageConfirmed18: boolean;
  createdAt: string | null;
}) {
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })
    : "—";

  return (
    <Card className="flex flex-col p-6">
      <div className="flex flex-col divide-y divide-border">
        <Row label="Email">{email}</Row>
        <Row label="Eligibility verification">
          <Badge variant={verificationBadgeVariant(verificationStatus)}>
            {verificationLabel(verificationStatus)}
          </Badge>
        </Row>
        <Row label="Account standing">
          <Badge variant={accountBadgeVariant(accountStatus)}>
            {accountLabel(accountStatus, suspendedUntil)}
          </Badge>
        </Row>
        <Row label="Age confirmation">
          <Badge variant={ageConfirmed18 ? "success" : "neutral"}>
            {ageConfirmed18 ? "Confirmed 18+" : "Not confirmed"}
          </Badge>
        </Row>
        <Row label="Member since">{memberSince}</Row>
      </div>

      {verificationStatus !== "verified" && (
        <p className="mt-4 text-sm text-muted">
          <Link href="/eligibility" className="font-medium text-brand hover:text-brand-hover">
            Complete your eligibility check
          </Link>{" "}
          to get verified.
        </p>
      )}
    </Card>
  );
}
