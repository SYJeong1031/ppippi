const CACHE = "ppi-shell-v1";
const SHELL = [
  "/offline.html",
  "/offline.js",
  "/offline.css",
  "/favicon.svg",
  "/icon-192.png",
  "/icon-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("ppi-shell-") && k !== CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const req = event.request,
    u = new URL(req.url);
  if (req.method !== "GET" || u.origin !== self.location.origin) return;
  if (
    req.mode === "navigate" &&
    !u.pathname.startsWith("/signin-") &&
    !u.pathname.startsWith("/signout-") &&
    u.pathname !== "/callback"
  ) {
    event.respondWith(fetch(req).catch(() => caches.match("/offline.html")));
    return;
  }
  if (SHELL.includes(u.pathname)) {
    event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
  }
});
self.addEventListener("push", (event) => {
  let p = {};
  try {
    p = event.data.json();
  } catch {}
  const options = {
    body: p.body || "새로운 삐삐가 도착했습니다.",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: p.tag || "ppi-call",
    data: { url: "/" },
    silent: !!p.silent,
  };
  if (!p.silent && p.vibration) options.vibrate = [200, 100, 200];
  event.waitUntil(self.registration.showNotification("📟 PPI", options));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (clients) => {
        for (const client of clients)
          if (new URL(client.url).origin === self.location.origin) {
            await client.focus();
            client.postMessage({ type: "NEW_CALL" });
            return;
          }
        return self.clients.openWindow("/");
      }),
  );
});
self.addEventListener("message", (event) => {
  if (event.data?.type === "CLEAR_NOTIFICATIONS")
    event.waitUntil(
      self.registration
        .getNotifications()
        .then((items) => items.forEach((item) => item.close())),
    );
});
