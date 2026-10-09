// Geographic data for movies, sourced from Wikidata.
//
// Second attempt (2026-09-08). The first (Aug 2026) was built around drawing
// maps and was taken out; this file survived it verbatim because the DATA was
// the part that worked — see docs/history/geography-removed.md. Place
// counting, ranking and the country roll-up live in places.js; this file is
// only the fetch and the backfill.
//
// Wikidata is CC0, so unlike most film datasets there are no reuse
// restrictions at all. It joins directly to what we already store: property
// P4947 is the TMDB movie ID, so no fuzzy title matching is needed (measured
// at 99% match against the real library).
//
//   P915 - filming location   (where it was shot)
//   P840 - narrative location (where the story is set)
//   P625 - coordinate location, read off the location item itself
//
// Both are worth having and they answer different questions, so they're kept
// distinct all the way through to the UI rather than merged.
//
// Pure and store-free, in the same spirit as backfillBoxOffice.js /
// searchFiltering.js - persistence is injected so this can be unit tested
// without mounting anything or touching Vuex.

const WDQS_ENDPOINT = 'https://query.wikidata.org/sparql';

// SPARQL VALUES blocks let us ask about many films in one request, which is
// the whole reason this backfill is fast: ~1,400 movies is about 7 requests,
// not 1,400. Kept well under the endpoint's complexity/timeout limits.
export const ID_BATCH_SIZE = 200;

// Every network call gets a deadline (data-writes rules). Longer than the
// app-wide 8s because a 200-id batch legitimately takes a few seconds, and
// deliberately not fetchWithTimeout: a slow Wikidata must not mark the whole
// app offline.
export const LOOKUP_TIMEOUT_MS = 20000;

// Bounds the stored payload. Nothing realistically has this many distinct
// mapped places, but a runaway item shouldn't bloat every movie record.
export const MAX_LOCATIONS_PER_MOVIE = 30;

export const LOCATION_TYPES = { FILMING: 'filming', NARRATIVE: 'narrative' };

export function buildLocationsQuery (tmdbIds) {
  const values = tmdbIds.map((id) => `"${id}"`).join(' ');

  // One row per (film, place, type), with the property itself bound from a
  // VALUES block so each row carries its own type.
  //
  // This shape is deliberate and was arrived at by measurement. The obvious
  // `{ ?film wdt:P915 ?place } UNION { ?film wdt:P840 ?place }` version
  // TIMES OUT on the live endpoint even at two ids — the planner won't push
  // the id constraint into both branches. Binding the predicate instead runs
  // a 200-id batch in ~2.4s. If you change this query, re-measure it against
  // query.wikidata.org rather than assuming.
  return `SELECT ?tmdb ?type ?place ?placeLabel ?coord WHERE {
  VALUES ?tmdb { ${values} }
  VALUES (?prop ?type) { (wdt:P915 "${LOCATION_TYPES.FILMING}") (wdt:P840 "${LOCATION_TYPES.NARRATIVE}") }
  ?film wdt:P4947 ?tmdb ; ?prop ?place .
  ?place wdt:P625 ?coord .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
}

// WDQS returns coordinates as WKT, e.g. "Point(-118.24368 34.05223)" -
// longitude FIRST, which is the opposite order from how they're almost always
// written and an easy thing to get backwards.
export function parsePoint (wkt) {
  const match = /^Point\(\s*(-?[\d.]+)\s+(-?[\d.]+)\s*\)$/.exec(wkt || '');
  if (!match) {
    return null;
  }

  const lon = Number(match[1]);
  const lat = Number(match[2]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return null;
  }

  return { lat, lon };
}

// Wikidata entity URI -> bare id, so we store "Q60" rather than the full URL.
function entityId (uri) {
  const match = /\/(Q\d+)$/.exec(uri || '');
  return match ? match[1] : null;
}

/**
 * Turn a SPARQL JSON response into { [tmdbId]: [location, ...] }.
 *
 * Deduped by (place, type): a place can legitimately be both a filming and a
 * narrative location for the same film, and those are two different facts
 * worth showing, so only exact repeats are collapsed.
 */
export function parseLocationsResponse (json) {
  const rows = json?.results?.bindings || [];
  const byMovie = {};
  const seen = {};

  rows.forEach((row) => {
    const tmdbId = row?.tmdb?.value;
    const point = parsePoint(row?.coord?.value);
    const name = row?.placeLabel?.value;
    const type = row?.type?.value;

    if (!tmdbId || !point || !name) {
      return;
    }
    // An unlabelled item falls back to its own Q-id, which is noise, not a
    // place name.
    if (/^Q\d+$/.test(name)) {
      return;
    }

    const id = entityId(row?.place?.value);
    const dedupeKey = `${tmdbId}|${id || name}|${type}`;
    if (seen[dedupeKey]) {
      return;
    }
    seen[dedupeKey] = true;

    byMovie[tmdbId] = byMovie[tmdbId] || [];
    if (byMovie[tmdbId].length < MAX_LOCATIONS_PER_MOVIE) {
      byMovie[tmdbId].push({ name, lat: point.lat, lon: point.lon, type, id });
    }
  });

  return byMovie;
}

/**
 * Movies that have never been checked.
 *
 * Note the `undefined` test rather than a falsy/length one. A film we've
 * looked up and found nothing for gets an explicit `[]`, which is meaningfully
 * different from "not yet asked" - so re-running the backfill doesn't
 * re-query every locationless film forever. (backfillBoxOffice.js can't make
 * this distinction, because TMDB uses 0 for both "no data" and a real zero.)
 */
export function collectMoviesNeedingLocations (movieLog) {
  return Object.entries(movieLog || {})
    .filter(([, entry]) => {
      const movie = entry?.movie;
      if (!movie || movie.id == null) {
        return false;
      }
      // Offline placeholders have non-numeric ids and no Wikidata counterpart.
      if (typeof movie.id === 'string' && !/^\d+$/.test(movie.id)) {
        return false;
      }
      return movie.locations === undefined;
    })
    .map(([dbKey, entry]) => ({ dbKey, entry, tmdbId: String(entry.movie.id) }));
}

async function runQuery (query, fetchImpl) {
  const response = await fetchImpl(`${WDQS_ENDPOINT}?query=${encodeURIComponent(query)}`, {
    headers: { Accept: 'application/sparql-results+json' },
    signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
  });

  if (!response?.ok) {
    throw new Error(`Wikidata query failed: ${response?.status}`);
  }

  return response.json();
}

/**
 * Look up locations for a set of TMDB ids.
 *
 * Returns { [tmdbId]: [location, ...] } containing ONLY ids that had results;
 * callers are responsible for writing `[]` for the rest (see
 * backfillMovieLocations) so "checked, found nothing" is recorded.
 */
export async function fetchLocationsForIds (tmdbIds, { fetchImpl = fetch } = {}) {
  const results = {};

  for (let index = 0; index < tmdbIds.length; index += ID_BATCH_SIZE) {
    const batch = tmdbIds.slice(index, index + ID_BATCH_SIZE);
    const json = await runQuery(buildLocationsQuery(batch), fetchImpl);
    Object.assign(results, parseLocationsResponse(json));
  }

  return results;
}

/**
 * Fill in missing locations across the library.
 *
 * `writeBatchFn(batch)` receives [{ dbKey, entry, locations }] and owns
 * persistence. Batched rather than written per-movie: writing one at a time
 * caused a real performance incident with the box office backfill (hundreds of
 * full movieLog copies + reactivity passes in quick succession, which mobile
 * browsers respond to by killing the tab).
 */
export async function backfillMovieLocations (movieLog, writeBatchFn, options = {}) {
  const { onProgress, signal, batchSize = 50 } = options;

  const candidates = collectMoviesNeedingLocations(movieLog);
  const total = candidates.length;
  let completed = 0;
  let withLocations = 0;
  let failed = 0;

  const report = () => onProgress && onProgress({ completed, total, failed, withLocations });
  report();

  for (let index = 0; index < candidates.length; index += ID_BATCH_SIZE) {
    if (signal?.aborted) {
      break;
    }

    const slice = candidates.slice(index, index + ID_BATCH_SIZE);

    let found = {};
    try {
      found = await fetchLocationsForIds(slice.map((c) => c.tmdbId), options);
    } catch {
      // A failed batch leaves those movies unmarked, so the next run retries
      // them. Don't abort the whole pass for one bad request.
      failed += slice.length;
      completed += slice.length;
      report();
      continue;
    }

    // Write in smaller chunks than we query in - the network likes big
    // batches, the reactivity system does not.
    for (let start = 0; start < slice.length; start += batchSize) {
      const chunk = slice.slice(start, start + batchSize).map((candidate) => ({
        dbKey: candidate.dbKey,
        entry: candidate.entry,
        // `[]` is deliberate, not a no-op: it records "checked, nothing found".
        locations: found[candidate.tmdbId] || []
      }));

      try {
        await writeBatchFn(chunk);
        withLocations += chunk.filter((item) => item.locations.length).length;
      } catch {
        failed += chunk.length;
      }

      completed += chunk.length;
      report();
    }
  }

  return { total, completed, failed, withLocations };
}
