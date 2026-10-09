"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Alert } from "@/components/ui/Alert";

type VerificationStatus = "unverified" | "pending" | "verified" | "rejected";

const statusCopy: Record<VerificationStatus, string> = {
  unverified: "Not started",
  pending: "Pending (prototype)",
  verified: "Passed (prototype)",
  rejected: "Rejected (prototype)",
};

const statusBadgeVariant: Record<VerificationStatus, "neutral" | "warning" | "success" | "danger"> = {
  unverified: "neutral",
  pending: "warning",
  verified: "success",
  rejected: "danger",
};

export function EligibilityClient({
  initialStatus,
}: {
  initialStatus: VerificationStatus;
}) {
  const { update } = useSession();
  const [status, setStatus] = useState<VerificationStatus>(initialStatus);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSimulate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/verification/simulate", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setStatus(data.user.verificationStatus);
      await update({ verificationStatus: data.user.verificationStatus });
    } finally {
      setLoading(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
    >
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-foreground">Current status</span>
          <Badge variant={statusBadgeVariant[status]}>{statusCopy[status]}</Badge>
        </div>

        {status !== "verified" && (
          <Button onClick={handleSimulate} disabled={loading} className="w-full">
            {loading ? "Running prototype check…" : "Run prototype eligibility check"}
          </Button>
        )}

        {error && <Alert variant="danger">{error}</Alert>}
      </Card>
    </motion.div>
  );
}
