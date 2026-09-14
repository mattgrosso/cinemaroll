// Pure, store-free logic for the Watchlist screen (bug-report request:
// "generate watchlists based on my ratings and also maybe a way to make a
// list of movies that I should consider rewatching").
//
// Three pieces, all fed explicit inputs (the searchFiltering.js precedent):
//   - rewatchCandidates: library movies you loved but haven't logged in a
//     long time — entirely local, no network.
//   - favoritePeople: the directors/actors your OWN ratings say you love,
//     used to seed the TMDB watchlist queries.
//   - rankWatchlistCandidates: turns those people's TMDB filmographies into
//     one deduped, unseen-only, quality-ranked list.

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

// Tolerates ms-epoch numbers and date strings; null when nothing parses.
function lastWatchedAt (entry) {
  const times = (entry?.ratings || [])
    .map((rating) => new Date(rating?.date ?? NaN).getTime())
    .filter((time) => Number.isFinite(time));
  return times.length ? Math.max(...times) : null;
}

// Cycle-based rewatching (feedback 2026-08-15: "for my very favorite
// movies, I probably wanna watch them on a two to three year cycle at the
// very top" — the old how-loved x how-long score just reproduced the top
// shelf). Every qualifying movie gets a due CYCLE from how loved it is,
// and the list ranks by how OVERDUE it is relative to its own cycle — so
// favorites resurface often by design, an 8 from six years ago outranks a
// 9.5 from eighteen months ago, and nothing appears before its time.
const REWATCH_CYCLES = [
  { minRating: 9.5, years: 2 },
  { minRating: 9, years: 3 },
  { minRating: 8, years: 5 },
  { minRating: 7, years: 8 }
];

export function rewatchCycleYears (rating) {
  const tier = REWATCH_CYCLES.find((t) => rating >= t.minRating);
  return tier ? tier.years : null;
}

// `exclude` drops entries BEFORE the cap is applied.
//
// Bug report, 2026-08-19: "we have a method now for me to like hit the X and
// sort of punt on some, but I would've expected those to refill themselves,
// but my watchlist have just remained with fewer movies in them."
//
// They didn't refill because the caller filtered punted films out of the
// already-capped list: cap to 24, then remove 3, leaves 21, and candidate 25
// never moved up. Excluding here means the cap is filled with what a viewer
// can actually be shown, so punting one promotes the next in line.
export function rewatchCandidates (entries, getRatingFn, now = Date.now(), { dueThreshold = 1, cap = 24, exclude = null } = {}) {
  return (entries || [])
    .filter((entry) => !exclude || !exclude(entry))
    .map((entry) => {
      const rating = getRatingFn(entry)?.calculatedTotal;
      const watchedAt = lastWatchedAt(entry);
      if (!Number.isFinite(rating) || watchedAt == null) return null;
      const cycle = rewatchCycleYears(rating);
      if (cycle == null) return null;
      const yearsSince = (now - watchedAt) / YEAR_MS;
      // Overdue ratio: 1 = exactly due. Capped so an ancient mid-tier
      // movie can't bury every recently-due favorite.
      const overdue = Math.min(yearsSince / cycle, 3);
      if (overdue < dueThreshold) return null;
      return { entry, rating, yearsSince, cycle, overdue, score: overdue };
    })
    .filter(Boolean)
    .sort((a, b) => (b.score - a.score) || (b.rating - a.rating))
    .slice(0, cap);
}

// "Give these another shot" (feedback 2026-08-15): movies YOU rated coolly
// that the wider world loves — ranked by the differential between TMDB's
// community average and your own score. Needs movie.vote_average /
// vote_count in the stored shape (backfilled server-side like taglines);
// entries without them are skipped, and a vote-count floor keeps
// obscure-but-inflated titles out.
//
// Recency matters (report 2026-08-21: "if I watched it recently, I don't
// need to give it another shot right away"). Two ways: nothing within two
// years resurfaces at all — a movie you didn't like shouldn't come back
// faster than the 2-3 year cycle even a top favorite gets — and the
// differential only earns its full ranking weight once the viewing has had
// `rampYears` to fade, so an eight-year-old miss outranks a two-year-old
// one with the same score gap.
export function anotherShotCandidates (entries, getRatingFn, now = Date.now(), {
  maxYourRating = 6.5,
  minCommunity = 7.4,
  minVotes = 200,
  minYears = 2,
  rampYears = 5,
  cap = 24,
  // Same as rewatchCandidates: excluded before the cap, so punting refills.
  exclude = null
} = {}) {
  return (entries || [])
    .filter((entry) => !exclude || !exclude(entry))
    .map((entry) => {
      const yours = getRatingFn(entry)?.calculatedTotal;
      const community = entry?.movie?.vote_average;
      const votes = entry?.movie?.vote_count;
      const watchedAt = lastWatchedAt(entry);
      if (!Number.isFinite(yours) || !Number.isFinite(community) || watchedAt == null) return null;
      if (yours > maxYourRating || community < minCommunity) return null;
      if (!Number.isFinite(votes) || votes < minVotes) return null;
      const yearsSince = (now - watchedAt) / YEAR_MS;
      if (yearsSince < minYears) return null;
      const fade = Math.min(1, yearsSince / rampYears);
      return { entry, yours, community, yearsSince, score: (community - yours) * fade };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)
    .slice(0, cap);
}

// How many people a "from people you love" row draws on. Three, until
// 2026-09-13: "these categories always seem kind of narrow... let's rethink
// these so they are more broadly applicable or derived from a broader base
// of information." Five names pool five filmographies, so the row is a
// blend rather than one person's back catalogue.
export const PEOPLE_PER_SECTION = 5;

// A row built on a single person isn't a watchlist, it's that person's
// filmography — "the actresses you loved one is just based entirely on
// [Julianne] Moore. That's not enough information to build a whole list out
// of." Below this many names, the section doesn't render at all.
export const MIN_PEOPLE_PER_SECTION = 2;

// The people your ratings actually favor: average score of their movies in
// YOUR library, weighted by how many there are (avg * log2(count + 1)) so
// one great movie doesn't beat a consistently-loved filmography. role is
// 'director' (crew job === 'Director') or 'actor' (top-billed cast).
export function favoritePeople (entries, getRatingFn, { role = 'director', minMovies = 2, cap = PEOPLE_PER_SECTION, castDepth = 5 } = {}) {
  const byName = new Map();

  (entries || []).forEach((entry) => {
    const rating = getRatingFn(entry)?.calculatedTotal;
    if (!Number.isFinite(rating)) return;

    const names = role === 'director'
      ? (entry?.movie?.crew || []).filter((person) => person.job === 'Director').map((person) => person.name)
      : (entry?.movie?.cast || []).slice(0, castDepth).map((person) => person.name);

    new Set(names.filter(Boolean)).forEach((name) => {
      if (!byName.has(name)) byName.set(name, { name, count: 0, total: 0 });
      const record = byName.get(name);
      record.count += 1;
      record.total += rating;
    });
  });

  return [...byName.values()]
    .filter((person) => person.count >= minMovies)
    .map((person) => ({
      name: person.name,
      count: person.count,
      avgRating: person.total / person.count,
      score: (person.total / person.count) * Math.log2(person.count + 1)
    }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, cap);
}

/**
 * People whose films you rate higher than the world does — "a third one for
 * actors and actresses combined, who I like more than most people"
 * (2026-08-17).
 *
 * Not the same question as favoritePeople, which asks who you rate highly
 * outright and so fills up with people who happen to be in great films.
 * This is a LIFT: your score against TMDB's `vote_average` on the very same
 * films, so it surfaces the people you personally rate above the consensus.
 *
 * Both scales are 0-10 already. Ratings without a usable vote_average are
 * skipped rather than treated as a zero, which would invent a huge lift.
 */
export function peopleYouRateHigher (entries, getRatingFn, { role = 'actor', minMovies = 3, cap = PEOPLE_PER_SECTION, castDepth = 5 } = {}) {
  const byName = new Map();

  (entries || []).forEach((entry) => {
    const rating = getRatingFn(entry)?.calculatedTotal;
    const world = entry?.movie?.vote_average;
    if (!Number.isFinite(rating) || !Number.isFinite(world) || world <= 0) return;

    const names = role === 'director'
      ? (entry?.movie?.crew || []).filter((person) => person.job === 'Director').map((person) => person.name)
      : (entry?.movie?.cast || []).slice(0, castDepth).map((person) => person.name);

    new Set(names.filter(Boolean)).forEach((name) => {
      if (!byName.has(name)) byName.set(name, { name, count: 0, lift: 0 });
      const record = byName.get(name);
      record.count += 1;
      record.lift += rating - world;
    });
  });

  return [...byName.values()]
    .filter((person) => person.count >= minMovies)
    .map((person) => ({
      name: person.name,
      count: person.count,
      avgLift: person.lift / person.count,
      // Same damping favoritePeople uses: three films shouldn't outrank ten.
      score: (person.lift / person.count) * Math.log2(person.count + 1)
    }))
    .filter((person) => person.avgLift > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, cap);
}

// TMDB credit lists -> one watchlist. Drops movies already in the library
// (by TMDB id), unreleased/undated ones, and low-signal entries (too few
// votes to trust the score). Dedupes across people, keeping whichever copy
// arrived first. Ranked by vote_average weighted by vote volume so a 7.9
// with 12k votes beats an 8.6 with 60.
// Your taste, learned from your own ratings (feedback 2026-08-15: "tailor
// those recommendations not just based on TMDB user ratings, but... some
// amount of information from what I tend to like"). Per-genre affinity =
// how far your average rating for that genre sits above/below your overall
// average, damped by sample size (log2(count+1)/4, capped 1) so two lucky
// horror movies don't brand you a horror fan. Returned as {genreId: delta}
// in roughly [-2, +2].
export function tasteProfile (entries, getRatingFn) {
  const perGenre = new Map(); // id -> { sum, count }
  let total = 0;
  let count = 0;

  (entries || []).forEach((entry) => {
    const rating = getRatingFn(entry)?.calculatedTotal;
    if (!Number.isFinite(rating)) return;
    total += rating;
    count += 1;
    (entry?.movie?.genres || []).forEach((genre) => {
      if (genre?.id == null) return;
      const g = perGenre.get(genre.id) || { sum: 0, count: 0 };
      g.sum += rating;
      g.count += 1;
      perGenre.set(genre.id, g);
    });
  });

  if (!count) return {};
  const overall = total / count;
  const profile = {};
  perGenre.forEach((g, id) => {
    const confidence = Math.min(1, Math.log2(g.count + 1) / 4);
    profile[id] = ((g.sum / g.count) - overall) * confidence;
  });
  return profile;
}

// A candidate's taste bonus: mean of its genres' affinities (TMDB discover
// rows carry genre_ids). Zero when nothing is known.
export function tasteBonus (movie, profile) {
  const ids = movie?.genre_ids || (movie?.genres || []).map((g) => g?.id);
  const known = (ids || []).filter((id) => Number.isFinite(profile?.[id]));
  if (!known.length) return 0;
  return known.reduce((sum, id) => sum + profile[id], 0) / known.length;
}

export function rankWatchlistCandidates (credits, ratedTmdbIds, now = Date.now(), { cap = 12, minVotes = 50, profile = null } = {}) {
  const rated = ratedTmdbIds instanceof Set ? ratedTmdbIds : new Set(ratedTmdbIds || []);
  const byId = new Map();

  (credits || []).forEach((movie) => {
    if (!movie || movie.id == null || rated.has(movie.id)) return;
    if (movie.adult) return;
    const released = movie.release_date && new Date(movie.release_date).getTime() <= now;
    if (!released) return;
    if ((movie.vote_count || 0) < minVotes) return;
    if (!byId.has(movie.id)) byId.set(movie.id, movie);
  });

  const scored = [...byId.values()]
    // Base quality plus (when a profile is given) a taste term: each point
    // of genre affinity is worth about a point of community rating.
    .map((movie) => ({
      movie,
      score: (movie.vote_average || 0) * Math.log10((movie.vote_count || 0) + 1) +
        (profile ? tasteBonus(movie, profile) * Math.log10((movie.vote_count || 0) + 1) : 0)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, cap);

  // Match % (Brian-survey D1): the section's scores min-max scaled into
  // 62-97 — shown items already passed quality/unseen filters, so nothing
  // reads as a bad match, and nothing claims perfection.
  const max = scored[0]?.score ?? 1;
  const min = scored[scored.length - 1]?.score ?? 0;
  const span = max - min || 1;
  return scored.map(({ movie, score }) => ({
    ...movie,
    matchPct: Math.round(62 + ((score - min) / span) * 35)
  }));
}

// The movies to seed "more like this" recommendations from: your highest
// rated, one per title. Ties keep library order (stable sort).
export function topRatedSeeds (entries, getRatingFn, { cap = 5 } = {}) {
  return (entries || [])
    .filter((entry) => typeof entry?.movie?.id === 'number')
    .map((entry) => ({ entry, rating: getRatingFn(entry)?.calculatedTotal ?? 0 }))
    .sort((a, b) => b.rating - a.rating)
    .slice(0, cap)
    .map(({ entry }) => entry);
}

// Every TMDB id already in the library — the "unseen only" filter's input.
export function ratedTmdbIds (entries) {
  return new Set(
    (entries || [])
      .map((entry) => entry?.movie?.id)
      .filter((id) => typeof id === 'number')
  );
}

// "Fill out your award years" (feedback 2026-08-15: "I'm often trying to
// get my years up to 10 so I can fill in my awards"). Every year you've
// started but not finished, closest to done first — the screen then suggests
// well-regarded unseen movies from whichever you pick. Threshold comes from
// the same settings value the awards flow uses, so this always chases
// whatever "10" currently means.
//
// `reach` and `cap` used to default to 4 and 3, which is what produced three
// standalone "Get YYYY to 10" sections and the question behind this change
// (2026-08-19): "How did you choose which years to include... it seems like
// an arbitrary number of lists." They were arbitrary — the closest three of
// the years within four of the threshold, which is neither "the newest few"
// nor all of them. Nothing is culled now; the screen shows the whole list in
// a selector labelled with each year's own distance, so the ordering explains
// itself. Both options are kept for callers that do want a short list.
export function nearThresholdYears (entries, threshold = 10, { reach = Infinity, cap = Infinity } = {}) {
  const counts = {};
  (entries || []).forEach((entry) => {
    const date = entry?.movie?.release_date;
    if (!date) return;
    if (entry.movie.runtime && entry.movie.runtime <= 40) return; // shorts don't count for awards
    const year = new Date(date).getFullYear();
    if (!Number.isFinite(year)) return;
    counts[year] = (counts[year] || 0) + 1;
  });

  return Object.entries(counts)
    .map(([year, count]) => ({ year: Number(year), count, missing: threshold - count }))
    .filter(({ missing }) => missing >= 1 && missing <= reach)
    .sort((a, b) => (a.missing - b.missing) || (b.year - a.year))
    .slice(0, cap);
}

// "Not yet" punts (feedback 2026-08-15: dismiss a suggestion and have it
// return later — "we can kinda learn from that what my actual thresholds
// are"). Stored at settings/watchlistPunts/<key> as { until, count, at };
// each successive punt of the same item doubles the snooze (60d, 120d,
// 240d, capped at 2 years). The punt history itself is the learning
// signal for future threshold tuning.
const PUNT_BASE_MS = 60 * 24 * 60 * 60 * 1000;
const PUNT_MAX_MS = 2 * YEAR_MS;

export function puntKeyFor (item) {
  if (item?.dbKey) return `entry-${item.dbKey}`;
  const id = item?.movie?.id ?? item?.id;
  return id != null ? `tmdb-${id}` : null;
}

export function nextPunt (existing, now = Date.now()) {
  const count = (existing?.count || 0) + 1;
  const duration = Math.min(PUNT_BASE_MS * Math.pow(2, count - 1), PUNT_MAX_MS);
  return { count, at: now, until: now + duration };
}

export function isPunted (item, punts, now = Date.now()) {
  const key = puntKeyFor(item);
  if (!key || !punts?.[key]) return false;
  return Number.isFinite(punts[key].until) && punts[key].until > now;
}
