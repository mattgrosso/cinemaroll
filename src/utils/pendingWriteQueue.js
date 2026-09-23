// Durable queue of Firebase writes that couldn't be confirmed immediately
// (offline, or a flaky connection) — a sibling to offlineStore.js, not an
// extension of it. offlineStore.js is a whole-blob snapshot cache (read
// fallback); this is individually added/updated/removed entries with a
// different lifecycle, so it gets its own IndexedDB database rather than a
// second object store bolted onto offlineStore.js's (avoiding any
// onupgradeneeded migration risk to that already-shipped store).
//
// Every entry carries a ready-to-send `dbEntry: { path, value }`. Two kinds,
// discriminated by `type`, share this one queue because they need identical
// flush mechanics for that `dbEntry` — a single list drives both "silently
// retry this write" (either type) and "prompt the user to reconcile this"
// (type 'placeholder' only):
//   - 'write': a self-contained, ready-to-send write (re-rate updates, and
//     the finalized write after reconciliation).
//   - 'placeholder': the above, plus reconciliation metadata (title/year/
//     ratings/status) for a brand-new movie rated offline with no TMDB match
//     yet.
const DB_NAME = 'cinemaRollPendingWrites';
const DB_VERSION = 1;
const STORE_NAME = 'pendingWrites';

function openDB () {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    // A promise that never settles is a rating form stuck on "Submitting…"
    // (2026-09-23, lie-fi reproduction): every outcome has to reject.
    request.onblocked = () => reject(new Error('IndexedDB open blocked'));
  });
}

function listAll (db) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function getRecord (db, id) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const request = tx.objectStore(STORE_NAME).get(id);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

function putRecord (db, record) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

// IndexedDB can wedge (iOS storage pressure, a stuck versionchange, a
// private window). Whatever happens, the caller gets an answer: null from
// enqueueWrite, and the save path takes it from there.
const STORAGE_TIMEOUT_MS = 6000;
const bounded = (promise, what) => {
  let timer;
  const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error(`${what} timed out after ${STORAGE_TIMEOUT_MS}ms`)), STORAGE_TIMEOUT_MS); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// Adds a new pending write, or — for type 'write' — overwrites the existing
// entry targeting the same dbEntry.path so repeated offline edits to the
// same movie before the next flush collapse to a single write (the same
// outcome the online same-path debounce already gives, just durable across
// a reload). Returns the stored record, or null if IndexedDB is unavailable.
const toPlain = (value) => JSON.parse(JSON.stringify(value));

export async function enqueueWrite (entry) {
  try {
    const db = await bounded(openDB(), 'IndexedDB open');

    let existingId = null;
    let existingCreatedAt = null;
    if (entry.type === 'write' && entry.dbEntry?.path) {
      const all = await listAll(db);
      const match = all.find((record) => record.type === 'write' && record.dbEntry?.path === entry.dbEntry.path);
      if (match) {
        existingId = match.id;
        existingCreatedAt = match.createdAt;
      }
    }

    // PLAIN DATA ONLY. The entry arrives straight off RateMovie's reactive
    // state, and a Vue reactive array is a Proxy, which the structured
    // clone behind IDBObjectStore.put() refuses ("[object Array] could not
    // be cloned"). Every rating queued from the form - offline, placeholder
    // OR the durability copy under an online save - was failing here and
    // surfacing as "offline storage is unavailable" (found 2026-09-23 while
    // reproducing lie-fi; the unit tests only ever queued plain objects).
    // The JSON round-trip is the same shape Firebase stores anyway.
    const record = toPlain({
      attempts: 0,
      lastError: null,
      ...entry,
      id: existingId || crypto.randomUUID(),
      createdAt: existingCreatedAt || Date.now()
    });

    await bounded(putRecord(db, record), 'IndexedDB put');
    return record;
  } catch (error) {
    // Still resolves null (callers depend on that), but never silently:
    // a swallowed DataCloneError here surfaced to the user as "offline
    // storage is unavailable" for a day before anyone could see why.
    console.error('pendingWriteQueue: could not enqueue', entry?.type, entry?.dbEntry?.path, error);
    return null;
  }
}

// Always resolves an array (never null/throws) so callers can iterate
// unconditionally. Sorted oldest-first — IndexedDB's getAll() returns
// records in primary-key order, and the key here is a random UUID, not an
// insertion-ordered value, so an explicit createdAt sort is what actually
// guarantees FIFO processing.
export async function listPendingWrites () {
  try {
    const db = await openDB();
    const all = await listAll(db);
    return all.sort((a, b) => a.createdAt - b.createdAt);
  } catch {
    return [];
  }
}

export async function removePendingWrite (id) {
  try {
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      tx.objectStore(STORE_NAME).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Best-effort only — see openDB's failure modes above.
  }
}

// Merges `patch` into the existing record (e.g. attempts/lastError/status).
// Resolves null if the record doesn't exist or IndexedDB is unavailable.
export async function updatePendingWrite (id, patch) {
  try {
    const db = await openDB();
    const existing = await getRecord(db, id);
    if (!existing) return null;

    const updated = toPlain({ ...existing, ...patch });
    await putRecord(db, updated);
    return updated;
  } catch {
    return null;
  }
}
