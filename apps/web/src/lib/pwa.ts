"use client";

import { useSyncExternalStore } from "react";

// Chrome/Edge/Samsung Internet fire `beforeinstallprompt` once, early. We keep
// the event here so an "Install app" button rendered later can still use it.
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

let deferred: InstallPromptEvent | null = null;
let installed = false;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export type InstallState =
  | "unavailable" // not supported (or not yet offered) by this browser
  | "available" // tap to show the browser's install dialog
  | "ios" // iPhone/iPad Safari: install via Share → Add to Home Screen
  | "installed"; // already running as an installed app

function isStandalone(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

export function getInstallState(): InstallState {
  if (installed || isStandalone()) return "installed";
  if (deferred) return "available";
  if (isIos()) return "ios";
  return "unavailable";
}

/** Called once from <PwaSetup/>: captures the install prompt and registers the service worker. */
export function initPwa(): () => void {
  const onPrompt = (e: Event) => {
    e.preventDefault(); // we show our own button instead of the mini-infobar
    deferred = e as InstallPromptEvent;
    emit();
  };
  const onInstalled = () => {
    installed = true;
    deferred = null;
    emit();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);

  // Production only: a service worker in `next dev` would get in the way of hot reload.
  if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not fatal: the site works the same without it, just without the offline page.
    });
  }

  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

/** Shows the browser's install dialog. Resolves true if the member accepted. */
export async function promptInstall(): Promise<boolean> {
  const event = deferred;
  if (!event) return false;
  deferred = null; // a prompt event can only be used once
  emit();
  await event.prompt();
  const { outcome } = await event.userChoice;
  return outcome === "accepted";
}

export function useInstallState(): InstallState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getInstallState,
    () => "unavailable",
  );
}
