// Reads of the Letterboxd data the sweep writes, and the two things the
// client asks the Lambda for. Every function here resolves to something a
// screen can render without it — the film page must never wait on, or break
// over, Letterboxd.
//
//   <topKey>/letterboxd/reviews/<tmdbId>/<reviewId>   my own diary entries
//   <topKey>/letterboxd/sync                          when the feed was last read
//   letterboxdFilms/<tmdbId>                          the film's public stats
import { getDatabase, ref, get, update } from 'firebase/database';
import { postToLetterboxd } from './letterboxdRequest.js';
import { reviewsFromNode, FILM_STALE_MS } from '../assets/javascript/letterboxdFormat.js';

const read = async (path) => {
  const snapshot = await get(ref(getDatabase(), path));
  return snapshot.val();
};

export async function myLetterboxdReviews (topKey, tmdbId) {
  if (!topKey || !tmdbId) return [];
  try {
    return reviewsFromNode(await read(`${topKey}/letterboxd/reviews/${tmdbId}`));
  } catch (error) {
    console.warn('Letterboxd reviews unavailable:', error?.message);
    return [];
  }
}

export async function letterboxdSyncState (topKey) {
  if (!topKey) return null;
  try {
    return await read(`${topKey}/letterboxd/sync`);
  } catch {
    return null;
  }
}

const isFresh = (film, now) => {
  if (!film) return false;
  if (film.fetchedAt && now - film.fetchedAt < FILM_STALE_MS) return true;
  // A recent failure is an answer too: don't ask again on every visit.
  if (film.failedAt && now - film.failedAt < 6 * 60 * 60 * 1000) return true;
  return false;
};

const filmRequests = new Map();

// The film's public stats: the shared cache first, and when it's missing or
// stale, one request to the Lambda, which fetches the page and caches it for
// everyone. Offline, whatever the cache holds.
export function letterboxdFilm (tmdbId, { online = true, now = Date.now() } = {}) {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0) return Promise.resolve(null);
  if (filmRequests.has(id)) return filmRequests.get(id);

  const request = (async () => {
    let cached = null;
    try {
      cached = await read(`letterboxdFilms/${id}`);
    } catch (error) {
      console.warn('Letterboxd film cache unavailable:', error?.message);
    }
    if (isFresh(cached, now) || !online) return cached;
    try {
      const { data } = await postToLetterboxd('/film', { tmdbId: id });
      return data?.film || cached;
    } catch (error) {
      console.warn('Letterboxd film lookup failed:', error?.message);
      return cached;
    }
  })();

  filmRequests.set(id, request);
  // A failed or stale answer may be retried on the next visit to the page.
  request.then((film) => {
    if (!isFresh(film, now)) filmRequests.delete(id);
    return film;
  }).catch(() => filmRequests.delete(id));
  return request;
}

export async function syncLetterboxdNow () {
  const { data } = await postToLetterboxd('/sync');
  return data;
}

// The CSV import writes straight to the account's letterboxd branch: it's
// external data, re-runnable from the same file, not something the user
// typed — so it takes the plain multi-path update rather than writeDurably.
export async function importLetterboxdReviews (topKey, updates) {
  if (!topKey) throw new Error('Not signed in');
  const keys = Object.keys(updates || {});
  if (!keys.length) return 0;
  await update(ref(getDatabase(), `${topKey}/letterboxd/reviews`), updates);
  return keys.length;
}
