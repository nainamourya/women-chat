"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { motion } from "framer-motion";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Alert } from "@/components/ui/Alert";

export function ConfirmAgeClient() {
  const router = useRouter();
  const { update } = useSession();
  const [checked, setChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleContinue() {
    if (!checked) {
      setError("Please confirm the statement below to continue.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/confirm-age", { method: "POST" });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      await update({ ageConfirmed18: true });
      router.push("/eligibility");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.1, ease: "easeOut" }}
    >
      <Card className="flex flex-col gap-4 p-6">
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked);
              setError(null);
            }}
            className="mt-1 accent-[var(--brand)]"
          />
          <span>I confirm that I am 18 years of age or older and identify as a woman.</span>
        </label>

        {error && <Alert variant="danger">{error}</Alert>}

        <Button type="button" onClick={handleContinue} disabled={submitting} className="mt-1 w-full">
          {submitting ? "Continuing…" : "Continue"}
        </Button>
      </Card>
    </motion.div>
  );
}
