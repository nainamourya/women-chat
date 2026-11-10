"use client";

import { useEffect, useState } from "react";
import { disablePush, enablePush, getPushStatus, type PushStatus } from "@/lib/push";

// "Turn on notifications" card. Permission is only ever requested from a tap,
// never on page load.
export function PushToggle() {
  const [status, setStatus] = useState<PushStatus | "loading">("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getPushStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => alive && setStatus("unsupported"));
    return () => {
      alive = false;
    };
  }, []);

  if (status === "loading" || status === "unsupported" || status === "unavailable") return null;

  async function toggle() {
    setBusy(true);
    setError(null);
    try {
      if (status === "on") {
        await disablePush();
        setStatus("off");
      } else {
        setStatus(await enablePush());
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mb-4 flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-lavender text-lavender-ink" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9zM10 19a2 2 0 0 0 4 0" />
          </svg>
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-foreground">
            {status === "on" ? "Notifications are on for this device" : "Get notified on this device"}
          </p>
          <p className="text-xs leading-relaxed text-muted">
            {status === "needs-install" &&
              "On iPhone, first add GiiGirl to your Home Screen: tap Share, then Add to Home Screen. Open it from there and turn notifications on."}
            {status === "blocked" &&
              "Notifications are blocked for GiiGirl in your browser settings. Allow them there, then come back."}
            {(status === "on" || status === "off") &&
              "New messages, comments, likes and followers. For your privacy, notifications never show names or message text on your lock screen."}
          </p>
        </div>
      </div>
      {(status === "on" || status === "off") && (
        <button
          type="button"
          onClick={toggle}
          disabled={busy}
          className={
            status === "on"
              ? "self-end rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground hover:bg-surface-hover disabled:opacity-60"
              : "self-end rounded-full bg-brand px-4 py-1.5 text-sm font-medium text-brand-foreground shadow-sm hover:bg-brand-hover disabled:opacity-60"
          }
        >
          {busy ? "Please wait…" : status === "on" ? "Turn off" : "Turn on notifications"}
        </button>
      )}
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
