// What to download when the Letterboxd data is asked for (2026-11-11, from
// the audit: every app open downloaded the whole shared film table, ~220 KB,
// and my whole synced diary, ~500 KB, which was most of the database's
// download bill). The phone now keeps the last copy (offlineStore, kind
// 'letterboxd') and asks only for the part that can have changed:
//
//   films    the crowd's ratings, filled by a daily sweep: re-read once a day
//   reviews  my diary, written only by the sync (which stamps
//            letterboxd/sync.lastAt) or by a CSV import: re-read when that
//            stamp moves, or when the caller says it just wrote
//
// Pure, so the rules are tested without a database.
export const FILMS_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function letterboxdPlan ({ cached, syncLastAt = null, now = Date.now(), reviewsChanged = false }) {
  const films = !cached?.films || !cached.filmsAt || now - cached.filmsAt >= FILMS_MAX_AGE_MS;
  const reviews = reviewsChanged || !cached?.reviews ||
    // No stamp to compare (never synced, or the stamp read failed): trust a copy under a day old.
    (syncLastAt == null ? !cached.reviewsAt || now - cached.reviewsAt >= FILMS_MAX_AGE_MS : cached.reviewsSyncAt !== syncLastAt);
  return { films, reviews };
}
