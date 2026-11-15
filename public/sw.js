/* Service Worker: hält die App offline verfügbar. Daten- und KI-Anfragen gehen immer ans Netz, Fotos werden zwischengespeichert. */
const CACHE = "pflanzenpflege-v4";
const PHOTOS = "pflanzenpflege-photos";
const SHELL = ["/", "/index.html", "/app.css", "/app.js", "/runtime.js", "/schedule.js", "/manifest.webmanifest", "/icons/icon.svg", "/icons/icon-192.png", "/icons/apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== PHOTOS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Fotos ändern sich nie: einmal geladen, kommen sie aus dem Cache (auch offline).
  if (url.origin === self.location.origin && url.pathname === "/api/photo") {
    e.respondWith(caches.open(PHOTOS).then(c => c.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) c.put(req, res.clone());
      return res;
    }))));
    return;
  }
  if (url.pathname.startsWith("/api/")) return;
  const isFont = url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com";
  if (url.origin !== self.location.origin && !isFont) return;
  // Netz zuerst (damit Updates sofort ankommen), Cache als Rückfall für offline.
  e.respondWith(
    fetch(req).then(res => {
      if (res.ok || res.type === "opaque") { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
      return res;
    }).catch(() => caches.match(req).then(r => r || (req.mode === "navigate" ? caches.match("/index.html") : Response.error())))
  );
});

/* Erinnerungen am Morgen */
self.addEventListener("push", e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : "" }; }
  const jobs = [self.registration.showNotification(d.title || "Pflanzen", {
    body: d.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    tag: d.tag || "heute",
    data: { url: d.url || "/#heute" }
  })];
  if (typeof d.badge === "number" && self.navigator && "setAppBadge" in self.navigator) {
    jobs.push((d.badge ? self.navigator.setAppBadge(d.badge) : self.navigator.clearAppBadge()).catch(() => {}));
  }
  e.waitUntil(Promise.all(jobs));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "/#heute", self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const c of list) {
      if (new URL(c.url).origin === self.location.origin && "focus" in c) { if ("navigate" in c) c.navigate(url).catch(() => {}); return c.focus(); }
    }
    return self.clients.openWindow(url);
  }));
});
