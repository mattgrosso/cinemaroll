// What Cinema Roll counts in Bug Desk's Visitors tab, beyond the one ping per
// open that src/utils/usage.js sends (2026-10-14, Matt: "think about what
// would be the most interesting interactions to see data on"). Every count
// is an anonymous per-day tally: a name, nothing about who.
//
// Screens: the app routes after a '#', so the open ping's path is always '/'
// and says nothing about which screens get used. Each screen change counts
// `screen-<name>` instead.
//
// Actions are named at their call sites (chip-<type>, game-round-<game>,
// hat-draw, ...). An action taken offline would be lost (sendBeacon drops
// it), so trackWhenOnline holds those on the device until the connection is
// back.

import { trackEvent } from '../../utils/usage.js';

const PENDING_KEY = 'usage-pending-events';
const MAX_PENDING = 50;

// An event name the server accepts: lowercase letters, digits, dashes, ≤40.
export function eventName (...parts) {
  const name = parts
    .filter((part) => part != null && part !== '')
    .join('-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return name || null;
}

// `screen-<first path segment>`, plus the second for games and showtimes so
// each game counts on its own. A movie page counts as `screen-movie`, a friend
// as `screen-film-club-friend`: the id in the path is never sent.
export function screenEvent (path) {
  const segments = String(path || '/').split(/[?#]/)[0].split('/').filter(Boolean);
  if (!segments.length) return 'screen-home';
  const [first, second] = segments;
  if (first === 'games' || first === 'showtimes') return eventName('screen', first, second);
  if (first === 'film-club' && second) return 'screen-film-club-friend';
  return eventName('screen', first);
}

// Counts a screen change, not a query change on the same screen (Home's
// search state and Insights' tabs ride in the query; tabs count themselves).
export function trackScreen (to, from) {
  const name = screenEvent(to?.path);
  if (!name || (from?.matched?.length && screenEvent(from.path) === name)) return;
  trackEvent(name);
}

const readPending = () => {
  try {
    const list = JSON.parse(localStorage.getItem(PENDING_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const writePending = (list) => {
  try {
    if (list.length) localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-MAX_PENDING)));
    else localStorage.removeItem(PENDING_KEY);
  } catch {
    // Storage full or private mode: the count is lost, nothing else.
  }
};

export function flushPendingEvents () {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
  const list = readPending();
  if (!list.length) return;
  writePending([]);
  list.forEach((name) => trackEvent(name));
}

export function trackWhenOnline (name) {
  if (!name) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    writePending([...readPending(), name]);
    return;
  }
  trackEvent(name);
}

// main.js, after trackUsage: anything held from last time goes now, and
// anything held from now on goes when the connection comes back.
export function startUsageEvents () {
  flushPendingEvents();
  window.addEventListener('online', flushPendingEvents);
}
