/* eslint-disable no-undef */
// Push handlers, pulled into the generated Workbox service worker via
// workboxOptions.importScripts (vue.config.js). Kept in public/ so the file
// ships verbatim next to service-worker.js.
//
// The server sends DECLARATIVE web push payloads (the `web_push: 8030`
// envelope) — on iOS Safari 18.4+ the system renders those without waking
// this code at all, which is the reliable path on the platform this app
// actually gets installed on. These handlers are the fallback for Chrome/
// Android and older Safari: same JSON, rendered by hand.

self.addEventListener('push', (event) => {
  let data = null;
  try {
    data = event.data ? event.data.json() : null;
  } catch (e) {
    data = { notification: { title: 'Cinema Roll', body: event.data ? event.data.text() : '' } };
  }
  const notification = data && data.notification;
  if (!notification || !notification.title) return;

  const options = {
    body: notification.body || '',
    icon: '/img/icons/android-chrome-192x192.png',
    badge: '/img/icons/android-chrome-192x192.png',
    data: { navigate: notification.navigate || '/' },
    tag: notification.tag || undefined
  };

  const work = [self.registration.showNotification(notification.title, options)];
  if (typeof notification.app_badge === 'number' && navigator.setAppBadge) {
    work.push(navigator.setAppBadge(notification.app_badge).catch(() => {}));
  }
  event.waitUntil(Promise.all(work));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // The Lambda writes links on https://www.cinemaroll.org, but the app may be
  // installed from the bare cinemaroll.org (Matt re-added it from there,
  // 2026-10-22). iOS opens a link on a different origin in a browser sheet
  // OVER the app instead of in it, so the link is re-homed onto this
  // worker's own origin, keeping its path and hash.
  const raw = (event.notification.data && event.notification.data.navigate) || '/';
  let navigate = raw;
  try {
    const url = new URL(raw, self.location.origin);
    if (/(^|\.)cinemaroll\.org$/.test(url.hostname) || url.origin === self.location.origin) {
      navigate = `${self.location.origin}${url.pathname}${url.search}${url.hash}`;
    }
  } catch (e) { /* leave it as it came */ }
  event.waitUntil((async () => {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // An already-open app wins — focus it and steer it, rather than opening
    // a second copy of a standalone PWA.
    for (const client of clientList) {
      if ('focus' in client) {
        await client.focus();
        if ('navigate' in client && raw !== '/') {
          try { await client.navigate(navigate); } catch (e) { /* cross-origin or detached */ }
        }
        return;
      }
    }
    await self.clients.openWindow(navigate);
  })());
});
