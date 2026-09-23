// The last Home the user saw, as inert HTML, so the next launch can paint
// it while the real one is being built.
//
// A warm relaunch reads the library snapshot in ~0.1s but Home's first
// render (entries, counts, sort, 25+ cards) is ~0.9s at phone speed, and
// until then the screen is a header over nothing (2026-09-23 speed sweep,
// relaunch phases). Native apps hide this with a launch image of the last
// screen; this is that. The block is pointer-events:none and swapped for
// the live grid in the same paint that grid arrives in, so nothing here is
// ever tappable or stale for more than the launch itself.
const KEY_PREFIX = 'cinemaRoll.homePaint.';
const MAX_BYTES = 900 * 1024;

const storage = () => {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

/** Serialise the search bar and results grid of a mounted Home root. */
export function captureHomePaint (root) {
  if (!root) return null;
  // Home has two .results blocks: the actions row, then the grid itself.
  const parts = [root.querySelector('.search-bar'), ...root.querySelectorAll('.results')].filter(Boolean);
  if (parts.length < 2 || !root.querySelector('.results .grid-layout, .results ul')) return null;
  const html = parts.map((el) => el.outerHTML).join('');
  if (!html || html.length > MAX_BYTES) return null;
  // No ids (the live grid will use them), no lazy-load state (the poster
  // arrive animation keys off it), no images still on their placeholder.
  return html
    .replace(/\s(id|lazy)="[^"]*"/g, '')
    .replace(/\sdata-v-[a-z0-9]+=""/g, (m) => m);
}

export function saveHomePaint (topKey, html) {
  const store = storage();
  if (!store || !topKey || !html) return false;
  try {
    store.setItem(KEY_PREFIX + topKey, html);
    return true;
  } catch {
    return false;
  }
}

export function loadHomePaint (topKey) {
  const store = storage();
  if (!store || !topKey) return null;
  try {
    return store.getItem(KEY_PREFIX + topKey) || null;
  } catch {
    return null;
  }
}

export function clearHomePaint (topKey) {
  const store = storage();
  if (!store || !topKey) return;
  try {
    store.removeItem(KEY_PREFIX + topKey);
  } catch { /* nothing to clear */ }
}
