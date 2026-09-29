// Pure fun-facts computations over the library (bug-report request: "I want
// to explore a way to see more fun data about my ratings and watching
// habits"). Each fact returns { key, label, value, detail } or null when
// the library can't support it — a UI can render whatever subset it likes.
//
// Deliberately UI-less: Insights.vue is large and untested, so where these
// end up (a new Insights section, the Watchlist screen, Year in Review) is
// a design decision this module doesn't prejudge.
import { formatScore } from './formatScore.js';

function watchTimes (entry) {
  return (entry?.ratings || [])
    .map((rating) => new Date(rating?.date ?? NaN).getTime())
    .filter(Number.isFinite);
}

const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Total time spent watching: runtime × times rated. The library stores one
// entry per movie with a ratings array, so re-logs count as re-watches.
export function totalWatchTime (entries) {
  let minutes = 0;
  (entries || []).forEach((entry) => {
    const runtime = entry?.movie?.runtime;
    const views = Math.max(1, (entry?.ratings || []).length);
    if (Number.isFinite(runtime) && runtime > 0) minutes += runtime * views;
  });
  if (!minutes) return null;
  const days = minutes / 60 / 24;
  return {
    key: 'totalWatchTime',
    label: 'Time in the dark',
    value: `${Math.round(minutes / 60).toLocaleString()} hours`,
    detail: days >= 2 ? `That's ${days.toFixed(1)} straight days of movies.` : null
  };
}

// The decade your library actually lives in.
export function decadeDna (entries) {
  const counts = new Map();
  let total = 0;
  (entries || []).forEach((entry) => {
    const year = new Date(entry?.movie?.release_date ?? NaN).getFullYear();
    if (!Number.isFinite(year)) return;
    const decade = Math.floor(year / 10) * 10;
    counts.set(decade, (counts.get(decade) || 0) + 1);
    total += 1;
  });
  if (!total) return null;
  const [decade, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    key: 'decadeDna',
    label: 'Home decade',
    value: `the ${decade}s`,
    detail: `${Math.round((count / total) * 100)}% of your library premiered there.`
  };
}

// Busiest single calendar month of watching, ever.
export function busiestMonth (entries) {
  const counts = new Map();
  (entries || []).forEach((entry) => {
    watchTimes(entry).forEach((time) => {
      const date = new Date(time);
      const key = `${date.getFullYear()}-${date.getMonth()}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  if (!counts.size) return null;
  const [key, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  const [year, month] = key.split('-').map(Number);
  return {
    key: 'busiestMonth',
    label: 'Busiest month',
    value: `${MONTH_LABELS[month]} ${year}`,
    detail: `${count} movies logged.`
  };
}

// The genre you watch most vs the genre you RATE best — often not the same,
// which is the fun part. minCount keeps a 2-movie genre from winning "best".
export function genreSplit (entries, getRatingFn, { minCount = 5 } = {}) {
  const byGenre = new Map();
  (entries || []).forEach((entry) => {
    const rating = getRatingFn(entry)?.calculatedTotal;
    (entry?.movie?.genres || []).forEach((genre) => {
      if (!genre?.name) return;
      if (!byGenre.has(genre.name)) byGenre.set(genre.name, { count: 0, total: 0 });
      const record = byGenre.get(genre.name);
      record.count += 1;
      if (Number.isFinite(rating)) record.total += rating;
    });
  });
  if (!byGenre.size) return null;

  const most = [...byGenre.entries()].sort((a, b) => b[1].count - a[1].count)[0];
  const rated = [...byGenre.entries()]
    .filter(([, record]) => record.count >= minCount)
    .map(([name, record]) => [name, record.total / record.count])
    .sort((a, b) => b[1] - a[1])[0];

  return {
    key: 'genreSplit',
    label: 'Genre of the house',
    value: most[0],
    detail: rated && rated[0] !== most[0]
      ? `Most watched — but ${rated[0]} is what you score highest (${formatScore(rated[1])} average).`
      : `Most watched and best rated.`
  };
}

// Your most-logged single day.
export function biggestDay (entries) {
  const counts = new Map();
  (entries || []).forEach((entry) => {
    watchTimes(entry).forEach((time) => {
      const date = new Date(time);
      const key = date.toDateString();
      counts.set(key, (counts.get(key) || 0) + 1);
    });
  });
  if (!counts.size) return null;
  const [day, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (count < 3) return null; // one or two in a day isn't a story
  return {
    key: 'biggestDay',
    label: 'Biggest movie day',
    value: `${count} in one day`,
    detail: day
  };
}

// The oldest thing you've rated. Was "Deepest cut" until 2026-09-29, when
// that name moved to leastSeenMovie below.
export function oldestMovie (entries) {
  const dated = (entries || [])
    .map((entry) => ({ entry, year: new Date(entry?.movie?.release_date ?? NaN).getFullYear() }))
    .filter(({ year }) => Number.isFinite(year));
  if (!dated.length) return null;
  const oldest = dated.sort((a, b) => a.year - b.year)[0];
  return {
    key: 'oldestMovie',
    label: 'Oldest film',
    value: oldest.entry.movie.title,
    detail: `Released ${oldest.year}.`
  };
}

// The least-seen thing you've rated (report 2026-09-29: "the weirdest movie
// I've seen... not the popularity score but literally the number of people
// who have seen it"). TMDB publishes no view counts; vote_count — how many
// people rated it there — is the honest stand-in, and it's in the stored
// shape (AddRating + the server-side backfill). Stale as of when it was
// saved, which is fine for ranking obscurity. Entries without it are
// skipped, never treated as zero; ties go to the older release.
export function leastSeenMovie (entries) {
  const counted = (entries || [])
    .filter((entry) => Number.isFinite(entry?.movie?.vote_count) && entry.movie.vote_count >= 0)
    .map((entry) => ({ entry, votes: entry.movie.vote_count, time: new Date(entry.movie.release_date ?? NaN).getTime() }));
  if (!counted.length) return null;
  const least = counted.sort((a, b) => (a.votes - b.votes) ||
    ((Number.isFinite(a.time) ? a.time : Infinity) - (Number.isFinite(b.time) ? b.time : Infinity)))[0];
  const { votes } = least;
  return {
    key: 'leastSeenMovie',
    label: 'Deepest cut',
    value: least.entry.movie.title,
    detail: votes === 0
      ? 'Nobody else has rated it on TMDB.'
      : `Only ${votes.toLocaleString()} ${votes === 1 ? 'person has' : 'people have'} rated it on TMDB.`
  };
}

// Everything, null-facts dropped — the one-call entry point for a UI.
export function allFunFacts (entries, getRatingFn) {
  return [
    totalWatchTime(entries),
    decadeDna(entries),
    genreSplit(entries, getRatingFn),
    busiestMonth(entries),
    biggestDay(entries),
    leastSeenMovie(entries),
    oldestMovie(entries)
  ].filter(Boolean);
}
