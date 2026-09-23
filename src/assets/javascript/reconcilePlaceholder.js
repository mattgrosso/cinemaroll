// Finishing a placeholder rating: the movie object rebuilt from TMDB and the
// same movieLog entry replaced in place (one atomic write), the placeholder
// queue entry retired. Shared by the Reconcile screen (the user picked the
// match) and autoReconcilePlaceholders (the app already knew it).
//
// Why the app can know it: since the lie-fi work (2026-09-23) a rating saved
// from a TMDB search result whose detail fetch never answered is stored as a
// placeholder carrying `pendingTmdbId`. The user picked the movie; only the
// details were missing. So once anything answers again, the placeholder can
// finish itself and the "needs a match" badge never appears for that case.
import { shapeTmdbMovie } from './AddRating.js';
import { enqueueWrite, removePendingWrite } from '../../utils/pendingWriteQueue.js';

/** The pending placeholders that carry the id the user already picked. */
export function placeholdersReadyToFinish (pending) {
  return (pending || []).filter((entry) =>
    entry?.type === 'placeholder' &&
    entry.status !== 'reconciled' &&
    entry.dbEntry?.value?.movie?.pendingTmdbId != null &&
    entry.dbEntry?.path);
}

/**
 * Replace the placeholder entry with the real movie shaped from `tmdbId`.
 * Throws on any failure with nothing removed, so a retry has everything.
 */
export async function finalizePlaceholder (store, queueEntry, tmdbId) {
  const movie = await shapeTmdbMovie(tmdbId, queueEntry.ratings);
  const dbEntry = {
    path: queueEntry.dbEntry.path,
    value: { movie, ratings: queueEntry.ratings }
  };

  const key = dbEntry.path.split('movieLog/')[1];
  store.commit('setMovieLogEntry', { key, value: dbEntry.value });

  // Durably queue the finalized write FIRST, before attempting it - the
  // same "survives being killed mid-write" guarantee AddRating.js's
  // addRating() uses. Different queue `type` from the placeholder entry, so
  // enqueueWrite's type:'write' dedupe never touches that one.
  const finalizedRecord = await enqueueWrite({ type: 'write', dbEntry });

  // A direct, awaited write - what guarantees the match is confirmed before
  // anyone is told it is done (see writeDatabaseEntryNow in store/index.js).
  await store.dispatch('writeDatabaseEntryNow', dbEntry);

  // Confirmed - drop both queue entries. Anything thrown above leaves both
  // in place for the retry.
  if (finalizedRecord) {
    await removePendingWrite(finalizedRecord.id);
  }
  await removePendingWrite(queueEntry.id);
  await store.dispatch('refreshPendingReconciliations');
  return dbEntry;
}
