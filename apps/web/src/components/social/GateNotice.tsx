"use client";

import Link from "next/link";
import { useState } from "react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Input } from "@/components/ui/Input";
import { ApiError, errorMessage, social } from "@/lib/social/api";

// What to show when the social API refuses a member for a reason they can fix:
// not verified yet, or no username chosen yet. Anything else is an ordinary,
// retryable error.
export function GateNotice({ error, onResolved, onRetry }: { error: ApiError; onResolved?: () => void; onRetry?: () => void }) {
  if (error.code === "not_eligible") {
    return (
      <Card className="flex flex-col items-start gap-3">
        <h2 className="text-base font-semibold text-foreground">Finish verification to join in</h2>
        <p className="text-sm text-muted">
          GiiGirl&apos;s community is open to members whose eligibility has been reviewed. {error.message}
        </p>
        <Link href="/eligibility" className="rounded-md bg-brand px-4 py-2.5 text-sm font-medium text-brand-foreground shadow-md hover:bg-brand-hover">
          Go to eligibility
        </Link>
      </Card>
    );
  }
  if (error.code === "username_required") {
    return <UsernameSetup onDone={onResolved ?? (() => window.location.reload())} />;
  }
  return (
    <div className="flex flex-col items-start gap-3">
      <Alert variant="danger">{error.message}</Alert>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function UsernameSetup({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await social("/me/profile", { method: "PUT", body: { username } });
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold text-foreground">Choose your username</h2>
        <p className="text-sm text-muted">This is how other members find and mention you. You can change it later.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Input
          label="Username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          maxLength={30}
          placeholder="e.g. priya_sketches"
          hint="3–30 characters: letters, numbers, underscores and periods."
          required
        />
        {error && <Alert variant="danger">{error}</Alert>}
        <Button type="submit" loading={busy} disabled={username.trim().length < 3}>
          Save username
        </Button>
      </form>
    </Card>
  );
}
