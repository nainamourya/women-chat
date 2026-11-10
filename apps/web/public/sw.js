/* GiiGirl service worker.
 *
 * Deliberately minimal: it caches only the offline page and its icon, shows
 * that page when a full-page navigation fails because the device is offline,
 * and displays push notifications (generic text only — no names or messages).
 * Every other request (pages, API calls, uploads, sockets, private media) goes
 * straight to the network and is never cached, so members never see stale or
 * someone else's data.
 *
 * Bump VERSION when this file or offline.html changes.
 */
const VERSION = "v2";
const CACHE = `giigirl-offline-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icons/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("giigirl-offline-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate" || request.method !== "GET") return;

  event.respondWith(
    fetch(request).catch(async () => {
      const cached = await caches.match(OFFLINE_URL);
      return cached ?? Response.error();
    }),
  );
});

// --- Push notifications ------------------------------------------------------
// The server sends only generic text ("You have a new message") and an in-app
// path. Anything unexpected falls back to a safe default.
const PUSH_PATHS = ["/messages", "/notifications"];

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const url = PUSH_PATHS.includes(data.url) ? data.url : "/notifications";
  const title = typeof data.title === "string" ? data.title.slice(0, 60) : "GiiGirl";
  const body = typeof data.body === "string" ? data.body.slice(0, 160) : "You have something new";

  // Always show it: Safari/iOS cancels the subscription of a site that receives
  // pushes without showing a notification. Same-kind notifications replace
  // each other (tag) instead of piling up.
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: typeof data.tag === "string" ? data.tag.slice(0, 40) : "giigirl",
      renotify: true,
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = PUSH_PATHS.includes(event.notification.data?.url) ? event.notification.data.url : "/notifications";
  const target = new URL(path, self.location.origin).href;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windows) => {
      const existing = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        return existing.navigate(target).catch(() => undefined);
      }
      return self.clients.openWindow(target);
    }),
  );
});
