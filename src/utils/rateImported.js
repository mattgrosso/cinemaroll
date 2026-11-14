// Opens the Rate page on one imported viewing (importedQueue.js), marked as
// coming from the queue so the Rate page offers the next one after saving.
// Shared by Home's "Rate properly" card and the Rate page's "Next imported
// film". Returns false when the film has gone from the library.
import { computeFlatKeywords } from './keywords.js';

export function queueImportedRating (store, target) {
  const entry = target && store.state.movieLog?.[target.dbKey];
  if (!entry?.movie || !entry.ratings?.[target.index]) return false;
  store.commit('setMovieToRate', { ...entry.movie, flatKeywords: computeFlatKeywords(entry.movie) });
  store.commit('setRatingToEdit', { dbKey: target.dbKey, index: target.index, fromQueue: true });
  return true;
}
