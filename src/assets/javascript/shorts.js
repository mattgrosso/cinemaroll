// The one short-film rule, and the one filter every screen goes through.
//
// Bug report 2026-09-29: "the one that says number in a day shouldn't
// include shorts if I have shorts turned off, and in fact that should be
// true of all things everywhere." The setting was honoured by Home, the
// games and a handful of stats, each with its own copy of the rule (two
// copies also counted TMDB's "Short" genre, so a screen could disagree with
// Home about what a short was). Everything now asks here.
//
// A short is anything 40 minutes or under — the cutoff Home has always used.
// Unknown runtime (missing, or TMDB's 0) is NOT a short: a placeholder entry
// with no runtime yet must not vanish while the setting is off.

export const SHORT_RUNTIME = 40;

export function isShort (movie) {
  return Boolean(movie?.runtime && movie.runtime <= SHORT_RUNTIME);
}

export function isShortEntry (entry) {
  return isShort(entry?.movie);
}

// Keyed on the source array's identity (a cached Vuex getter, or a table
// memoized on one), so a remount or a second screen gets the same filtered
// array back. A WeakMap rather than memoByIdentity's single slot: several
// different library arrays pass through here, and they'd evict each other.
const filtered = new WeakMap();

// The library as the "include shorts" setting says to see it.
export function withoutShorts (entries, includeShorts = false) {
  if (!Array.isArray(entries)) return [];
  if (includeShorts) return entries;
  let result = filtered.get(entries);
  if (!result) {
    result = entries.filter((entry) => !isShortEntry(entry));
    filtered.set(entries, result);
  }
  return result;
}

// Settings default to shorts OFF — only an explicit true includes them.
export function includeShortsSetting (state) {
  return state?.settings?.includeShorts === true;
}
