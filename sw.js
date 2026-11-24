const CACHE_NAME = "bara-studios-v3";
const APP_SHELL = [
  "./",
  "./index.html",
  "./shop.html",
  "./bara-shop.html",
  "./canna-shop.html",
  "./bara-services-shop.html",
  "./the-thingy.html",
  "./manifest.webmanifest",
  "./styles.css",
  "./shop.css",
  "./the-thingy.css",
  "./script.js",
  "./shop.js",
  "./the-thingy.js",
  "./pwa.js",
  "./jk.jpeg",
  "./wallpapers.png",
  "./1000020433(1)ygufufy.jpg",
  "./app-icon-192.png",
  "./app-icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL.map((url) => new Request(url, { cache: "reload" }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) =>
      Promise.all(
        cacheNames
          .filter((cacheName) => cacheName.startsWith("bara-studios-") && cacheName !== CACHE_NAME)
          .map((cacheName) => caches.delete(cacheName))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const requestUrl = new URL(request.url);
  const adminPath = new URL("./admin", self.location.href).pathname;
  const apiPath = new URL("./api/", self.location.href).pathname;
  if (
    request.method !== "GET" ||
    requestUrl.origin !== self.location.origin ||
    requestUrl.pathname === adminPath ||
    requestUrl.pathname === `${adminPath}.html` ||
    requestUrl.pathname.startsWith(`${adminPath}.`) ||
    requestUrl.pathname.startsWith(apiPath)
  ) return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          await cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cachedPage = await caches.match(request, { ignoreSearch: true });
        return cachedPage || caches.match("./index.html");
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;

    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      await cache.put(request, response.clone());
    }
    return response;
  })());
});

self.addEventListener("push", (event) => {
  let payload = { title: "Bara Studios alert", body: "A priority update needs your attention.", url: "./admin" };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch (error) {
      console.error("Could not parse a Bara Studios push message.", error);
    }
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "./app-icon-192.png",
    badge: "./app-icon-192.png",
    data: { url: payload.url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const adminUrl = new URL("./admin", self.location.href);
  const requestedUrl = new URL(event.notification.data?.url || adminUrl.href, self.location.href);
  const targetUrl = requestedUrl.origin === self.location.origin && requestedUrl.pathname.startsWith(adminUrl.pathname)
    ? requestedUrl
    : adminUrl;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      existing.navigate(targetUrl.href);
      return existing.focus();
    }
    return self.clients.openWindow(targetUrl.href);
  }));
});
