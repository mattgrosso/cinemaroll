import axios from 'axios';
import store from '../../store/index';
import { warmImageCache, posterUrl, backdropUrl } from './offlinePosterCache.js';
import { fetchLocationsForIds } from './movieLocations.js';
import { isPlaceholderId } from '../../utils/placeholderId.js';
import { trimCrew, RUNTIME_ENTRY_FIELDS } from './storedEntry.js';
import { enqueueWrite, removePendingWrite, updatePendingWrite } from '../../utils/pendingWriteQueue.js';

const getTMDBData = async (rating) => {
  const apiKey = process.env.VUE_APP_TMDB_API_KEY;
  const id = rating.id || rating.tvShowId;

  let dataResp;
  let creditsResp;
  let keywordsResp;

  try {
    if (store.state.currentLog === "tvLog") {
      dataResp = await axios.get(`https://api.themoviedb.org/3/tv/${id}?api_key=${apiKey}`);
      creditsResp = await axios.get(`https://api.themoviedb.org/3/tv/${id}/credits?api_key=${apiKey}`);
      keywordsResp = await axios.get(`https://api.themoviedb.org/3/tv/${id}/keywords?api_key=${apiKey}`);
    } else {
      dataResp = await axios.get(`https://api.themoviedb.org/3/movie/${id}?api_key=${apiKey}`);
      creditsResp = await axios.get(`https://api.themoviedb.org/3/movie/${id}/credits?api_key=${apiKey}`);
      keywordsResp = await axios.get(`https://api.themoviedb.org/3/movie/${id}/keywords?api_key=${apiKey}`);
    }
  } catch (error) {
    console.log(error);
    return;
  }

  return {
    ...dataResp.data,
    ...creditsResp.data,
    keywords: keywordsResp.data.keywords || keywordsResp.data.results
  }
}

const findKeyForMovieInDatabase = (id) => {
  const keys = Object.keys(store.state.movieLog);
  const movies = keys.map((key) => {
    return {
      ...store.state.movieLog[key],
      key
    }
  })

  const movie = movies.find((movie) => movie.movie.id === id);

  if (movie) {
    return movie.key;
  } else {
    return false;
  }
}

const collectChatGPTKeywords = (ratings) => {
  const chatGPTKeywords = [];
  ratings.forEach((rating) => {
    if (rating.chatGPTKeywords) {
      rating.chatGPTKeywords.forEach((keyword) => {
        if (!chatGPTKeywords.includes(keyword)) {
          chatGPTKeywords.push(keyword);
        }
      });
    }
  });
  return chatGPTKeywords;
}

const stripOwnership = (ratings) => {
  return ratings.map((rating) => {
    const tempRating = { ...rating };
    delete tempRating.ownership;
    return tempRating;
  });
}

const safeTitleKey = (title) => {
  return `${new Date().getTime()}-${crypto.randomUUID()}-${title.replaceAll(/[-!$%@^&*()_+|~=`{}[\]:";'<>?,./#]/g, "-")}`;
}

// Shapes a live TMDB response + the ratings collected for it into the
// `movie` sub-object AddRating stores. Pulled out of addMovieRating so the
// reconciliation flow (matching an offline placeholder rating to a real
// TMDB movie) can reuse the exact same shaping logic.
const shapeTmdbDataIntoMovie = (tmdbData, ratings) => {
  // TMDB returns every credit — ~91 people per film, including stunts and
  // "Thanks" — and storing all of them made crew half the entire database.
  // Only the job titles the app reads or searches on are kept.
  const crew = trimCrew(tmdbData.crew.map((person) => ({ job: person.job, name: person.name })));
  const cast = tmdbData.cast.map((person) => ({ name: person.name, character: person.character }));

  return {
    backdrop_path: tmdbData.backdrop_path,
    budget: tmdbData.budget,
    cast,
    crew,
    genres: tmdbData.genres,
    id: tmdbData.id,
    imdb_id: tmdbData.imdb_id,
    ownership: ratings[0].ownership || null,
    poster_path: tmdbData.poster_path,
    production_companies: tmdbData.production_companies,
    // Where a film was made and what it's spoken in. Both come back on the
    // same /movie/{id} call we already make, they were just never kept — see
    // backfillProductionCountries for filling these in on older entries.
    production_countries: tmdbData.production_countries || [],
    spoken_languages: tmdbData.spoken_languages || [],
    release_date: tmdbData.release_date,
    revenue: tmdbData.revenue,
    runtime: tmdbData.runtime,
    // Same /movie/{id} call, never kept before (2026-08-15): stored so Tag
    // Lines / Clue Budget work offline. '' = movie genuinely has none;
    // undefined = legacy entry from before this field (fetch fallback).
    tagline: (tmdbData.tagline || '').trim(),
    // Community score, for the "give these another shot" watchlist
    // (2026-08-15) — same details call, never kept before.
    vote_average: tmdbData.vote_average ?? null,
    vote_count: tmdbData.vote_count ?? null,
    title: tmdbData.title,
    keywords: tmdbData.keywords,
    chatGPTKeywords: collectChatGPTKeywords(ratings)
  };
}

// A transient TMDB fetch failure shouldn't wipe out previously-good local
// data (the old, buggy behavior) - and offline, there's no TMDB call to make
// at all when the movie is already local. Both cases reuse what's already
// stored, just refreshing ownership/chatGPTKeywords from the new rating.
const buildMovieFromLocalData = (previousMovie, ratings) => {
  return {
    ...previousMovie,
    ownership: ratings[0].ownership || previousMovie.ownership || null,
    chatGPTKeywords: [...new Set([...(previousMovie.chatGPTKeywords || []), ...collectChatGPTKeywords(ratings)])]
  };
}

// Fetches real TMDB data for `tmdbId` and shapes it with `ratings`. Used by
// the reconciliation flow to finalize a placeholder rating once the user has
// picked which real movie it was - deliberately takes an explicit id rather
// than reading it off ratings[0] (which still carries the OLD placeholder
// id at that point). Throws if the fetch fails; the caller decides how to
// surface that (e.g. let the user retry the search).
export const shapeTmdbMovie = async (tmdbId, ratings) => {
  const tmdbData = await getTMDBData({ id: tmdbId });
  if (!tmdbData) {
    throw new Error(`Failed to fetch TMDB data for id ${tmdbId}`);
  }
  return shapeTmdbDataIntoMovie(tmdbData, ratings);
}

// Builds a placeholder movie object for a rating made offline with no TMDB
// lookup possible (just a typed title, optionally a year) - marked with
// isPendingReconciliation so it durably survives being written to Firebase
// and can be found again later for the "did you mean this movie?" prompt.
// Fields are deliberately non-null, sensible DEFAULTS rather than an
// all-null shape:
//   - release_date always resolves to a real (if approximate) date - a null
//     release_date would break date-parsing call sites throughout the app
//     (MovieDetail, Insights, sort-by-date) that assume a parseable value.
//   - runtime defaults to 90, not null - the "include shorts" filter is
//     `runtime <= 40`, and `null <= 40` is true in JS (null coerces to 0),
//     so a null-runtime placeholder would be silently excluded whenever
//     that setting is off.
const buildPlaceholderMovie = (ratings) => {
  const rating = ratings[0];
  const typedYear = /^\d{4}$/.test(String(rating.year || '').trim()) ? String(rating.year).trim() : null;
  const year = typedYear || String(new Date().getFullYear());

  return {
    id: rating.id,
    title: rating.title,
    release_date: `${year}-01-01`,
    runtime: 90,
    poster_path: null,
    backdrop_path: null,
    genres: [],
    cast: [],
    crew: [],
    keywords: [],
    production_companies: [],
    imdb_id: null,
    ownership: rating.ownership || null,
    chatGPTKeywords: collectChatGPTKeywords(ratings),
    isPendingReconciliation: true
  };
}

// Movie fields that are stored on the entry but don't come from TMDB, so a
// re-rate has to carry them across explicitly. `locations` comes from
// Wikidata (see movieLocations.js). The ENTRY-level preservation below is
// what fixed a real pre-existing bug (re-rating a movie silently wiped its
// custom poster), so the mechanism outlived the maps feature's first run.
const CARRIED_OVER_MOVIE_FIELDS = ['locations'];

// Look up filming/story locations for a freshly-rated movie and store them,
// so places fill in on their own and the Settings backfill button is only
// ever needed as a one-time catch-up for the existing library.
//
// Deliberately NOT awaited by the caller: Wikidata being slow or down must
// never delay or fail an actual rating. Anything missed here is picked up by
// the backfill, since a movie only counts as "checked" once `locations` is
// actually written.
const storeLocationsForRating = async (dbEntry) => {
  const movie = dbEntry?.value?.movie;

  // Placeholders have no real TMDB id to join on; they get locations once
  // they're reconciled and re-saved with a real one.
  if (!movie || movie.id == null || isPlaceholderId(movie.id)) {
    return;
  }
  // Already known — either carried over from a previous rating or filled in
  // by the backfill. Re-querying would be pure waste.
  if (movie.locations !== undefined) {
    return;
  }
  if (!store.state.isOnline) {
    return;
  }

  const key = dbEntry.path.split('movieLog/')[1];

  try {
    const found = await fetchLocationsForIds([String(movie.id)]);
    const locations = found[String(movie.id)] || [];

    // Re-read rather than reusing dbEntry: by the time this resolves the
    // entry may have been touched again, and this write should only ever add
    // the one field.
    const existing = store.state.movieLog[key];
    if (!existing) {
      return;
    }

    store.commit('setMovieLogEntry', {
      key,
      value: { ...existing, movie: { ...existing.movie, locations } }
    });
    // A leaf path, so this can never clobber sibling movie fields with a
    // possibly-stale snapshot.
    await store.dispatch('writeDatabaseEntryNow', {
      path: `movieLog/${key}/movie/locations`,
      value: locations
    });
  } catch (error) {
    console.error('Could not look up locations for this rating; the Settings backfill will catch it:', error);
  }
};

const addMovieRating = async (ratings) => {
  if (!ratings[0].id) {
    return;
  }

  const existingKey = findKeyForMovieInDatabase(ratings[0].id);
  const existingEntry = existingKey ? store.state.movieLog[existingKey] : null;

  let tmdbDataWeStore;

  if (!store.state.isOnline && existingEntry) {
    // Offline re-rate: the movie's TMDB data is already local, skip the
    // network call entirely.
    tmdbDataWeStore = buildMovieFromLocalData(existingEntry.movie, ratings);
  } else {
    const tmdbData = await getTMDBData(ratings[0]);

    if (tmdbData) {
      tmdbDataWeStore = shapeTmdbDataIntoMovie(tmdbData, ratings);
    } else if (existingEntry) {
      tmdbDataWeStore = buildMovieFromLocalData(existingEntry.movie, ratings);
    } else {
      // Genuinely new movie, but the TMDB fetch failed - surface this rather
      // than silently writing a broken entry (id: null, no poster, etc.).
      throw new Error(`Failed to fetch TMDB data for id ${ratings[0].id}`);
    }
  }

  // Carry forward locally-owned data that a re-rate would otherwise destroy.
  //
  // This matters because saving a rating does a full set() of movieLog/<key>,
  // and shapeTmdbDataIntoMovie builds a BRAND NEW movie object from the TMDB
  // response - so anything not explicitly copied across is silently wiped.
  // That's how re-rating a movie used to lose its custom poster.
  //
  // Entry level: everything except the two fields we're deliberately
  // replacing. Nothing at this level comes from TMDB, so it's all worth
  // keeping, and an allowlist would silently start dropping any field added
  // later. `dbKey` is excluded because the store injects it when reading, so
  // it isn't real stored data.
  const entryExtras = {};
  const notRealStoredData = new Set(['movie', 'ratings', ...RUNTIME_ENTRY_FIELDS]);
  Object.keys(existingEntry || {}).forEach((field) => {
    if (!notRealStoredData.has(field)) {
      entryExtras[field] = existingEntry[field];
    }
  });

  // Movie level: an explicit allowlist rather than a merge. Merging the whole
  // previous movie object would also resurrect fields we WANT the fresh TMDB
  // response to correct, and would keep isPendingReconciliation set on a
  // placeholder being finalised.
  CARRIED_OVER_MOVIE_FIELDS.forEach((field) => {
    if (tmdbDataWeStore[field] === undefined && existingEntry?.movie?.[field] !== undefined) {
      tmdbDataWeStore[field] = existingEntry.movie[field];
    }
  });

  const movieWithRating = {
    ...entryExtras,
    movie: tmdbDataWeStore,
    ratings: stripOwnership(ratings)
  };

  const key = existingKey || safeTitleKey(tmdbDataWeStore.title);

  return {
    path: `movieLog/${key}`,
    value: movieWithRating
  }
}

const addRating = async (ratings) => {
  const id = ratings[0].id;
  if (!id) {
    return;
  }

  const isPlaceholder = isPlaceholderId(id);
  let dbEntry;

  if (isPlaceholder) {
    const movie = buildPlaceholderMovie(ratings);
    const ratingsWithoutOwnership = stripOwnership(ratings);
    const key = findKeyForMovieInDatabase(id) || safeTitleKey(movie.title);
    dbEntry = { path: `movieLog/${key}`, value: { movie, ratings: ratingsWithoutOwnership } };
  } else {
    dbEntry = await addMovieRating(ratings);
    if (!dbEntry) {
      return;
    }
  }

  // BULLETPROOFING (Jul 2026, following a live data-loss report): durably
  // enqueue BEFORE attempting any network write, unconditionally, for every
  // rating - not only as a fallback after a failed attempt. This closes the
  // one gap the earlier "direct write" fix still had: if the tab/app is
  // killed in the split second while the write is actually in flight
  // (after the user has already seen the rating "saved" via the optimistic
  // commit below, but before the network round-trip resolves either way),
  // there would otherwise be nothing durable on disk yet. With the enqueue
  // happening FIRST, that same instant is already covered - IndexedDB has a
  // durable copy the moment this line completes, and it will be retried by
  // initializeDB/App.vue's background triggers on the very next load,
  // completely independent of whatever happens to the write attempt below.
  const queueEntry = {
    type: isPlaceholder ? 'placeholder' : 'write',
    dbEntry
  };
  if (isPlaceholder) {
    // Placeholders' queue entry additionally carries reconciliation
    // metadata - this is how the reconciliation banner/screen find "things
    // still needing a real TMDB match," not just a write-retry mechanism,
    // so it's never removed on success below, only marked `written`.
    // enqueueWrite dedupes by path, so re-rating the same still-
    // unreconciled placeholder just updates this one entry in place.
    Object.assign(queueEntry, {
      placeholderMovieId: id,
      title: dbEntry.value.movie.title,
      year: ratings[0].year || null,
      ratings: dbEntry.value.ratings,
      status: 'unreconciled'
    });
  }
  const queuedRecord = await enqueueWrite(queueEntry);

  // enqueueWrite never throws — it resolves null on ANY IndexedDB failure
  // (private browsing, iOS storage pressure, a wedged database). Offline,
  // that queue entry is the ONLY thing standing between this rating and
  // total loss on the next app close, so a null here must be a hard error
  // the user sees (RateMovie's submitError UI), not a silent "saved" that
  // wasn't. Bug report: an airplane-mode rating "seemed to work" then was
  // gone for good — an invisible enqueue failure produces exactly that.
  // Online, the direct server write below is its own confirmation, so a
  // failed enqueue only narrows the safety net rather than gutting it.
  if (!queuedRecord && !store.state.isOnline) {
    throw new Error('Could not save this rating on the device — offline storage is unavailable, and there is no connection to save it online.');
  }

  // Optimistic local commit - the movie shows up in the grid/previous-
  // viewings/a same-session re-edit immediately, regardless of what happens
  // to the network attempt below. Deliberately AFTER the durability line
  // above: nothing may look saved before something durable (IndexedDB entry
  // or, online, the awaited server write) stands behind it.
  const key = dbEntry.path.split('movieLog/')[1];
  store.commit('setMovieLogEntry', { key, value: dbEntry.value });

  // THE ACTUAL FIX for the original data-loss bug report: a direct, AWAITED
  // write attempt with no dependency on the SHARED/guarded flushPendingWrites
  // action - see writeDatabaseEntryNow's own comment in store/index.js for
  // the full history. This restores the same guarantee the app always had
  // before the offline-rating feature existed for the common (online) case:
  // if this resolves, the write is CONFIRMED on the server before the caller
  // is told the rating succeeded. The queue entry above is the durability
  // net underneath this attempt, not an alternative to it.
  if (store.state.isOnline) {
    try {
      await store.dispatch('writeDatabaseEntryNow', dbEntry);
      // Confirmed - the queue entry has done its job. 'write' entries are
      // fully done and removed; 'placeholder' entries stay queued
      // (reconciliation tracking is a separate concern from write success)
      // but are marked written so a later redundant flush pass can tell.
      if (queuedRecord) {
        if (isPlaceholder) {
          await updatePendingWrite(queuedRecord.id, { written: true });
        } else {
          await removePendingWrite(queuedRecord.id);
        }
      }
    } catch (error) {
      // Already durably queued above regardless of this failure - the
      // background sweep (App.vue's triggers / initializeDB) will keep
      // retrying it. Placeholders swallow this (the whole point of that
      // flow is "sync eventually," and its queue entry is the same safety
      // net either way); a normal rating still re-throws so the user gets
      // immediate visibility/control via RateMovie.vue's existing error UI,
      // rather than silently trusting an unconfirmed save - the data itself
      // is never at risk either way, this is purely about surfacing status.
      // A placeholder with NO queue entry (the enqueue itself failed) has no
      // safety net left, so that one combination must surface too.
      if (isPlaceholder && queuedRecord) {
        console.error('Direct write failed for a placeholder rating, will retry via the background queue:', error);
      } else {
        throw error;
      }
    }
  }
  // else: genuinely offline - no point attempting a write we know can't
  // reach the server. Already durably queued above; App.vue's triggers +
  // initializeDB pick it up once connectivity returns.

  // Fire-and-forget: get this movie's poster/backdrop into the offline image
  // cache immediately, rather than only whenever it's next viewed. Not
  // awaited - this must never slow down or fail the actual save. No-op for
  // a placeholder (both paths are null until reconciled).
  const newImageUrls = [posterUrl(dbEntry.value.movie?.poster_path), backdropUrl(dbEntry.value.movie?.backdrop_path)].filter(Boolean);
  if (newImageUrls.length) {
    warmImageCache(newImageUrls);
  }

  // Also fire-and-forget, same reasoning: places fill themselves in for new
  // ratings so the Settings backfill is only ever a one-time catch-up.
  storeLocationsForRating(dbEntry);

  return dbEntry;
}

export default addRating;
