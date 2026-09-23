// Places: what the library's Wikidata locations (movieLocations.js) add up
// to. Pure and store-free, tested directly.
//
// Matt, 2026-09-08, on what he wanted from a second attempt: "I just think
// it would be fun to be able to see what movies are set where. Seeing that I
// really like movies set in Paris would be cool." So this file answers two
// questions — how often does each place come up, and how do the films set
// or shot there RATE — and leaves the drawing to CoverageMap.vue.
//
// A location is `{ name, lat, lon, type, id }` with type 'filming' (P915,
// where it was shot) or 'narrative' (P840, where the story is set). The two
// are kept apart all the way to the screen: "set in Paris" and "filmed in
// Paris" are different facts, and the report asked for both.

import { countryForPoint, countryForIso, isPointResolved } from './countryLookup.js';
import { memoByIdentity } from '../../utils/memoByIdentity.js';

export const PLACE_TYPES = { FILMING: 'filming', NARRATIVE: 'narrative' };

// How hard a place's average is pulled toward the library average before it
// is ranked. Two films at 9.5 should not outrank twelve at 9.0 — this is
// the same shrinkage idea the Favorite sections and Deep Stats use, sized
// small because a place with three films is already a real pattern.
export const RANK_SHRINK = 2;

/**
 * A movie's locations as an array, whatever shape they came back from
 * Firebase in (an array, or an object with numeric keys after a partial
 * update). Entries missing a name or a type are dropped.
 */
export function movieLocations (movie) {
  const raw = movie?.locations;
  const list = Array.isArray(raw) ? raw : Object.values(raw || {});
  return list.filter((location) => location && typeof location.name === 'string' && location.name &&
    (location.type === PLACE_TYPES.FILMING || location.type === PLACE_TYPES.NARRATIVE));
}

function matchesType (location, type) {
  return type === 'all' || !type || location.type === type;
}

/** Distinct place names on one movie, in stored order. */
export function placeNames (movie, type = 'all') {
  const seen = new Set();
  const names = [];
  movieLocations(movie).forEach((location) => {
    if (!matchesType(location, type) || seen.has(location.name)) return;
    seen.add(location.name);
    names.push(location.name);
  });
  return names;
}

function isShort (movie) {
  return Boolean(movie?.runtime && movie.runtime <= 40);
}

function eligible (entries, includeShorts) {
  return (entries || []).filter((entry) => entry?.movie && (includeShorts || !isShort(entry.movie)));
}

/**
 * One row per distinct place: how many films, and how they rate. A film
 * counts once per place however many times the place appears on it (a city
 * that is both filming and narrative location is still one film).
 *
 * Rows carry `average` (what's shown) and `rank` (what's sorted on when
 * ranking by love — the average shrunk toward the library's own, see
 * RANK_SHRINK), plus the coordinates of the first sighting so a caller can
 * put the place on a map.
 */
export function placeRows (entries, getRating, { type = 'all', includeShorts = false } = {}) {
  const library = eligible(entries, includeShorts);
  const scores = library
    .map((entry) => getRating(entry)?.calculatedTotal)
    .filter(Number.isFinite);
  const libraryAverage = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;

  const byPlace = new Map();
  library.forEach((entry) => {
    const score = getRating(entry)?.calculatedTotal;
    if (!Number.isFinite(score)) return;
    const seen = new Set();
    movieLocations(entry.movie).forEach((location) => {
      if (!matchesType(location, type)) return;
      const key = location.id || location.name;
      if (seen.has(key)) return;
      seen.add(key);
      const row = byPlace.get(key) || {
        key,
        name: location.name,
        lat: location.lat,
        lon: location.lon,
        films: 0,
        sum: 0,
        best: null
      };
      row.films += 1;
      row.sum += score;
      if (!row.best || score > row.best.score) {
        row.best = { score, title: entry.movie.title, id: entry.movie.id, poster: entry.movie.poster_path || null };
      }
      byPlace.set(key, row);
    });
  });

  return [...byPlace.values()].map((row) => {
    const average = row.sum / row.films;
    return {
      key: row.key,
      name: row.name,
      lat: row.lat,
      lon: row.lon,
      films: row.films,
      average,
      rank: (row.sum + RANK_SHRINK * libraryAverage) / (row.films + RANK_SHRINK),
      best: row.best
    };
  });
}

/**
 * "I really like movies set in Paris": places ranked by how well their films
 * rate, among places with at least `minFilms` — one great film is a film,
 * not a place.
 */
export function favouritePlaces (rows, { minFilms = 3, limit = 12 } = {}) {
  return rows
    .filter((row) => row.films >= minFilms)
    .sort((a, b) => (b.rank - a.rank) || (b.films - a.films) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** Places by how often they come up, ties broken by rating. */
export function mostVisitedPlaces (rows, { limit = 12 } = {}) {
  return [...rows]
    .sort((a, b) => (b.films - a.films) || (b.average - a.average) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

/** How much of the library the places cover, for a summary line. */
export function placeSummary (entries, { type = 'all', includeShorts = false } = {}) {
  const library = eligible(entries, includeShorts);
  let movies = 0;
  const places = new Set();
  library.forEach((entry) => {
    const names = placeNames(entry.movie, type);
    if (!names.length) return;
    movies += 1;
    names.forEach((name) => places.add(name));
  });
  return { movies, places: places.size, library: library.length };
}

/**
 * "How much of the world I've explored in film": every country the library
 * touches, with how. A film touches a country by being set there, being
 * shot there (each place resolved through countryLookup — the stored
 * locations carry no country of their own), or being MADE there (TMDB's
 * production countries, an ISO code, joined directly).
 *
 * `type` narrows set/filmed to one kind; made-in is included only for 'all',
 * since a production country is neither. Returns
 *   { rows: [{ iso, name, films, setIn, filmedIn, madeIn, places }],
 *     counts: { [iso]: films }, touched, total }
 * where `films` is distinct films, `places` the country's own places by
 * film count, `touched` how many countries have any film and `total` how
 * many the map knows about.
 */
export function countryCoverage (entries, world, { type = 'all', includeShorts = false } = {}) {
  return countryCoverageMemo(entries, world, type, includeShorts);
}

/**
 * Resolve every place in the library to a country ahead of time, in idle
 * slices, so the Places tab opens on a warm cache instead of doing 3.5s of
 * polygon tests (phone speed) while the user waits. countryForPoint keeps
 * the answers for the life of the page, so this is pure prep: whatever it
 * hasn't reached when the tab opens is resolved synchronously as before.
 * Returns a cancel function.
 */
export function warmCountryLookup (entries, world, { sliceMs = 6, schedule = null } = {}) {
  if (!world) return () => {};
  const pending = [];
  const seen = new Set();
  (entries || []).forEach((entry) => {
    movieLocations(entry.movie).forEach((location) => {
      if (!Number.isFinite(location.lat) || !Number.isFinite(location.lon)) return;
      const key = `${location.lat},${location.lon}`;
      if (seen.has(key) || isPointResolved(location.lat, location.lon, world)) return;
      seen.add(key);
      pending.push(location);
    });
  });
  let cancelled = false;
  const later = schedule || ((fn) => (typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 50)));
  const step = () => {
    if (cancelled) return;
    const started = Date.now();
    while (pending.length && Date.now() - started < sliceMs) {
      const location = pending.shift();
      countryForPoint(location.lat, location.lon, world);
    }
    if (pending.length) later(step);
  };
  if (pending.length) later(step);
  return () => { cancelled = true; };
}

const countryCoverageMemo = memoByIdentity((entries, world, type, includeShorts) => {
  const byIso = new Map();
  const row = (country) => {
    const existing = byIso.get(country.iso);
    if (existing) return existing;
    const created = {
      iso: country.iso,
      name: country.name,
      filmIds: new Set(),
      setIn: new Set(),
      filmedIn: new Set(),
      madeIn: new Set(),
      placeFilms: new Map()
    };
    byIso.set(country.iso, created);
    return created;
  };
  // countryForPoint caches per point for the life of the page (see
  // countryLookup.js), so no per-call cache is needed here any more.
  const resolve = (location) => {
    const hit = Number.isFinite(location.lat) && Number.isFinite(location.lon)
      ? countryForPoint(location.lat, location.lon, world)
      : null;
    return hit && hit.iso ? hit : null;
  };

  eligible(entries, includeShorts).forEach((entry) => {
    const movie = entry.movie;
    const filmId = movie.id ?? entry.dbKey;
    movieLocations(movie).forEach((location) => {
      if (!matchesType(location, type)) return;
      const country = resolve(location);
      if (!country) return;
      const target = row(country);
      target.filmIds.add(filmId);
      (location.type === PLACE_TYPES.NARRATIVE ? target.setIn : target.filmedIn).add(filmId);
      const placeKey = location.name;
      const films = target.placeFilms.get(placeKey) || new Set();
      films.add(filmId);
      target.placeFilms.set(placeKey, films);
    });
    if (type === 'all') {
      (movie.production_countries || []).forEach((made) => {
        const country = countryForIso(made?.iso_3166_1, world);
        if (!country || !country.iso) return;
        const target = row(country);
        target.filmIds.add(filmId);
        target.madeIn.add(filmId);
      });
    }
  });

  const rows = [...byIso.values()].map((r) => ({
    iso: r.iso,
    name: r.name,
    films: r.filmIds.size,
    setIn: r.setIn.size,
    filmedIn: r.filmedIn.size,
    madeIn: r.madeIn.size,
    places: [...r.placeFilms.entries()]
      .map(([name, films]) => ({ name, films: films.size }))
      .sort((a, b) => (b.films - a.films) || a.name.localeCompare(b.name))
  })).sort((a, b) => (b.films - a.films) || a.name.localeCompare(b.name));

  const counts = {};
  rows.forEach((r) => { counts[r.iso] = r.films; });
  return {
    rows,
    counts,
    touched: rows.length,
    total: (world?.countries || []).filter((c) => c.iso).length
  };
});
