// Runs a Letterboxd import (2026-11-14). The deciding is all in
// assets/javascript/letterboxdImport.js; this file reads the export, asks
// TMDB, writes in batches, and remembers where it got to.
//
// Module-level, not per component: the welcome screen that starts an import
// disappears the moment the first films land (the account stops being "brand
// new"), and leaving Settings mustn't stop it either. `importState` is
// reactive, so whichever screen shows the panel sees the same run.
//
// Resumable: the film list and each film's outcome are saved on the device
// (offlineStore, per account) after every batch. A batch's statuses are saved
// only once its write landed, and a film is re-checked against the library at
// write time, so a run killed between the two can't make a duplicate.
import axios from 'axios';
import store from '../store/index';
import { saveSnapshot, loadSnapshot } from './offlineStore.js';
import { readZipTextFiles, isZip } from './zipReader.js';
import { importLetterboxdReviews } from './letterboxdData.js';
import { importState, markSavedImport } from './letterboxdImportState.js';
import { runTmdbBackfill } from '../assets/javascript/tmdbBackfill.js';
import { parseCsv, reviewsCsvToUpdates, buildTitleIndex, matchTitle } from '../assets/javascript/letterboxdFormat.js';
import { buildFilmList, pickTmdbMatch, planImportBatch, exportFileKind, csvKind } from '../assets/javascript/letterboxdImport.js';
import { shapeTmdbDataIntoMovie, safeTitleKey } from '../assets/javascript/AddRating.js';

export { importState };

const SNAPSHOT_KIND = 'letterboxdImport';
const TMDB = 'https://api.themoviedb.org/3';
const BATCH_SIZE = 20;
const CONCURRENCY = 4;


let saved = null; // { films: [...], outcomes: {}, reviews: rows|null }

const topKey = () => store.getters.databaseTopKey;

const persist = () => {
  markSavedImport(topKey(), true);
  return saveSnapshot(topKey(), SNAPSHOT_KIND, JSON.parse(JSON.stringify(saved)));
};

const refreshCounts = () => {
  const outcomes = saved?.outcomes || {};
  const films = saved?.films || [];
  importState.total = films.length;
  importState.processed = films.filter((film) => outcomes[film.key] && outcomes[film.key].status !== 'pending').length;
  importState.pending = films.filter((film) => !outcomes[film.key] || outcomes[film.key].status === 'failed').length;
  importState.imported = films.filter((film) => outcomes[film.key]?.created).length;
  importState.viewingsAdded = films.reduce((sum, film) => sum + (outcomes[film.key]?.added || 0), 0);
  importState.doubtful = films
    .filter((film) => outcomes[film.key]?.status === 'doubtful')
    .map((film) => ({ ...film, suggestion: outcomes[film.key].suggestion }));
};

// TMDB asks politely when we're too fast: honour Retry-After once.
const tmdbGet = async (path, params = {}) => {
  const query = { api_key: process.env.VUE_APP_TMDB_API_KEY, ...params };
  try {
    return (await axios.get(`${TMDB}${path}`, { params: query })).data;
  } catch (error) {
    if (error?.response?.status !== 429) throw error;
    const wait = Number(error.response.headers?.['retry-after']) * 1000 || 2000;
    await new Promise((resolve) => setTimeout(resolve, wait));
    return (await axios.get(`${TMDB}${path}`, { params: query })).data;
  }
};

export const searchTmdbMovies = async (title, year) => {
  const params = { query: title, include_adult: false, language: 'en-US' };
  if (year) params.year = year;
  return (await tmdbGet('/search/movie', params))?.results || [];
};

const fetchMovie = async (tmdbId, film) => {
  const data = await tmdbGet(`/movie/${tmdbId}`, { append_to_response: 'credits,keywords' });
  return shapeTmdbDataIntoMovie({
    ...data,
    cast: data.credits?.cast || [],
    crew: data.credits?.crew || [],
    keywords: data.keywords?.keywords || []
  }, [{ id: tmdbId, title: film.title }]);
};

// The library's own title index answers films already there without asking
// TMDB at all.
const resolveFilm = async (film, titleIndex) => {
  const inLibrary = film.year ? matchTitle(titleIndex, film.title, film.year) : null;
  if (inLibrary) return { film, kind: 'merge', tmdbId: inLibrary };
  let pick = pickTmdbMatch(await searchTmdbMovies(film.title, film.year), film.title, film.year);
  if (!pick.sure && film.year) {
    // TMDB's year filter can hide a film dated a year apart; ask once more
    // without it so the near miss can at least be suggested.
    const wider = pickTmdbMatch(await searchTmdbMovies(film.title), film.title, film.year);
    if (wider.sure || (!pick.suggestion && wider.suggestion)) pick = wider;
  }
  if (!pick.sure) return { film, kind: 'doubtful', suggestion: pick.suggestion };
  if (store.getters.allMediaAsArray.some((entry) => Number(entry?.movie?.id) === pick.tmdbId)) {
    return { film, kind: 'merge', tmdbId: pick.tmdbId };
  }
  return { film, kind: 'new', tmdbId: pick.tmdbId, movie: await fetchMovie(pick.tmdbId, film) };
};

const writeBatch = async (items) => {
  const { entries, updates, outcomes } = planImportBatch(items, {
    movieLog: store.state.movieLog,
    makeKey: safeTitleKey
  });
  if (entries.length) {
    // Server first, THEN the local copy — the reverse of a hand rating, on
    // purpose. The import is online-only and resumable rather than queued, so
    // a batch the server never took must not look "already in the library"
    // to the resumed run, which would then skip writing it at all.
    try {
      await store.dispatch('updateDatabaseEntriesNow', updates);
      store.commit('setMovieLogEntries', entries);
    } catch (error) {
      // Left pending: the next run (or Resume) tries these films again, and
      // the write-time library check keeps that from doubling anything.
      importState.failedWrites += items.length;
      console.warn('Letterboxd import batch did not save; it will be retried:', error?.message);
      throw error;
    }
  }
  Object.assign(saved.outcomes, outcomes);
  refreshCounts();
  await persist();
};

const importReviews = async () => {
  if (!saved?.reviews?.length) return;
  importState.phase = 'reviews';
  try {
    const { updates } = reviewsCsvToUpdates(saved.reviews, store.getters.allMediaAsArray || []);
    importState.reviewsImported = await importLetterboxdReviews(topKey(), updates);
    store.dispatch('ensureLetterboxdData', { reviewsChanged: true });
  } catch (error) {
    console.warn('Letterboxd reviews import failed:', error?.message);
  }
};

const announceLibraryChanged = () => {
  store.dispatch('scheduleSocialPublish');
  store.dispatch('scheduleMirrorPublish');
};

async function run () {
  if (importState.running || !saved) return;
  importState.running = true;
  importState.phase = 'matching';
  importState.error = false;
  importState.message = '';
  importState.failedWrites = 0;
  try {
    const titleIndex = buildTitleIndex(store.getters.allMediaAsArray || []);
    const todo = saved.films.filter((film) => !saved.outcomes[film.key] || saved.outcomes[film.key].status === 'failed');
    await runTmdbBackfill(todo.map((film) => ({ dbKey: film.key, entry: film })), {
      fetchOne: (film) => resolveFilm(film, titleIndex),
      makeItem: (candidate, item) => item,
      writeBatchFn: writeBatch,
      concurrency: CONCURRENCY,
      batchSize: BATCH_SIZE
    });
    refreshCounts();
    await importReviews();
    importState.phase = 'done';
    if (importState.pending) {
      importState.error = true;
      importState.message = `${importState.pending} films couldn't be looked up or saved this time. Try again to pick up where it stopped.`;
    }
    announceLibraryChanged();
  } catch (error) {
    importState.error = true;
    importState.message = error?.message || 'The import stopped.';
  } finally {
    importState.running = false;
  }
}

// What's saved from an earlier (possibly interrupted) import, if anything.
export async function loadSavedImport () {
  if (importState.running || !topKey()) return;
  saved = await loadSnapshot(topKey(), SNAPSHOT_KIND);
  if (saved) {
    saved.outcomes = saved.outcomes || {};
    refreshCounts();
    importState.phase = importState.pending ? 'paused' : 'done';
  }
  importState.loaded = true;
}

export async function resumeLetterboxdImport () {
  if (!saved) await loadSavedImport();
  return run();
}

// The export as picked: the zip itself, or any of its CSVs on their own.
export async function readLetterboxdExport (file) {
  const found = { diary: [], ratings: [], reviews: [] };
  const buffer = await file.arrayBuffer();
  if (isZip(buffer)) {
    const files = await readZipTextFiles(buffer, (name) => Boolean(exportFileKind(name)));
    for (const { name, text } of files) found[exportFileKind(name)] = parseCsv(text);
  } else {
    const rows = parseCsv(new TextDecoder('utf-8').decode(buffer));
    const kind = csvKind(rows);
    if (kind) found[kind] = rows;
  }
  if (!found.diary.length && !found.ratings.length) {
    throw new Error("That doesn't look like a Letterboxd export. Pick the zip from Letterboxd → Settings → Import & Export → Export your data.");
  }
  return found;
}

export async function startLetterboxdImport (file) {
  if (importState.running) return;
  importState.phase = 'reading';
  importState.error = false;
  importState.message = '';
  try {
    const { diary, ratings, reviews } = await readLetterboxdExport(file);
    const films = buildFilmList({ diary, ratings });
    // A second import of a newer export keeps what the first one settled.
    const previous = saved?.outcomes || {};
    saved = { films, outcomes: {}, reviews: reviews.length ? reviews : null, startedAt: Date.now() };
    for (const film of films) {
      if (previous[film.key]?.status === 'skipped') saved.outcomes[film.key] = previous[film.key];
    }
    refreshCounts();
    await persist();
  } catch (error) {
    importState.phase = '';
    importState.error = true;
    importState.message = error?.message || "Couldn't read that file.";
    return;
  }
  await run();
}

// "Find the match": the person picked the right film for a doubtful one.
export async function matchDoubtfulFilm (filmKey, tmdbId) {
  const film = saved?.films.find((candidate) => candidate.key === filmKey);
  if (!film) return;
  const inLibrary = store.getters.allMediaAsArray.some((entry) => Number(entry?.movie?.id) === Number(tmdbId));
  const item = inLibrary
    ? { film, kind: 'merge', tmdbId }
    : { film, kind: 'new', tmdbId, movie: await fetchMovie(tmdbId, film) };
  await writeBatch([item]);
  await importReviews();
  importState.phase = 'done';
  announceLibraryChanged();
}

export async function skipDoubtfulFilm (filmKey) {
  if (!saved) return;
  saved.outcomes[filmKey] = { status: 'skipped' };
  refreshCounts();
  await persist();
}

// Forget the saved import (the films it brought in stay in the library).
export async function clearLetterboxdImport () {
  if (importState.running) return;
  saved = null;
  markSavedImport(topKey(), false);
  await saveSnapshot(topKey(), SNAPSHOT_KIND, null);
  Object.assign(importState, { phase: '', total: 0, processed: 0, imported: 0, viewingsAdded: 0, doubtful: [], pending: 0, failedWrites: 0, reviewsImported: 0, message: '', error: false });
}
