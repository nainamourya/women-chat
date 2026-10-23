"use client";

import { useEffect, useSyncExternalStore } from "react";

// Unread notification and message counts for the navigation badges.
//
// One small shared store with a single poller, however many components show a
// badge. It polls every 30 seconds while the tab is visible, refreshes when the
// tab becomes visible again, and can be refreshed on demand (after marking
// things read, or when a live message arrives). Failures leave the last known
// counts in place — a badge is a hint, never a source of truth.

export type UnreadCounts = { notifications: number; messages: number };

const POLL_MS = 30_000;
const EMPTY: UnreadCounts = { notifications: 0, messages: 0 };

let counts: UnreadCounts = EMPTY;
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;
let consumers = 0;

function publish(next: UnreadCounts) {
  if (next.notifications === counts.notifications && next.messages === counts.messages) return;
  counts = next;
  for (const listener of listeners) listener();
}

export async function refreshUnreadCounts(): Promise<void> {
  try {
    const res = await fetch("/api/social/unread-counts");
    if (!res.ok) return;
    const data = (await res.json()) as Partial<UnreadCounts>;
    publish({ notifications: data.notifications ?? 0, messages: data.messages ?? 0 });
  } catch {
    // keep the last known counts
  }
}

function onVisibility() {
  if (document.visibilityState === "visible") void refreshUnreadCounts();
}

function start() {
  void refreshUnreadCounts();
  timer = setInterval(() => {
    if (document.visibilityState === "visible") void refreshUnreadCounts();
  }, POLL_MS);
  document.addEventListener("visibilitychange", onVisibility);
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
  document.removeEventListener("visibilitychange", onVisibility);
  counts = EMPTY;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUnreadCounts(enabled: boolean): UnreadCounts {
  useEffect(() => {
    if (!enabled) return;
    consumers += 1;
    if (consumers === 1) start();
    return () => {
      consumers -= 1;
      if (consumers === 0) stop();
    };
  }, [enabled]);
  return useSyncExternalStore(subscribe, () => counts, () => EMPTY);
}
