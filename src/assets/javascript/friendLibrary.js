// A friend's whole library, browsable (Matt, 2026-11-13, from a friend's
// Film Club page: "look through one of my friends … whole library and …
// search by year or by genre or by whatever category I want").
//
// The data was already on the phone: a friend who shares scores publishes a
// `ratings` map with every film they've rated (title, poster, score, when).
// What it lacked was anything to cut it BY, so since this date the publisher
// adds a few compact fields per film (see filmFacetsFrom, used by
// buildSocialProfile):
//   y  — release year
//   g  — TMDB genre ids (numbers: far smaller than names; GENRE_NAMES maps back)
//   d  — directors, at most two names
//   sh — 1 when the film is a short (the app's rule, shorts.js)
// A friend who hasn't reopened the app since publishes none of them, so every
// reader falls back to MY library's copy of the same film (same TMDB id, same
// facts) and otherwise simply has no year/genre/director for that film.
//
// Everything here is pure; FriendComparison renders it.

import { isShort } from './shorts.js';
import { normalizeSearchText } from './searchText.js';

// TMDB's movie genres (and the TV ones a library can hold), id -> name.
export const GENRE_NAMES = Object.freeze({
  28: 'Action',
  12: 'Adventure',
  16: 'Animation',
  35: 'Comedy',
  80: 'Crime',
  99: 'Documentary',
  18: 'Drama',
  10751: 'Family',
  14: 'Fantasy',
  36: 'History',
  27: 'Horror',
  10402: 'Music',
  9648: 'Mystery',
  10749: 'Romance',
  878: 'Science Fiction',
  10770: 'TV Movie',
  53: 'Thriller',
  10752: 'War',
  37: 'Western',
  10759: 'Action & Adventure',
  10762: 'Kids',
  10763: 'News',
  10764: 'Reality',
  10765: 'Sci-Fi & Fantasy',
  10766: 'Soap',
  10767: 'Talk',
  10768: 'War & Politics'
});

const MAX_DIRECTORS = 2;

// Straight from the text: `new Date('2010-01-01')` is UTC midnight, which
// reads as 2009 anywhere west of Greenwich.
function yearOf (date) {
  const match = /^(\d{4})/.exec(String(date ?? ''));
  const year = match ? Number(match[1]) : null;
  return year > 0 ? year : null;
}

function directorsOf (crew) {
  if (!Array.isArray(crew)) return [];
  const names = [];
  crew.forEach((person) => {
    if (person?.job === 'Director' && person.name && !names.includes(person.name)) names.push(person.name);
  });
  return names.slice(0, MAX_DIRECTORS);
}

/**
 * The compact facts a publisher adds to one film's row. Only fields with a
 * value are present, so an unknown never reads as a zero or an empty list.
 */
export function filmFacetsFrom (movie) {
  const out = {};
  if (!movie) return out;
  const year = yearOf(movie.release_date ?? movie.first_air_date);
  if (year) out.y = year;
  const genres = (movie.genres || [])
    .map((genre) => Number(genre?.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (genres.length) out.g = genres;
  const directors = directorsOf(movie.crew);
  if (directors.length) out.d = directors;
  if (isShort(movie)) out.sh = 1;
  return out;
}

function viewingYears (row) {
  const times = Array.isArray(row?.v) && row.v.length
    ? row.v.map((view) => Number(view?.at))
    : [Number(row?.at)];
  return [...new Set(times.filter(Number.isFinite).map((at) => new Date(at).getFullYear()))];
}

/**
 * The friend's ratings map as display rows, joined to my library for any fact
 * their copy doesn't carry yet. `myLibrary` is my entries array.
 */
export function friendLibraryRows (profile, myLibrary = []) {
  const ratings = profile?.ratings;
  if (!ratings || typeof ratings !== 'object') return [];
  const mine = new Map();
  (myLibrary || []).forEach((entry) => {
    const id = entry?.movie?.id;
    if (id != null) mine.set(String(id), entry.movie);
  });

  return Object.entries(ratings).map(([id, row]) => {
    if (!row || !Number.isFinite(Number(row.r))) return null;
    const fallback = filmFacetsFrom(mine.get(String(id)));
    const year = Number(row.y) || fallback.y || null;
    const genreIds = Array.isArray(row.g) && row.g.length ? row.g : (fallback.g || []);
    const directors = Array.isArray(row.d) && row.d.length ? row.d : (fallback.d || []);
    const short = row.sh === 1 || (row.sh == null && fallback.sh === 1);
    return {
      id: Number(id),
      title: row.t || '',
      poster: row.p || null,
      score: Number(row.r),
      stars: Number.isFinite(row.s) ? row.s : null,
      at: Number.isFinite(Number(row.at)) && row.at != null ? Number(row.at) : null,
      year,
      decade: year ? Math.floor(year / 10) * 10 : null,
      genres: genreIds.map((gid) => GENRE_NAMES[gid]).filter(Boolean),
      directors: directors.filter((name) => typeof name === 'string' && name),
      watchedYears: viewingYears(row),
      short
    };
  }).filter(Boolean);
}

// The categories you can cut by, in the order the chips show them.
export const FACETS = [
  { key: 'watched', label: 'Watched in' },
  { key: 'decade', label: 'Decade' },
  { key: 'year', label: 'Year' },
  { key: 'genre', label: 'Genre' },
  { key: 'director', label: 'Director' }
];

function valuesFor (row, facet) {
  switch (facet) {
    case 'watched': return row.watchedYears;
    case 'decade': return row.decade ? [row.decade] : [];
    case 'year': return row.year ? [row.year] : [];
    case 'genre': return row.genres;
    case 'director': return row.directors;
    default: return [];
  }
}

export function facetValueLabel (facet, value) {
  if (facet === 'decade') return `${value}s`;
  return String(value);
}

/**
 * Every value a facet takes across the rows, with counts. Years and decades
 * newest first; genres and directors most-watched first (directors only once
 * they have two films — a list of 600 one-offs is no way to browse).
 */
export function facetOptions (rows, facet) {
  const counts = new Map();
  (rows || []).forEach((row) => {
    valuesFor(row, facet).forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  });
  let options = [...counts.entries()].map(([value, count]) => ({ value, count, label: facetValueLabel(facet, value) }));
  if (facet === 'watched' || facet === 'decade' || facet === 'year') {
    options.sort((a, b) => b.value - a.value);
  } else {
    if (facet === 'director') options = options.filter((option) => option.count >= 2);
    options.sort((a, b) => b.count - a.count || String(a.value).localeCompare(String(b.value)));
  }
  return options;
}

export const SORTS = [
  { key: 'score', label: 'Their score' },
  { key: 'watched', label: 'Recently watched' },
  { key: 'released', label: 'Release year' },
  { key: 'title', label: 'Title' }
];

function matchesQuery (row, query) {
  if (!query) return true;
  const haystack = normalizeSearchText([row.title, row.year, ...row.genres, ...row.directors].filter(Boolean).join(' '));
  return query.split(/\s+/).filter(Boolean).every((word) => haystack.includes(word));
}

/**
 * Rows narrowed by the search box, the chosen chips (every chip must match;
 * `[{facet, value}]`) and the shorts setting, then sorted. Never mutates
 * `rows`.
 */
export function filterFriendLibrary (rows, { query = '', chips = [], includeShorts = false, sort = 'score' } = {}) {
  const needle = normalizeSearchText(String(query || '').trim());
  const kept = (rows || []).filter((row) =>
    (includeShorts || !row.short) &&
    chips.every((chip) => valuesFor(row, chip.facet).includes(chip.value)) &&
    matchesQuery(row, needle)
  );
  const byTitle = (a, b) => a.title.localeCompare(b.title);
  const comparators = {
    score: (a, b) => b.score - a.score || byTitle(a, b),
    watched: (a, b) => (b.at || 0) - (a.at || 0) || byTitle(a, b),
    released: (a, b) => (b.year || 0) - (a.year || 0) || b.score - a.score,
    title: byTitle
  };
  return kept.sort(comparators[sort] || comparators.score);
}
