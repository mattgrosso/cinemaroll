// The Letterboxd import's progress, shared by every screen that shows it
// (the welcome panel, Settings, Home's notice card). Its own file so Home can
// watch it without loading the runner (and the store and TMDB code behind it)
// until an import actually happens. The runner is utils/letterboxdImportRun.js.
import { reactive } from 'vue';

export const importState = reactive({
  loaded: false,
  running: false,
  phase: '', // 'reading' | 'matching' | 'reviews' | 'paused' | 'done'
  total: 0,
  processed: 0,
  imported: 0,
  viewingsAdded: 0,
  doubtful: [], // [{ key, title, year, viewings, suggestion }]
  pending: 0,
  failedWrites: 0,
  reviewsImported: 0,
  message: '',
  error: false
});

// What Home's notice card is about right now (homeNotices.js), or null.
// Running → one card for the whole run; afterwards, the films still waiting
// for a match (a count, so putting it away holds until MORE need one) or a
// run that stopped part way.
export const importNoticeSignature = (state) => {
  if (state.running) return 'running';
  if (state.pending) return `paused-${state.pending}`;
  return state.doubtful.length || null;
};

// A per-account flag on the device saying an import is saved, so a launch
// only loads the runner when there's something to show.
const flagKey = (topKey) => `cinemaroll.letterboxdImport.${topKey}`;

export const hasSavedImport = (topKey) => {
  try { return Boolean(topKey) && localStorage.getItem(flagKey(topKey)) === '1'; } catch { return false; }
};

export const markSavedImport = (topKey, saved) => {
  try {
    if (!topKey) return;
    if (saved) localStorage.setItem(flagKey(topKey), '1');
    else localStorage.removeItem(flagKey(topKey));
  } catch { /* storage refused: the panel in Settings still loads it */ }
};
