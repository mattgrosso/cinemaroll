// A small keyed cache kept in localStorage, aged and capped.
//
// The Watchlist asks TMDB the same questions on every open — a favourite
// director's filmography, a favourite film's recommendations, a film's
// runtime — and gets the same answers. Sentry flagged that as an N+1 twice
// (2026-10-06, and again 2026-10-08 after personIdCache.js only took the
// name searches away). This keeps the answers on the device for a while.
//
// Same reasoning as personIdCache.js: localStorage, not the database — a
// per-device convenience that costs nothing if it vanishes and never costs
// a write. Callers trim what they store to what they show.
export function deviceCache (storageKey, { maxAgeMs, maxEntries }) {
  let memory = null;

  function load () {
    if (memory) return memory;
    try {
      const parsed = JSON.parse(localStorage.getItem(storageKey) || 'null');
      memory = parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      memory = {};
    }
    return memory;
  }

  function save () {
    try {
      localStorage.setItem(storageKey, JSON.stringify(memory));
    } catch {
      // Full or unavailable: the in-memory copy still saves this visit's repeats.
    }
  }

  return {
    /** The stored value for `key`, or undefined if missing or too old. */
    get (key, now = Date.now()) {
      const entry = load()[key];
      if (!entry || now - (entry.at || 0) > maxAgeMs) return undefined;
      return entry.value;
    },
    set (key, value, now = Date.now()) {
      this.setMany([[key, value]], now);
    },
    /** Several at once: one write to localStorage, not one per entry. */
    setMany (pairs, now = Date.now()) {
      const entries = load();
      let changed = false;
      (pairs || []).forEach(([key, value]) => {
        if (key == null || value === undefined) return;
        entries[key] = { value, at: now };
        changed = true;
      });
      if (!changed) return;
      const keys = Object.keys(entries);
      if (keys.length > maxEntries) {
        keys
          .sort((a, b) => (entries[a].at || 0) - (entries[b].at || 0))
          .slice(0, keys.length - maxEntries)
          .forEach((stale) => { delete entries[stale]; });
      }
      save();
    },
    /** Tests, and nothing else: the cache would otherwise leak between cases. */
    clear () {
      memory = {};
      try {
        localStorage.removeItem(storageKey);
      } catch {
        // Nothing to forget.
      }
    }
  };
}
