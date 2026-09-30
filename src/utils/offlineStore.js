// Best-effort IndexedDB snapshot cache for movieLog/settings, used as a
// fallback when initializeDB's live Firebase onValue listener can't connect
// (offline cold start). Firebase RTDB's web SDK has no built-in disk
// persistence (unlike Firestore's enableIndexedDbPersistence), so this is a
// small hand-rolled substitute: every successful live read is snapshotted
// here, and a cold offline start reads the last snapshot back instead of
// hanging forever waiting for a socket that will never connect.
const DB_NAME = 'cinemaRollOffline';
const DB_VERSION = 1;
const STORE_NAME = 'snapshots';

// Bounds (bug report, Matt, 2026-09-30, one bar of signal: "spun for a
// while and just never did anything"). On a bad connection this snapshot is
// the ONLY way the library appears - the live listener never fires - so a
// read that never settles is a spinner forever. WebKit's IndexedDB has been
// known to leave the first open() of a launch unanswered; a second open
// usually goes straight through. So: bound the open, try it once more, and
// bound the read itself generously (a big library is a few MB to clone).
export const OPEN_TIMEOUT_MS = 4000;
export const READ_TIMEOUT_MS = 15000;

function withTimeout (promise, ms, what) {
  let timer = null;
  const deadline = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => clearTimeout(timer));
}

async function openDB () {
  try {
    return await withTimeout(openOnce(), OPEN_TIMEOUT_MS, 'IndexedDB open');
  } catch (error) {
    if (!/timed out/.test(error?.message || '')) throw error;
    return withTimeout(openOnce(), OPEN_TIMEOUT_MS, 'IndexedDB open');
  }
}

function openOnce () {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function keyFor (topKey, kind) {
  return `${topKey}:${kind}`;
}

// Never throws — a cache-write failure (unsupported browser, quota, private
// browsing) should never interrupt the real live-data path that calls this.
export async function saveSnapshot (topKey, kind, data) {
  try {
    const db = await openDB();

    await withTimeout(new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).put(data, keyFor(topKey, kind));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    }), READ_TIMEOUT_MS, 'IndexedDB write');
  } catch {
    // Best-effort only — see comment above.
  }
}

// Resolves to null (not a rejection) on any failure or cache miss, so callers
// can treat "no snapshot available" and "snapshot lookup failed" the same way.
export async function loadSnapshot (topKey, kind) {
  try {
    const db = await openDB();

    return await withTimeout(new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const request = tx.objectStore(STORE_NAME).get(keyFor(topKey, kind));
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    }), READ_TIMEOUT_MS, 'IndexedDB read');
  } catch {
    return null;
  }
}
