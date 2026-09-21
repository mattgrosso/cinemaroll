import { getDatabase, ref as dbRef, push, set, serverTimestamp } from 'firebase/database';
import { getLastWorkerState, getReloadAttempt } from './appUpdate.js';

// Same "report a bug without breaking your flow" pattern used in the
// thunderstone/space-base repos, adapted to Cinema Roll's Vuex store (not
// Pinia) and its single shared Firebase project (no cross-repo RTDB, so no
// namespacing needed — this is just "bugReports"). Unlike those repos,
// Cinema Roll's database.rules.json is wide open (`.read`/`.write: true`)
// and login is Google OAuth (not anonymous), so there's no auth dance here —
// just write the report.
function buildAppStateSummary (store, route) {
  const state = store.state;

  return {
    route: route?.fullPath || window.location.hash,
    devMode: localStorage.getItem('devMode') === 'true',
    dbLoaded: state.dbLoaded,
    movieCount: state.movieLog ? Object.keys(state.movieLog).length : 0,
    sortValue: state.DBSortValue,
    sortOrder: state.DBSortOrder,
    // NOTE: these three are the PERSISTED NAVIGATION fields (saved by
    // Home's beforeRouteLeave, cleared again by its mounted() restore) -
    // NOT what Home is actually filtering by right now. They were the only
    // search-ish state in the store, so early reports used them; a report
    // filed from Home will almost always show them empty/stale regardless
    // of what's on screen. Kept for continuity with older reports, but read
    // `homeLive` below for the real answer.
    searchValue: state.homePageSearchValue,
    searchChips: state.homePageSearchChips,
    numberOfResultsShown: state.homePageNumberOfResults,
    // Home's LIVE filter/result state, published by Home itself (see its
    // liveDebugState watcher). Added after an "the entire list of movies is
    // empty" report that couldn't be diagnosed, because nothing in the
    // snapshot could distinguish "no results matched the active filter"
    // from "the list genuinely failed to render".
    homeLive: state.homePageLiveState || null,
    // The update machinery's view of the world (bug report 2026-09-21, "the
    // auto refresh is stuck"): what this page is running, what the last
    // check saw deployed, what the service worker was doing, and whether a
    // reload for this update has already been tried.
    update: {
      running: runningBundleName(),
      deployed: state.updateTargetBundle || null,
      available: Boolean(state.updateAvailable),
      worker: getLastWorkerState(),
      reloadAttempt: getReloadAttempt()
    }
  };
}

function runningBundleName () {
  try {
    const scripts = Array.from(document.querySelectorAll('script[src]'));
    for (const script of scripts) {
      const match = (script.getAttribute('src') || '').match(/js\/app\.[a-z0-9]+\.js/);
      if (match) return match[0];
    }
  } catch { /* no document */ }
  return null;
}

function buildReport (store, text, route) {
  return {
    createdAt: serverTimestamp(),
    transcript: text,
    reporterEmail: store.state.userEmail || null,
    url: window.location.href,
    userAgent: navigator.userAgent,
    screenSize: `${window.innerWidth}x${window.innerHeight}`,
    devicePixelRatio: window.devicePixelRatio || 1,
    // Stringified, not a raw nested object — RTDB silently drops empty-object
    // keys on write, so a plain object here can lose fields with no warning.
    appState: JSON.stringify(buildAppStateSummary(store, route)),
  };
}

// Offline stash (2026-08-15 offline audit): bugReports/ lives OUTSIDE the
// account root, so it can't ride the account-scoped durable write queue.
// A report written while offline (or when the write fails) is stashed in
// localStorage and flushed on the next submit attempt or app launch —
// serverTimestamp() placeholders serialize as plain objects and still
// resolve server-side on the eventual write.
const STASH_KEY = 'cinemaroll-pending-bug-reports';

function readStash () {
  try {
    return JSON.parse(localStorage.getItem(STASH_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeStash (reports) {
  try {
    localStorage.setItem(STASH_KEY, JSON.stringify(reports.slice(-10)));
  } catch {
    // Storage full/blocked: nothing more we can do for a best-effort stash.
  }
}

export async function flushStashedBugReports () {
  const stash = readStash();
  if (!stash.length || !navigator.onLine) return 0;

  const db = getDatabase();
  let sent = 0;
  for (const report of stash) {
    try {
      await set(push(dbRef(db, 'bugReports')), { ...report, createdAt: serverTimestamp() });
      sent += 1;
    } catch {
      break; // still unreachable; keep the rest for next time
    }
  }
  writeStash(stash.slice(sent));
  return sent;
}

export async function submitBugReport (store, transcript, route) {
  const text = (transcript || '').trim();
  if (!text) throw new Error('Describe what happened before sending.');

  const report = buildReport(store, text, route);

  try {
    const db = getDatabase();
    await set(push(dbRef(db, 'bugReports')), report);
    // A success is also our chance to drain anything stashed earlier.
    flushStashedBugReports().catch(() => {});
  } catch (error) {
    // Offline or write failure: stash it (with a client timestamp note so
    // triage can tell when it actually happened) instead of losing the text.
    writeStash([...readStash(), { ...report, createdAt: null, clientCreatedAt: Date.now(), queuedOffline: true }]);
    if (!navigator.onLine) {
      return { queued: true };
    }
    throw error;
  }
  return { queued: false };
}
