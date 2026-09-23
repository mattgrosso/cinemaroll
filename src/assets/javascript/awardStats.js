import { expandNomineeFromMinimal, libraryIndexById } from './personalAwards.js';
import { memoByIdentity } from '../../utils/memoByIdentity.js';

// Leaderboards over the user's personal awards, for the Trophy Case.
//
// The stored shape is settings.personalAwards[year].categories[key] =
// { nominees: [minimal], winner: minimal|null, noNominees: bool } — see
// PersonalAwardsModal.convertNomineeToMinimal. Everything here is derived;
// nothing is persisted.
//
// A WINNER IS ALSO A NOMINEE: the modal only lets you pick a winner from
// the nominees you already selected, so `nominees` contains the winner too.
// Nomination counts therefore include wins, which is what people expect
// ("Titanic: 14 nominations, 11 wins") — this is deliberate, not
// double-counting.
//
// A PERSON'S AWARD ALSO COUNTS FOR THEIR MOVIE, matching how real ceremony
// tallies work ("Titanic won 11 Oscars" includes its acting and directing
// wins, not just Best Picture). Every expanded nominee carries `.movie`,
// whether it's a movie-type entry or a person expanded with the film they
// were nominated for, so both roll up the same way.

const DEFAULT_LIMIT = 10;
// A leaderboard of people/films with exactly one award each is just a list
// of every award, which isn't a "record" — only repeats are interesting.
const DEFAULT_MIN_COUNT = 2;

// `expanded.name` is the person/movie discriminator used throughout the
// Trophy Case (winnerTitle, the trophy-subtitle v-if, winnerImage).
function isPerson (expanded) {
  return Boolean(expanded?.name);
}

// Walks every year/category once and expands both the winner and each
// nominee. Returns { wins, nominations }, each a flat list of
// { year, categoryKey, expanded }. Tolerates missing/partial years, absent
// nominee lists, and nominees whose movie has since left the library
// (expandNomineeFromMinimal returns null for those, and they're skipped).
export function collectAwardEntries (personalAwards, library) {
  // The awards object is edited IN PLACE by the awards modal, so it is
  // keyed by value (a JSON string, ~1ms); the library is a cached getter
  // and keyed by identity.
  return collectAwardEntriesMemo(JSON.stringify(personalAwards || {}), personalAwards, library);
}

// Asked for by every shelf on the Trophy Case; once per (awards, library).
const collectAwardEntriesMemo = memoByIdentity((_awardsKey, personalAwards, library) => {
  const wins = [];
  const nominations = [];
  const byId = libraryIndexById(library);

  Object.keys(personalAwards || {}).forEach((yearKey) => {
    const year = Number(yearKey);
    const categories = personalAwards[yearKey]?.categories || {};

    Object.keys(categories).forEach((categoryKey) => {
      const category = categories[categoryKey] || {};

      const winner = category.winner ? expandNomineeFromMinimal(category.winner, library, byId) : null;
      if (winner) wins.push({ year, categoryKey, expanded: winner });

      (category.nominees || []).forEach((nominee) => {
        const expanded = expandNomineeFromMinimal(nominee, library, byId);
        if (expanded) nominations.push({ year, categoryKey, expanded });
      });
    });
  });

  return { wins, nominations };
});

// Ranks people by how many of the given entries they appear in. Ties break
// alphabetically so the order is stable rather than dependent on whatever
// order the years happened to be walked in.
export function rankPeople (entries, { limit = DEFAULT_LIMIT, minCount = DEFAULT_MIN_COUNT } = {}) {
  const byName = new Map();

  (entries || []).forEach((entry) => {
    if (!isPerson(entry.expanded)) return;
    const name = entry.expanded.name;
    if (!byName.has(name)) byName.set(name, { name, count: 0, entries: [] });
    const record = byName.get(name);
    record.count += 1;
    record.entries.push(entry);
  });

  return [...byName.values()]
    .filter((person) => person.count >= minCount)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// --- Derived shapes (user feedback: "the sections where you list every
// winner from each of the years... is not interesting... identify some more
// interesting data shapes") -----------------------------------------------

// Biggest single-year hauls: (movie, year) pairs ranked by how many
// categories that film won at that ceremony. A person's win counts for
// their film (the note at the top), which is exactly what makes a sweep.
export function rankSweeps (wins, { limit = DEFAULT_LIMIT, minCount = 3 } = {}) {
  const byMovieYear = new Map();

  (wins || []).forEach((entry) => {
    const movie = entry.expanded?.movie;
    if (!movie || movie.id == null) return;
    const key = `${movie.id}|${entry.year}`;
    if (!byMovieYear.has(key)) byMovieYear.set(key, { movieId: movie.id, movie, year: entry.year, count: 0 });
    byMovieYear.get(key).count += 1;
  });

  return [...byMovieYear.values()]
    .filter((sweep) => sweep.count >= minCount)
    .sort((a, b) => b.count - a.count || b.year - a.year)
    .slice(0, limit);
}

// People who won in consecutive ceremonies: the longest run of back-to-back
// years with at least one win. Ties by earlier start year, then name.
export function winStreaks (wins, { limit = DEFAULT_LIMIT, minLength = 2 } = {}) {
  const yearsByName = new Map();
  (wins || []).forEach((entry) => {
    if (!isPerson(entry.expanded)) return;
    const name = entry.expanded.name;
    if (!yearsByName.has(name)) yearsByName.set(name, { years: new Set(), sample: entry, all: [] });
    yearsByName.get(name).years.add(entry.year);
    yearsByName.get(name).all.push(entry);
  });

  const streaks = [];
  yearsByName.forEach(({ years, sample, all }, name) => {
    const sorted = [...years].sort((a, b) => a - b);
    let best = { length: 1, start: sorted[0], end: sorted[0] };
    let runStart = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] !== sorted[i - 1] + 1) runStart = sorted[i];
      const length = sorted[i] - runStart + 1;
      if (length > best.length) best = { length, start: runStart, end: sorted[i] };
    }
    if (best.length >= minLength) {
      // The wins inside the streak window, oldest first — these are the
      // posters the card shows.
      const entries = all
        .filter((entry) => entry.year >= best.start && entry.year <= best.end)
        .sort((a, b) => a.year - b.year);
      streaks.push({ name, length: best.length, startYear: best.start, endYear: best.end, sample, entries });
    }
  });

  return streaks
    .sort((a, b) => b.length - a.length || a.startYear - b.startYear || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// Category ownership: (person, category) pairs ranked by wins in that ONE
// category — "4× Best Director" is a different brag than four scattered wins.
export function categoryOwners (wins, { limit = DEFAULT_LIMIT, minCount = 2 } = {}) {
  const byPersonCategory = new Map();

  (wins || []).forEach((entry) => {
    if (!isPerson(entry.expanded)) return;
    const key = `${entry.expanded.name}|${entry.categoryKey}`;
    if (!byPersonCategory.has(key)) {
      byPersonCategory.set(key, { name: entry.expanded.name, categoryKey: entry.categoryKey, count: 0, sample: entry, entries: [] });
    }
    byPersonCategory.get(key).count += 1;
    byPersonCategory.get(key).entries.push(entry);
  });

  return [...byPersonCategory.values()]
    .filter((owner) => owner.count >= minCount)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// The overdue: people whose first WIN came years after their first
// nomination — nominated, passed over, nominated again, finally paid off.
export function longestWaits (nominations, wins, { limit = DEFAULT_LIMIT, minYears = 3 } = {}) {
  const firstNomination = new Map();
  (nominations || []).forEach((entry) => {
    if (!isPerson(entry.expanded)) return;
    const name = entry.expanded.name;
    if (!firstNomination.has(name) || entry.year < firstNomination.get(name).year) firstNomination.set(name, { year: entry.year, entry });
  });

  const firstWin = new Map();
  (wins || []).forEach((entry) => {
    if (!isPerson(entry.expanded)) return;
    const name = entry.expanded.name;
    if (!firstWin.has(name) || entry.year < firstWin.get(name).year) firstWin.set(name, { year: entry.year, sample: entry });
  });

  const waits = [];
  firstWin.forEach(({ year, sample }, name) => {
    const first = firstNomination.get(name);
    if (!first) return;
    const wait = year - first.year;
    if (wait >= minYears) {
      waits.push({
        name,
        wait,
        firstNomination: first.year,
        firstWin: year,
        sample,
        // The story in two posters: the film they were first nominated
        // for, and the film that finally won.
        entries: first.entry === sample ? [sample] : [first.entry, sample]
      });
    }
  });

  return waits
    .sort((a, b) => b.wait - a.wait || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// "Robbed, by your own ratings": categories where the movie you rated
// highest LOST to a lower-rated winner, ranked by the size of the gap.
// `ratingForMovieId(movieId) -> number|null` comes from the caller (ratings
// need GetRating + the store's weights, which this module can't reach).
export function rankUpsets (wins, nominations, ratingForMovieId, { limit = DEFAULT_LIMIT, minGap = 0.5 } = {}) {
  const winnersByContest = new Map();
  (wins || []).forEach((entry) => {
    const movie = entry.expanded?.movie;
    if (!movie || movie.id == null) return;
    winnersByContest.set(`${entry.year}|${entry.categoryKey}`, entry);
  });

  const upsets = [];
  winnersByContest.forEach((winnerEntry, contestKey) => {
    const [year, categoryKey] = contestKey.split('|');
    const winnerMovie = winnerEntry.expanded.movie;
    const winnerRating = ratingForMovieId(winnerMovie.id);
    if (!Number.isFinite(winnerRating)) return;

    let robbed = null;
    (nominations || []).forEach((entry) => {
      if (entry.year !== Number(year) || entry.categoryKey !== categoryKey) return;
      const movie = entry.expanded?.movie;
      if (!movie || movie.id == null || movie.id === winnerMovie.id) return;
      const rating = ratingForMovieId(movie.id);
      if (!Number.isFinite(rating)) return;
      if (!robbed || rating > robbed.rating) robbed = { entry, rating };
    });

    if (robbed && robbed.rating - winnerRating >= minGap) {
      upsets.push({
        year: Number(year),
        categoryKey,
        winner: winnerEntry.expanded,
        winnerRating,
        robbed: robbed.entry.expanded,
        robbedRating: robbed.rating,
        gap: robbed.rating - winnerRating
      });
    }
  });

  return upsets
    .sort((a, b) => b.gap - a.gap || b.year - a.year)
    .slice(0, limit);
}

// The "always the bridesmaid" shelf (user request: "the ability to see who
// has the most nominations without a win"): people ranked by nomination
// count, EXCLUDING anyone who has ever won — in any category, any year. A
// single win anywhere disqualifies; this is a list of the perpetually
// passed-over, not of win-to-nomination ratios.
export function rankPeopleWithoutWins (nominations, wins, options) {
  const winnerNames = new Set(
    (wins || []).filter((entry) => isPerson(entry.expanded)).map((entry) => entry.expanded.name)
  );
  const neverWon = (nominations || []).filter(
    (entry) => isPerson(entry.expanded) && !winnerNames.has(entry.expanded.name)
  );
  return rankPeople(neverWon, options);
}

// Ranks MOVIES by how many of the given entries point at them - including
// entries for people, which count for the film they were nominated for (see
// the note at the top). Keyed by TMDB movie id so two films sharing a title
// (a remake) stay separate.
export function rankMovies (entries, { limit = DEFAULT_LIMIT, minCount = DEFAULT_MIN_COUNT } = {}) {
  const byId = new Map();

  (entries || []).forEach((entry) => {
    const movie = entry.expanded?.movie;
    if (!movie || movie.id == null) return;
    if (!byId.has(movie.id)) byId.set(movie.id, { movieId: movie.id, movie, count: 0, entries: [] });
    const record = byId.get(movie.id);
    record.count += 1;
    record.entries.push(entry);
  });

  return [...byId.values()]
    .filter((film) => film.count >= minCount)
    .sort((a, b) => b.count - a.count || (a.movie.title || '').localeCompare(b.movie.title || ''))
    .slice(0, limit);
}
