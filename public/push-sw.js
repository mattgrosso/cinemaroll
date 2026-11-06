/* eslint-disable no-undef */
// Push handlers, pulled into the generated Workbox service worker via
// workboxOptions.importScripts (vue.config.js). Kept in public/ so the file
// ships verbatim next to service-worker.js.
//
// The server sends DECLARATIVE web push payloads (the `web_push: 8030`
// envelope, since 2026-11-06; before that the key was missing and every push
// came through here) — on iOS Safari 18.4+ the system renders those without
// waking this code at all. These handlers are the fallback for Chrome/
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
  // Every push this worker handled, with the badge it carried, for the
  // account's push/swLog (the app uploads it when it opens): a badge that
  // appears with no record here came from the app or from iOS rendering a
  // declarative push itself.
  work.push(rememberPush({ at: Date.now(), title: notification.title, tag: notification.tag || null, app_badge: typeof notification.app_badge === 'number' ? notification.app_badge : null, declarative: Boolean(data && data.web_push) }).catch(() => {}));
  event.waitUntil(Promise.all(work));
});

const SW_LOG_DB = 'cinemaroll-push-log';
const SW_LOG_STORE = 'pushes';
const SW_LOG_KEEP = 40;
function rememberPush (entry) {
  return new Promise((resolve) => {
    try {
      const open = indexedDB.open(SW_LOG_DB, 1);
      open.onupgradeneeded = () => { open.result.createObjectStore(SW_LOG_STORE, { keyPath: 'at' }); };
      open.onerror = () => resolve();
      open.onsuccess = () => {
        try {
          const db = open.result;
          const tx = db.transaction(SW_LOG_STORE, 'readwrite');
          const store = tx.objectStore(SW_LOG_STORE);
          store.put(entry);
          const keys = store.getAllKeys();
          keys.onsuccess = () => { const extra = (keys.result || []).sort((a, b) => a - b).slice(0, Math.max(0, (keys.result || []).length - SW_LOG_KEEP)); extra.forEach((k) => store.delete(k)); };
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => { db.close(); resolve(); };
        } catch (e) { resolve(); }
      };
    } catch (e) { resolve(); }
  });
}

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
