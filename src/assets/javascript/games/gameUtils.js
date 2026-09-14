// Shared, store-free helpers for the Games section (src/components/games/).
// Kept pure/testable on purpose — see the "Search/Filter/Sort Extraction"
// precedent in CLAUDE.md: logic modules take explicit inputs, components stay
// thin wiring layers.

// A movie needs a poster (games are poster-driven), a release date (used for
// year/decade clues and sorting games), and at least one rating (nothing to
// guess/compare/rank otherwise) to be usable by any game. Also respects the
// user's "include shorts" library setting (default excluded) — same
// runtime<=40min threshold Home.vue's own filtering uses — so a short that's
// hidden everywhere else on the site doesn't still turn up in a game.
export function getEligibleEntries (allMediaAsArray, includeShorts = false) {
  return (allMediaAsArray || []).filter((entry) => {
    const isEligible = Boolean(
      entry &&
      entry.movie &&
      entry.movie.poster_path &&
      entry.movie.release_date &&
      Array.isArray(entry.ratings) &&
      entry.ratings.length > 0
    );
    if (!isEligible) return false;
    if (includeShorts) return true;
    return !(entry.movie.runtime && entry.movie.runtime <= 40);
  });
}

export function ratingFor (entry, getRatingFn) {
  if (!entry) return 0;
  const rating = getRatingFn(entry);
  return (rating && typeof rating.calculatedTotal === 'number') ? rating.calculatedTotal : 0;
}

// djb2-ish string hash -> unsigned 32-bit int. Deterministic across
// browsers/sessions, which is what lets the "daily" games pick the same
// puzzle for everyone on the same calendar day without any server.
export function hashString (str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash * 33) ^ str.charCodeAt(i)) >>> 0;
  }
  return hash >>> 0;
}

// mulberry32 PRNG. Small, fast, good-enough distribution for a guessing
// game (not cryptographic). Returns a function you call repeatedly for a
// stream of [0, 1) values seeded from a single integer.
export function makeSeededRng (seed) {
  let state = seed >>> 0;
  return function next () {
    state |= 0;
    state = (state + 0x6D2B79F5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle (array, rng = Math.random) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function pickRandomDistinct (array, count, rng = Math.random) {
  return shuffle(array, rng).slice(0, count);
}

export function movieYear (entry) {
  if (!entry?.movie?.release_date) return null;
  const year = new Date(entry.movie.release_date).getFullYear();
  return Number.isNaN(year) ? null : year;
}

export function movieDecade (entry) {
  const year = movieYear(entry);
  return year ? Math.floor(year / 10) * 10 : null;
}

export function movieDirectors (entry) {
  const crew = entry?.movie?.crew || [];
  return crew.filter((member) => member.job === 'Director').map((member) => member.name);
}

// Loose substring match on the raw TMDB job string — same convention
// MovieDetail.vue's getCrewMember(job) uses for its non-strict mode (e.g.
// 'Photo' matches "Director of Photography"). `movie.crew` is saved
// unfiltered by job at rating time (every TMDB crew credit is kept), so
// this is the only place job-type extraction actually happens.
export function movieCrewByJob (entry, jobSubstring) {
  const crew = entry?.movie?.crew || [];
  return crew.filter((member) => member.job?.includes(jobSubstring)).map((member) => member.name);
}

export function movieWriters (entry) {
  return movieCrewByJob(entry, 'Writer');
}

export function movieComposers (entry) {
  return movieCrewByJob(entry, 'Composer');
}

export function movieCinematographers (entry) {
  return movieCrewByJob(entry, 'Photo');
}

export function movieEditors (entry) {
  return movieCrewByJob(entry, 'Editor');
}

export function movieProducers (entry) {
  return movieCrewByJob(entry, 'Producer');
}

export function movieCastNames (entry, limit = 6) {
  const cast = entry?.movie?.cast || [];
  return cast.slice(0, limit).map((member) => member.name);
}

export function movieGenreNames (entry) {
  return (entry?.movie?.genres || []).map((genre) => genre.name);
}

// Bug report: "if the title is The Old Man and the Gun, if I type gun it
// shows it, if I type man it shows it, but if I type 'man gun' it's not
// finding it." Every whitespace-separated token must appear somewhere in
// the candidate text, in any order — looser than one contiguous substring,
// stricter than a distance-based fuzzy match (typos still don't match,
// which is fine: game suggestions come from the player's own library, so
// what needs correcting is word order and partial recall, not spelling).
// Used by every game typeahead.
export function matchesAllTokens (text, term) {
  const haystack = typeaheadText(text);
  const tokens = typeaheadText(term).split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  return tokens.every((token) => haystack.includes(token));
}

// The combining-marks block, as escapes (the literal characters are
// invisible in an editor).
const COMBINING_MARKS = /[\u0300-\u036f]/g;

// What the game typeaheads compare: lowercased, accents dropped, and
// typographic compatibility characters spelled out. NFKD (not NFD) is the
// point: it turns "½" into "1⁄2", so "8½" — TMDB's title for Fellini's film
// — can be found by typing "8 1/2" as well as "8" (report -P1Px9lCmg, 2026-
// 09-13: "the movie 8 1/2 ... when I type an eight it didn't come up"). The
// fraction slash it produces is folded to a plain one, which is the key
// people have.
export function typeaheadText (value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(/\u2044/g, '/')
    .toLowerCase();
}

/**
 * The game typeaheads' shared ranking: every entry whose title matches
 * every typed token, best matches first, capped.
 *
 * A one-character term is allowed. The typeaheads used to demand two, which
 * made any title that IS one character unreachable — "8½" was the report,
 * and "M", "Us", "Pi" and "9" are the same shape. With one character the
 * list would be nearly everything, so order does the work instead: titles
 * that START with the term come first, then titles with a word starting
 * with it, then anything containing it. Ties keep library order.
 */
export function rankTitleMatches (entries, term, { textOf = (entry) => entry?.movie?.title, limit = 8 } = {}) {
  const needle = typeaheadText(term).trim();
  if (!needle) return [];
  const tier = (text) => {
    const title = typeaheadText(text);
    if (title.startsWith(needle)) return 0;
    if (title.split(/\s+/).some((word) => word.startsWith(needle))) return 1;
    return 2;
  };
  return (entries || [])
    .map((entry, index) => ({ entry, index, text: textOf(entry) }))
    .filter(({ text }) => matchesAllTokens(text, needle))
    .map((row) => ({ ...row, tier: tier(row.text) }))
    .sort((a, b) => (a.tier - b.tier) || (a.index - b.index))
    .slice(0, limit)
    .map(({ entry }) => entry);
}

// Stable identity for a db entry across the games modules — prefers the
// Firebase dbKey (unique per rating entry), falling back to the TMDB movie
// id for entries that don't carry one (e.g. synthetic test fixtures).
export function entryKey (entry) {
  return entry?.dbKey || entry?.movie?.id;
}

// Compares two numbers and describes which way `guessValue` needs to move to
// reach `targetValue` — the vocabulary Wordle-style clue UIs need ("guess
// higher" / "guess lower" / exact match). Returns null direction when either
// value is missing (nothing sensible to compare).
export function compareNumber (guessValue, targetValue) {
  if (guessValue == null || targetValue == null) {
    return { value: guessValue, direction: null, match: false };
  }
  if (guessValue === targetValue) {
    return { value: guessValue, direction: 'match', match: true };
  }
  return { value: guessValue, direction: guessValue < targetValue ? 'up' : 'down', match: false };
}
