// A record of every number put on the icon, and why (Matt, 2026-11-06: "I
// keep getting red notification dots with giant numbers... usually in the
// 50s... we haven't figured out what's going on"). Three days of fixes each
// changed an arithmetic without ever seeing the number that was actually
// sent, so now every badge is written down with its parts:
//
//   push/badgeLog   the last BADGE_LOG_KEEP badges, from the app (`by:
//                   'app'`, this device) and the push Lambda (`by:
//                   'lambda'`, the push that carried it), newest last
//   push/swLog      pushes the service worker received on this device, with
//                   the app_badge each carried (kept in IndexedDB by the
//                   worker, uploaded when the app opens)
//
// Bug reports carry the tail of both. Pure helpers here; the store writes.

export const BADGE_LOG_KEEP = 40;
export const SW_LOG_DB = 'cinemaroll-push-log';
export const SW_LOG_STORE = 'pushes';

/** Which device wrote a record: the browser, and whether it runs as an installed app. */
export function deviceLabel (nav = typeof navigator !== 'undefined' ? navigator : {}, win = typeof window !== 'undefined' ? window : {}) {
  const ua = String(nav.userAgent || '');
  const os = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Macintosh/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : 'other';
  const version = (ua.match(/OS (\d+_\d+)/) || ua.match(/Version\/(\d+(?:\.\d+)?)/) || ua.match(/Chrome\/(\d+)/) || [])[1] || '';
  const standalone = Boolean(nav.standalone) || Boolean(win.matchMedia && win.matchMedia('(display-mode: standalone)').matches);
  return `${os}${version ? ' ' + version.replace('_', '.') : ''}${standalone ? ' app' : ' browser'}`;
}

/** The log with `entry` appended, oldest dropped past `keep`. Entries are sorted by `at`. */
export function appendLog (log, entry, keep = BADGE_LOG_KEEP) {
  const list = Array.isArray(log) ? log.slice() : Object.values(log || {});
  list.push(entry);
  list.sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0));
  return list.slice(-keep);
}

/** Merge the worker's received-push entries into the account's log, by `at`. */
export function mergeLogs (log, entries, keep = BADGE_LOG_KEEP) {
  const seen = new Set((Array.isArray(log) ? log : []).map((e) => Number(e?.at)));
  let out = Array.isArray(log) ? log.slice() : [];
  for (const e of entries || []) if (e && !seen.has(Number(e.at))) { out.push(e); seen.add(Number(e.at)); }
  out.sort((a, b) => (Number(a?.at) || 0) - (Number(b?.at) || 0));
  return out.slice(-keep);
}

/**
 * Whether the app should write this badge to the log: when the number
 * changed since the last record from this device, or half an hour has
 * passed. A quiet device otherwise writes nothing.
 */
export function worthLogging (last, next, now = Date.now(), everyMs = 30 * 60 * 1000) {
  if (!last) return true;
  if (Number(last.count) !== Number(next.count)) return true;
  return now - (Number(last.at) || 0) >= everyMs;
}

/** The worker's log, read from IndexedDB (the app side; the worker writes it). */
export function readSwPushLog () {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') return resolve([]);
      const open = indexedDB.open(SW_LOG_DB, 1);
      open.onupgradeneeded = () => { try { open.result.createObjectStore(SW_LOG_STORE, { keyPath: 'at' }); } catch { /* exists */ } };
      open.onerror = () => resolve([]);
      open.onsuccess = () => {
        try {
          const db = open.result;
          const req = db.transaction(SW_LOG_STORE, 'readonly').objectStore(SW_LOG_STORE).getAll();
          req.onsuccess = () => { resolve(Array.isArray(req.result) ? req.result : []); db.close(); };
          req.onerror = () => { resolve([]); db.close(); };
        } catch { resolve([]); }
      };
    } catch { resolve([]); }
  });
}
