"use client";

// Turning push notifications on/off for THIS device. The browser keeps the
// subscription; the Worker stores it (via /api/push) so it can send to it.

export type PushStatus =
  | "unsupported" // this browser cannot do Web Push at all
  | "needs-install" // iPhone/iPad: only works once GiiGirl is on the Home Screen
  | "unavailable" // the server has push turned off
  | "blocked" // the member said "Block" in the browser's permission prompt
  | "off"
  | "on";

function isIos(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
}

function isStandalone(): boolean {
  return window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function supported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  // The worker is registered on every page load (lib/pwa.ts); register again
  // here so this also works on the very first visit.
  await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const b64 = base64url.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((base64url.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function publicKey(): Promise<string | null> {
  const res = await fetch("/api/push/public-key", { cache: "no-store" });
  if (!res.ok) return null;
  const data = (await res.json()) as { publicKey?: string };
  return data.publicKey ?? null;
}

export async function getPushStatus(): Promise<PushStatus> {
  if (!supported()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
  if (sub && Notification.permission === "granted") return "on";
  return (await publicKey()) ? "off" : "unavailable";
}

/** Asks for permission (only ever from a tap) and saves this device. */
export async function enablePush(): Promise<PushStatus> {
  if (!supported()) return isIos() && !isStandalone() ? "needs-install" : "unsupported";
  const key = await publicKey();
  if (!key) return "unavailable";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission === "denied" ? "blocked" : "off";

  const reg = await registration();
  let sub = await reg.pushManager.getSubscription();
  // A subscription made with an old server key cannot receive our pushes.
  const current = sub?.options.applicationServerKey;
  if (sub && current && btoa(String.fromCharCode(...new Uint8Array(current))) !== btoa(String.fromCharCode(...keyBytes(key)))) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) {
    try {
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    } catch {
      // Brave ships with Google's push service switched off, which makes
      // subscribe() fail with "Registration failed - push service error".
      const isBrave = Boolean((navigator as Navigator & { brave?: unknown }).brave);
      throw new Error(
        isBrave
          ? "Brave blocks notifications by default. Open brave://settings/privacy, turn on “Use Google services for push messaging”, restart Brave and try again."
          : "Your browser couldn't turn on notifications. Please try again, or try Chrome, Edge, Firefox or Safari.",
      );
    }
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) {
    await sub.unsubscribe().catch(() => {});
    throw new Error("Could not turn on notifications. Please try again.");
  }
  return "on";
}

/** Stops pushes to this device (also used on log out). Never throws. */
export async function disablePush(): Promise<void> {
  try {
    if (!supported()) return;
    const sub = await (await navigator.serviceWorker.getRegistration("/"))?.pushManager.getSubscription();
    if (!sub) return;
    await fetch("/api/push/unsubscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {});
    await sub.unsubscribe();
  } catch {
    // best effort
  }
}
