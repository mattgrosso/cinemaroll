// Bringing a whole Letterboxd history into Cinema Roll (2026-11-14, Matt:
// "It'll be cool if a new user could import their letterbox data"). Pure and
// store-free: the runner (utils/letterboxdImportRun.js) does the TMDB calls
// and the writes; everything that decides WHAT gets written lives here.
//
// Sources, all from Letterboxd's own export (Settings → Import & Export →
// Export your data): diary.csv (one row per logged viewing, with that day's
// stars), ratings.csv (one row per rated film, the film's current stars —
// catches films rated but never diaried), reviews.csv (handled afterwards by
// the existing reviewsCsvToUpdates). None of them carry a TMDB id, so films are
// grouped by title + year and matched by TMDB search.
//
// Stars become a score (Matt approved, 2026-11-14): every criterion is the
// stars doubled, Stickiness (0–5) the stars themselves. With the weights
// summing to 9.05 on the 0–10 criteria and 1.9 on Stickiness, the score works
// out to exactly twice the stars (4★ → 8.00), so the library ranks the way the
// Letterboxd ratings did. Each viewing says it came from Letterboxd, and the
// film page offers to rate it properly.
import { normalizeTitle } from './letterboxdFormat.js';

export const IMPORTED_FROM = 'letterboxd';

// Fields an imported viewing carries that a real rating doesn't. A proper
// re-rate drops them (RateMovie), which is what ends the "rate it" prompt.
export const IMPORT_MARK_FIELDS = ['importedFrom', 'letterboxdStars', 'letterboxdUnrated'];

// No stars anywhere on Letterboxd: the middle, the same values an untouched
// rating form saves, and marked so the film page asks for a real rating.
const UNRATED_STARS = 2.5;

export const starsToCriteria = (stars) => {
  const value = Math.round(Number(stars) * 2);
  return {
    direction: value,
    imagery: value,
    story: value,
    performance: value,
    soundtrack: value,
    love: value,
    overall: value,
    stickiness: value / 2
  };
};

const parseStars = (value) => {
  const stars = Number(value);
  return Number.isFinite(stars) && stars > 0 ? Math.min(5, stars) : null;
};

const parseDay = (value) => (/^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim()) ? String(value).trim() : null);

// Noon local time on the day, so the day never slides across midnight in
// either direction for anyone the app shows it to.
export const dayToEpoch = (day) => {
  const [year, month, date] = day.split('-').map(Number);
  return new Date(year, month - 1, date, 12).getTime();
};

export const epochToDay = (epoch) => {
  const when = new Date(Number(epoch));
  if (Number.isNaN(when.getTime())) return null;
  return when.toLocaleString('sv-SE').slice(0, 10);
};

export const filmKey = (title, year) => `${normalizeTitle(title)}|${Number(year) || ''}`;

/**
 * Diary and ratings rows → one record per film:
 *   { key, title, year, viewings: [{ day, stars }] }
 * Each viewing's stars: its own diary stars, else the film's rating, else the
 * film's most recent rated diary entry, else null (unrated). A film only in
 * ratings.csv gets one viewing on the day it was rated.
 */
export const buildFilmList = ({ diary = [], ratings = [] } = {}) => {
  const films = new Map();
  const filmFor = (row) => {
    const title = String(row.Name || row.Title || '').trim();
    const year = Number(row.Year);
    if (!title) return null;
    const key = filmKey(title, year);
    if (!films.has(key)) {
      films.set(key, { key, title, year: Number.isInteger(year) && year > 0 ? year : null, viewings: [], filmStars: null });
    }
    return films.get(key);
  };

  for (const row of ratings) {
    const film = filmFor(row);
    if (film) film.filmStars = parseStars(row.Rating) ?? film.filmStars;
  }
  for (const row of diary) {
    const film = filmFor(row);
    const day = parseDay(row['Watched Date']) || parseDay(row.Date);
    if (!film || !day) continue;
    film.viewings.push({ day, stars: parseStars(row.Rating) });
  }

  const ratingDays = new Map(ratings.map((row) => [filmKey(row.Name || row.Title, row.Year), parseDay(row.Date)]));
  const list = [];
  for (const film of films.values()) {
    film.viewings.sort((a, b) => a.day.localeCompare(b.day));
    if (!film.viewings.length) {
      const day = ratingDays.get(film.key);
      if (!day) continue;
      film.viewings.push({ day, stars: film.filmStars });
    }
    const latestRated = [...film.viewings].reverse().find((viewing) => viewing.stars != null)?.stars ?? null;
    const fallback = film.filmStars ?? latestRated;
    film.viewings = film.viewings.map((viewing) => ({ day: viewing.day, stars: viewing.stars ?? fallback }));
    delete film.filmStars;
    list.push(film);
  }
  return list.sort((a, b) => a.viewings[0].day.localeCompare(b.viewings[0].day));
};

const yearOf = (result) => {
  const year = Number(String(result?.release_date || '').slice(0, 4));
  return Number.isInteger(year) && year > 0 ? year : null;
};

/**
 * Which TMDB search result is this film? Sure only when the title matches
 * (TMDB's title or original title, normalised) AND the year agrees; several
 * such results → the most popular. Anything less sure comes back with a
 * suggestion (or none) for the "Find the match" list, never a guess written
 * onto the wrong film.
 */
export const pickTmdbMatch = (results, title, year) => {
  const wanted = normalizeTitle(title);
  const list = (results || []).filter((result) => result && Number.isInteger(result.id));
  const titleMatches = (result) => normalizeTitle(result.title) === wanted || normalizeTitle(result.original_title) === wanted;
  const byPopularity = (a, b) => (b.popularity || 0) - (a.popularity || 0);

  if (year) {
    const exact = list.filter((result) => yearOf(result) === year && titleMatches(result)).sort(byPopularity);
    if (exact.length) return { tmdbId: exact[0].id, sure: true };
    const nearby = list.filter((result) => titleMatches(result) && Math.abs((yearOf(result) || 0) - year) === 1).sort(byPopularity);
    if (nearby.length) return { tmdbId: null, sure: false, suggestion: nearby[0] };
    const sameYear = list.find((result) => yearOf(result) === year);
    return { tmdbId: null, sure: false, suggestion: sameYear || null };
  }
  // No year on Letterboxd's side (rare): only a lone exact title is sure.
  const titled = list.filter(titleMatches);
  if (titled.length === 1) return { tmdbId: titled[0].id, sure: true };
  return { tmdbId: null, sure: false, suggestion: titled.sort(byPopularity)[0] || list[0] || null };
};

/** One imported viewing, in the shape RateMovie saves. */
export const viewingToRating = (viewing, { tmdbId, title, year }) => {
  const unrated = viewing.stars == null;
  const stars = unrated ? UNRATED_STARS : viewing.stars;
  const rating = {
    ...starsToCriteria(stars),
    date: dayToEpoch(viewing.day),
    id: tmdbId,
    medium: 'Other',
    title,
    year: year ? String(year) : '',
    tags: [],
    chatGPTKeywords: [],
    importedFrom: IMPORTED_FROM
  };
  if (unrated) rating.letterboxdUnrated = true;
  else rating.letterboxdStars = stars;
  return rating;
};

/**
 * The viewings a film already in the library doesn't have yet — a Letterboxd
 * entry on a day the library already has a viewing is taken to be that one.
 */
export const missingViewings = (existingRatings, viewings) => {
  const have = new Set((existingRatings || []).map((rating) => epochToDay(rating?.date)).filter(Boolean));
  return (viewings || []).filter((viewing) => !have.has(viewing.day));
};

/** Library ratings plus the imported viewings, oldest first. */
export const mergeRatings = (existingRatings, viewings, film) => {
  const added = missingViewings(existingRatings, viewings).map((viewing) => viewingToRating(viewing, film));
  return [...(existingRatings || []), ...added].sort((a, b) => (Number(a.date) || 0) - (Number(b.date) || 0));
};

/** The viewing on a film page that still wants a proper rating, newest first. */
export const importedViewingIndex = (ratings) => {
  const list = ratings || [];
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (list[index]?.importedFrom === IMPORTED_FROM) return index;
  }
  return -1;
};

/** Strips the import marks from a viewing being re-rated by hand. */
export const withoutImportMarks = (rating) => {
  const copy = { ...rating };
  IMPORT_MARK_FIELDS.forEach((field) => { delete copy[field]; });
  return copy;
};

// Which file in the export a name is. They sit at the top of the zip (or one
// folder down, if it was unpacked and zipped again) beside folders like
// deleted/ and likes/, whose same-named files must not be read.
const SKIPPED_FOLDERS = new Set(['deleted', 'likes', 'lists', 'orphaned']);
export const exportFileKind = (name) => {
  const parts = String(name || '').replace(/\\/g, '/').toLowerCase().split('/');
  if (parts.length > 2 || parts.slice(0, -1).some((part) => SKIPPED_FOLDERS.has(part) || part === '__macosx')) return null;
  const base = parts[parts.length - 1];
  if (base === 'diary.csv') return 'diary';
  if (base === 'ratings.csv') return 'ratings';
  if (base === 'reviews.csv') return 'reviews';
  return null;
};

// A lone CSV picked instead of the zip: told apart by its columns.
export const csvKind = (rows) => {
  const columns = Object.keys(rows?.[0] || {});
  if (columns.includes('Review')) return 'reviews';
  if (columns.includes('Watched Date')) return 'diary';
  if (columns.includes('Rating') && columns.includes('Name')) return 'ratings';
  return null;
};

const tmdbIndexOf = (movieLog) => {
  const index = new Map();
  for (const [key, entry] of Object.entries(movieLog || {})) {
    const id = Number(entry?.movie?.id);
    if (Number.isInteger(id) && id > 0 && !index.has(id)) index.set(id, key);
  }
  return index;
};

/**
 * One batch of resolved films → what to write. Items:
 *   { film, kind: 'new', tmdbId, movie }   matched, details fetched
 *   { film, kind: 'merge', tmdbId }        matched to a film already in the library
 *   { film, kind: 'doubtful', suggestion } for the "Find the match" list
 * Returns { entries: [{key, value}] for the local commit, updates: the
 * multi-path update, outcomes: { [film.key]: { status, ... } } }.
 *
 * A film is checked against the library AGAIN here, at write time, and
 * against films created earlier in the same batch: a resumed run, or two
 * Letterboxd titles TMDB calls one film, then add viewings to the one entry
 * instead of making a second.
 */
export const planImportBatch = (items, { movieLog, makeKey }) => {
  const byTmdb = tmdbIndexOf(movieLog);
  const working = new Map(); // key -> entry value being built in this batch
  const created = new Set();
  const outcomes = {};

  for (const item of items) {
    const { film } = item;
    if (item.kind === 'doubtful') {
      const suggestion = item.suggestion
        ? { id: item.suggestion.id, title: item.suggestion.title, release_date: item.suggestion.release_date || '', poster_path: item.suggestion.poster_path || null }
        : null;
      outcomes[film.key] = { status: 'doubtful', suggestion };
      continue;
    }
    const tmdbId = Number(item.tmdbId);
    const context = { tmdbId, title: item.movie?.title || film.title, year: film.year };
    const key = byTmdb.get(tmdbId);
    if (key) {
      const current = working.get(key) || movieLog[key];
      const ratings = mergeRatings(current.ratings, film.viewings, context);
      const added = ratings.length - (current.ratings || []).length;
      if (added > 0) working.set(key, { ...current, ratings });
      outcomes[film.key] = { status: 'done', tmdbId, dbKey: key, added, created: false };
      continue;
    }
    if (item.kind !== 'new' || !item.movie) {
      outcomes[film.key] = { status: 'failed' };
      continue;
    }
    const newKey = makeKey(item.movie.title || film.title);
    const ratings = mergeRatings([], film.viewings, context);
    working.set(newKey, { movie: item.movie, ratings });
    created.add(newKey);
    byTmdb.set(tmdbId, newKey);
    outcomes[film.key] = { status: 'done', tmdbId, dbKey: newKey, added: ratings.length, created: true };
  }

  const entries = [];
  const updates = {};
  for (const [key, value] of working) {
    entries.push({ key, value });
    if (created.has(key)) updates[`movieLog/${key}`] = value;
    else updates[`movieLog/${key}/ratings`] = value.ratings;
  }
  return { entries, updates, outcomes };
};
