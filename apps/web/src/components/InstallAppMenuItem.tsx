"use client";

import { useState } from "react";
import { promptInstall, useInstallState } from "@/lib/pwa";

function PhoneIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" stroke="currentColor" strokeWidth="1.6" />
      <path d="M12 7.5v7m0 0-2.6-2.6M12 14.5l2.6-2.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const itemClass =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-hover";

// "Install app" entry for the account menu. Hidden when the browser can't
// install (e.g. desktop Firefox) or GiiGirl is already installed.
export function InstallAppMenuItem({ onDone }: { onDone: () => void }) {
  const state = useInstallState();
  const [showIosHelp, setShowIosHelp] = useState(false);

  if (state === "available") {
    return (
      <button
        type="button"
        className={itemClass}
        onClick={async () => {
          onDone();
          await promptInstall();
        }}
      >
        <PhoneIcon className="h-4 w-4" />
        Install app
      </button>
    );
  }

  if (state === "ios") {
    return (
      <>
        <button type="button" className={itemClass} aria-expanded={showIosHelp} onClick={() => setShowIosHelp((v) => !v)}>
          <PhoneIcon className="h-4 w-4" />
          Install app
        </button>
        {showIosHelp && (
          <p className="px-3 pb-2 text-xs leading-relaxed text-muted">
            In Safari, tap the <strong>Share</strong> button{" "}
            <span aria-hidden="true">(□↑)</span>, then <strong>Add to Home Screen</strong>.
          </p>
        )}
      </>
    );
  }

  return null;
}
