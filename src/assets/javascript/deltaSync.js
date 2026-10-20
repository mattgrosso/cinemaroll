// Delta sync — pure, store-free logic for reconstructing the library from
// the cached snapshot plus a changes-since-lastSync query.
//
// Phase 2/3 (2026-08-17): reconstruction is now the normal launch path for
// everyone (see launchPlan). Every FULL_RESYNC_INTERVAL_MS each device does
// a full download instead, which both heals anything the delta path can't
// see and runs the shadow comparison (diffLibraries) against a fresh delta
// reconstruction, recording the reading — so verification continues at
// resync cadence even though the per-launch full download is gone.
//
// Design rules carried in from docs/history/data-and-offline.md:
//   - lastSync is the maximum updatedAt actually RECEIVED, never a local
//     clock reading — clock skew stays out of it entirely.
//   - Tombstones are advisory, compared by time: apply a deletion only when
//     the tombstone is newer than the entry's own updatedAt, so re-rating a
//     previously deleted movie wins naturally on its newer stamp.

export const UPDATED_AT_FIELD = 'updatedAt';

// Phase 2/3: how often a launch does a FULL download anyway. The full
// download is what heals anything the delta path can't see (an entry
// changed without a restamp — the unexplained Dune divergence class), and
// its onValue callback is where the shadow comparison runs, so every
// resync is also a recorded verification. Three days: staleness stays
// bounded tightly while costing one library download per device per
// three days (~pennies).
export const FULL_RESYNC_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

// Decides how this launch loads the library. Delta requires BOTH the meta
// (lastSync) and a non-empty prior snapshot — the design notes' "stored
// and invalidated together" rule enforced by construction: if either half
// is missing or the snapshot was somehow lost, fall back to a full
// download rather than showing a near-empty library.
// Returns { mode: 'delta' } or { mode: 'full', reason } where reason is
// 'no-meta' | 'no-snapshot' | 'resync-due'.
export function launchPlan (meta, snapshot, now = Date.now()) {
  if (meta?.lastSync == null) return { mode: 'full', reason: 'no-meta' };
  if (!snapshot || !Object.keys(snapshot).length) return { mode: 'full', reason: 'no-snapshot' };
  // Meta written before phase 2 has no lastFullSyncAt — treat as due, so
  // every device's first phase-2 launch is a full download that runs the
  // shadow check and stamps a fresh baseline.
  const lastFull = meta.lastFullSyncAt;
  if (!Number.isFinite(lastFull) || now - lastFull > FULL_RESYNC_INTERVAL_MS) {
    return { mode: 'full', reason: 'resync-due' };
  }
  return { mode: 'delta' };
}

// The maximum finite updatedAt across a library — the next lastSync after a
// full download. Null when nothing is stamped (nothing to delta from).
export function maxUpdatedAt (movieLog) {
  let max = null;
  Object.values(movieLog || {}).forEach((entry) => {
    const stamp = entry?.[UPDATED_AT_FIELD];
    if (Number.isFinite(stamp) && (max === null || stamp > max)) max = stamp;
  });
  return max;
}

// snapshot + delta + tombstones -> the library a delta-syncing client would
// hold. `deltaEntries` is keyed by dbKey (the query result); entries in it
// replace their snapshot counterparts wholesale (that's set()'s semantics
// on the write side). Tombstones delete only when strictly newer than the
// entry they'd remove.
export function reconstructFromDelta (snapshot, deltaEntries, tombstones = {}) {
  const result = { ...(snapshot || {}) };

  Object.entries(deltaEntries || {}).forEach(([dbKey, entry]) => {
    result[dbKey] = entry;
  });

  Object.entries(tombstones || {}).forEach(([dbKey, deletedAt]) => {
    if (!Number.isFinite(deletedAt)) return;
    const entry = result[dbKey];
    if (!entry) return;
    const entryStamp = entry?.[UPDATED_AT_FIELD];
    if (!Number.isFinite(entryStamp) || deletedAt > entryStamp) {
      delete result[dbKey];
    }
  });

  return result;
}

// Compares the reconstruction against the full download (the truth).
// Returns { identical, missing, stale, extra, compared } where the three
// arrays hold dbKeys, capped so a pathological divergence can't build a
// giant report. `stale` means the key exists on both sides but the entries
// differ (deep-compared via JSON with sorted keys, so property order can't
// fake a difference).
const EXAMPLE_CAP = 20;

function stableStringify (value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

// `dbKey` and `_search` are INJECTED AT READ TIME and never stored (see
// storedEntry.js's RUNTIME_ENTRY_FIELDS). The full download carries them;
// entries reconstructed from raw Firebase delta rows do not. Comparing them
// reported a divergence for every entry that came through the delta path —
// i.e. shadow mode cried wolf on every launch with any recent activity,
// which would have poisoned the phase-2 go/no-go. Strip them before diffing.
const RUNTIME_ONLY_FIELDS = ['dbKey', '_search'];

function comparable (entry) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry;
  const copy = { ...entry };
  RUNTIME_ONLY_FIELDS.forEach((field) => { delete copy[field]; });
  return copy;
}

export function diffLibraries (fullDownload, reconstructed) {
  const missing = [];
  const stale = [];
  const extra = [];
  const expected = fullDownload || {};
  const actual = reconstructed || {};

  Object.keys(expected).forEach((dbKey) => {
    if (!(dbKey in actual)) {
      if (missing.length < EXAMPLE_CAP) missing.push(dbKey);
    } else if (stableStringify(comparable(expected[dbKey])) !== stableStringify(comparable(actual[dbKey]))) {
      if (stale.length < EXAMPLE_CAP) stale.push(dbKey);
    }
  });
  Object.keys(actual).forEach((dbKey) => {
    if (!(dbKey in expected) && extra.length < EXAMPLE_CAP) extra.push(dbKey);
  });

  return {
    identical: !missing.length && !stale.length && !extra.length,
    missing,
    stale,
    extra,
    compared: Object.keys(expected).length
  };
}

// Diagnostic detail for a stale entry, attached to the shadow report so a
// divergence in the wild explains itself (first seen 2026-08-15: the Dune
// entry stale on every boot with its stamp exactly equal to lastSync — the
// report alone couldn't say whether the delta query missed the boundary
// entry or the snapshot round-trip mangled it).
export function describeStaleEntry (freshEntry, reconstructedEntry, deltaEntries, dbKey) {
  const diffPaths = [];
  const walk = (a, b, path, depth) => {
    if (diffPaths.length >= 5) return;
    if (stableStringify(a) === stableStringify(b)) return;
    const bothObjects = a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b);
    if (!bothObjects || depth >= 2) {
      diffPaths.push(path || '(root)');
      return;
    }
    new Set([...Object.keys(a), ...Object.keys(b)]).forEach((key) => {
      walk(a[key], b[key], path ? `${path}.${key}` : key, depth + 1);
    });
  };
  walk(comparable(freshEntry), comparable(reconstructedEntry), '', 0);

  return {
    dbKey,
    freshStamp: freshEntry?.[UPDATED_AT_FIELD] ?? null,
    reconstructedStamp: reconstructedEntry?.[UPDATED_AT_FIELD] ?? null,
    inDelta: Boolean(deltaEntries && dbKey in deltaEntries),
    diffPaths
  };
}

// A divergence that is only a save landing between the full download and the
// delta query a moment later (Sentry, 2026-10-20: one launch, a "resync-due"
// full download, logged as an error). The full download is read first, so a
// write that reached the server in between is in the delta with a NEWER stamp
// than the full download's copy — the delta path is ahead, not wrong, and the
// full download replaces the device's copy anyway. Only stale entries qualify:
// anything missing or extra, an uncapped-for list, or a stale entry whose
// reconstruction is not strictly newer stays a real divergence.
export function isWriteRaceOnly (report) {
  if (!report || report.identical) return false;
  if (report.missing?.length || report.extra?.length) return false;
  const stale = report.stale || [];
  const details = report.staleDetail || [];
  if (!stale.length || stale.length >= EXAMPLE_CAP || details.length !== stale.length) return false;
  return details.every((detail) => detail.inDelta &&
    Number.isFinite(detail.reconstructedStamp) &&
    (!Number.isFinite(detail.freshStamp) || detail.reconstructedStamp > detail.freshStamp));
}

// One line for the error text itself. ErrorLogService puts the report in its
// context argument, which Sentry shows as "[object Object]" — so before this
// the event said a divergence happened and nothing about which or why.
export function summarizeShadowReport (report) {
  if (!report) return 'no report';
  const parts = [
    `${report.compared ?? '?'} compared`,
    `${report.deltaEntryCount ?? '?'} via delta`,
    `missing ${report.missing?.length || 0}`,
    `stale ${report.stale?.length || 0}`,
    `extra ${report.extra?.length || 0}`,
    `lastSync ${report.lastSyncUsed ?? 'none'}`
  ];
  const details = (report.staleDetail || []).slice(0, 3).map((detail) =>
    `${detail.dbKey}: full ${detail.freshStamp ?? 'none'} vs delta ${detail.reconstructedStamp ?? 'none'}` +
    `, ${detail.inDelta ? 'in' : 'not in'} delta, fields ${(detail.diffPaths || []).join('|') || 'none'}`);
  return [parts.join(', '), ...details].join('; ');
}
