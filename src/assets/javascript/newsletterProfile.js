// The taste profile the weekly newsletter ranks against.
//
// THE CLIENT COMPUTES, THE SERVER SENDS — the same rule pushDigest.js exists
// for, and here it is not a preference but a necessity: `calculatedTotal` is
// never persisted (see CLAUDE.md), so a score only exists where `getRating`
// runs. A Lambda that wanted to rank by taste would have to reimplement the
// eight weighted criteria from scratch, and that second copy would drift from
// this one the first time a weight moved.
//
// So the app publishes this compact profile to `{topKey}/newsletter/profile`
// alongside the push digest, and aws-lambda/newsletter.js only reads it.
//
// It is deliberately SMALL. It goes into a prompt, so every field has to earn
// its tokens, and a profile listing two hundred directors tells a model less
// than one listing twelve. What it must carry is the shape of a taste —
// whose work he seeks out, what he reaches for, what he has already seen —
// not a dump of the library.

// How many of each kind of favourite to publish. Twelve is enough for a model
// to spot a pattern and few enough that the prompt stays cheap.
const TOP_N = 12;

// Nobody is a "favourite director" on the strength of one film. The same
// minimum the Favorite sections use, and for the same reason: one great movie
// is an accident, three is a preference.
const MIN_FILMS = 3;

/**
 * A person's standing, shrunk toward the library's own average.
 *
 * Without the shrink, whoever happens to hold the single highest-rated film
 * tops every list — a director with one 9.6 would outrank one with eight
 * films averaging 8.9, which is not what "favourite director" means. This is
 * the plain Bayesian form the Favorite sections already use.
 */
function shrunkAverage (scores, libraryAverage, weight = MIN_FILMS) {
  if (!scores.length) return null;
  const total = scores.reduce((sum, n) => sum + n, 0);
  return (total + libraryAverage * weight) / (scores.length + weight);
}

// Crew jobs worth profiling, and what to call them. Directors and writers are
// the two a recommendation can actually act on — "a new Villeneuve" is a
// reason to watch something; "a new gaffer" is not.
const CREW_ROLES = [
  { key: 'directors', label: 'director', match: (job) => job === 'Director' },
  { key: 'writers', label: 'writer', match: (job) => ['Writer', 'Screenplay', 'Story', 'Novel'].includes(job) }
];

function collectPeople (entries, scoreOf, match) {
  const byName = new Map();
  for (const entry of entries) {
    const score = scoreOf(entry);
    if (score == null) continue;
    const crew = entry?.movie?.crew;
    if (!Array.isArray(crew)) continue;
    // One person, one film, one credit — a writer credited "Screenplay" AND
    // "Novel" is one appearance, not two. Same rule personCredits.js enforces
    // for the Favorite sections, where double-counting moved the ranking.
    const seen = new Set();
    for (const person of crew) {
      if (!person?.name || !match(person.job)) continue;
      if (seen.has(person.name)) continue;
      seen.add(person.name);
      if (!byName.has(person.name)) byName.set(person.name, []);
      byName.get(person.name).push(score);
    }
  }
  return byName;
}

function rankPeople (byName, libraryAverage) {
  const rows = [];
  for (const [name, scores] of byName) {
    if (scores.length < MIN_FILMS) continue;
    rows.push({ name, films: scores.length, average: Number(shrunkAverage(scores, libraryAverage).toFixed(2)) });
  }
  rows.sort((a, b) => b.average - a.average || b.films - a.films);
  return rows.slice(0, TOP_N);
}

function rankGenres (entries, scoreOf, libraryAverage) {
  const byGenre = new Map();
  for (const entry of entries) {
    const score = scoreOf(entry);
    if (score == null) continue;
    for (const genre of entry?.movie?.genres || []) {
      if (!genre?.name) continue;
      if (!byGenre.has(genre.name)) byGenre.set(genre.name, []);
      byGenre.get(genre.name).push(score);
    }
  }
  const rows = [];
  for (const [name, scores] of byGenre) {
    if (scores.length < MIN_FILMS) continue;
    rows.push({ name, films: scores.length, average: Number(shrunkAverage(scores, libraryAverage).toFixed(2)) });
  }
  rows.sort((a, b) => b.average - a.average);
  return { loved: rows.slice(0, 6), coolOn: rows.slice(-3).reverse() };
}

// What still counts as "lately". A count-based window alone (the most recent
// sixty ratings) reads as recent in a 1,400-film library and reads as
// "everything he ever rated" in a small one — which put a 2015 rating in a
// section called recent highs the first time this was tested. Both guards, so
// the answer is honest at any library size.
const RECENT_WINDOW_MS = 550 * 24 * 60 * 60 * 1000;   // ~18 months
const RECENT_WINDOW_COUNT = 60;

/**
 * The films he has rated most highly lately.
 *
 * Recent AND high, not just high: a profile built only from all-time
 * favourites describes who he was, and the newsletter is recommending for who
 * he is now. Capped hard — these are examples for a model, not a list.
 */
function recentHighs (entries, scoreOf, dateOf, limit = 10, now = Date.now()) {
  return entries
    .map((entry) => ({ entry, score: scoreOf(entry), at: dateOf(entry) }))
    .filter((row) => row.score != null && row.at)
    .filter((row) => now - row.at <= RECENT_WINDOW_MS)
    .sort((a, b) => b.at - a.at)
    .slice(0, RECENT_WINDOW_COUNT)
    .filter((row) => row.score >= 7.5)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((row) => ({
      title: row.entry?.movie?.title,
      year: parseInt(String(row.entry?.movie?.release_date || '').slice(0, 4), 10) || null,
      score: Number(row.score.toFixed(1))
    }))
    .filter((row) => row.title);
}

/**
 * The whole profile, published to `{topKey}/newsletter/profile`.
 *
 * `getRating` and the date accessor are injected rather than imported so this
 * stays pure and testable, matching how buildPushDigest takes getRating.
 */
export function buildNewsletterProfile ({ entries = [], getRating, now = Date.now() } = {}) {
  const scoreOf = (entry) => {
    const rating = getRating?.(entry);
    const total = rating?.calculatedTotal;
    return typeof total === 'number' && Number.isFinite(total) ? total : null;
  };
  const dateOf = (entry) => {
    const ratings = entry?.ratings;
    if (!Array.isArray(ratings) || !ratings.length) return null;
    const stamps = ratings.map((r) => new Date(r?.date ?? 0).getTime()).filter(Number.isFinite);
    return stamps.length ? Math.max(...stamps) : null;
  };

  const scored = entries.map(scoreOf).filter((n) => n != null);
  const libraryAverage = scored.length
    ? scored.reduce((sum, n) => sum + n, 0) / scored.length
    : 5;

  const profile = {
    updatedAt: now,
    libraryCount: entries.length,
    libraryAverage: Number(libraryAverage.toFixed(2)),
    genres: rankGenres(entries, scoreOf, libraryAverage),
    recentHighs: recentHighs(entries, scoreOf, dateOf, 10, now)
  };

  for (const role of CREW_ROLES) {
    profile[role.key] = rankPeople(collectPeople(entries, scoreOf, role.match), libraryAverage);
  }

  // Every TMDB id already in the library, so the Lambda can exclude them from
  // the digest without shipping the library itself. Ids only — it is a
  // membership test, and 1,400 numbers is a few KB where 1,400 entries is
  // megabytes.
  profile.seenIds = entries
    .map((entry) => entry?.movie?.id)
    .filter((id) => typeof id === 'number');

  return profile;
}

export { MIN_FILMS, TOP_N, RECENT_WINDOW_MS, shrunkAverage };
