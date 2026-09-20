// What goes IN the weekly newsletter, and what stays out.
//
// Pure and dependency-free (plain CommonJS) so it ships inside the Lambda zip
// AND is unit-tested from src/test/newsletterCompose.test.js — the same shape
// pushCadence.js uses, and for the same reason: every judgement here is one a
// wrong answer makes embarrassing rather than broken, so it needs to be
// readable and testable away from the network.
//
// Matt, 2026-09-20, after Brian's system: "once a week, the system would
// automatically go figure out what new release movies have been added to like
// streaming services and rental... gives a list of the best of those", plus
// "some movie from the past that was having an interesting anniversary... and
// then he had it write up a nice article about that movie".
//
// THE DIVISION OF LABOUR, which is the whole design: the APIs supply facts,
// the model supplies judgement. A film released this week is past any model's
// training cutoff, so asking it what critics thought is asking it to invent
// exactly the thing we're trying to avoid. TMDB says what came out and where
// it's watchable, OMDb says what critics scored it, this file decides what is
// even eligible — and only then does a model rank and write.

// --- New releases ------------------------------------------------------------

// Below this, a "new release" is somebody's home video upload or a festival
// entry nobody has seen. Measured against a real week (2026-09-06..19): 60
// candidates, 11 above the floor, and the 49 dropped were all noise.
const VOTE_FLOOR = 150;

// A digital "release" is not a release date. TMDB logs re-releases and new
// physical editions with fresh release_type 4/5 dates, so a straight window
// query puts FIGHT CLUB (1999) in a list of this week's new films — it really
// did, on the first run. A film counts as new only if it actually came out
// recently; the digital date says it reached the sofa, the release year says
// it is not a reissue.
const MAX_AGE_YEARS = 3;

/**
 * Where a film can be watched right now, flattened from TMDB's
 * /watch/providers shape into something a template can render.
 *
 * Returns null when it cannot be watched at all, which is a HARD exclusion:
 * the entire promise of the section is "available now", and TMDB's release
 * window includes titles whose providers haven't landed yet (one did on the
 * first real run).
 */
function availability (providers, region = 'US') {
  const here = providers?.results?.[region] || providers?.[region] || providers || {};
  const stream = (here.flatrate || []).map((p) => p.provider_name).filter(Boolean);
  const rent = [...(here.rent || []), ...(here.buy || [])].map((p) => p.provider_name).filter(Boolean);
  if (!stream.length && !rent.length) return null;
  return {
    stream,
    rent: [...new Set(rent)],
    // What the digest line says. Streaming wins the billing: "included with
    // something you already pay for" is a different offer from "$5.99".
    summary: stream.length ? `Streaming on ${stream[0]}` : `Rent on ${rent[0]}`
  };
}

/**
 * Rotten Tomatoes / Metacritic, parsed out of an OMDb response.
 *
 * A missing score is `null` — UNKNOWN, never zero. Direct-to-video animation,
 * foreign releases and small documentaries routinely carry no critic score at
 * all (Batman: Knightfall, on the first run), and scoring those as zero would
 * quietly delete a whole class of film from the newsletter. This is the same
 * distinction MovieDetail already makes for TMDB's box-office `0`.
 */
function criticScores (omdb) {
  const ratings = omdb?.Ratings || [];
  const find = (source) => ratings.find((r) => r.Source === source)?.Value ?? null;
  const pct = (value) => {
    const n = parseInt(String(value ?? '').replace('%', ''), 10);
    return Number.isFinite(n) ? n : null;
  };
  const meta = parseInt(omdb?.Metascore, 10);
  return {
    rottenTomatoes: pct(find('Rotten Tomatoes')),
    metacritic: Number.isFinite(meta) ? meta : null,
    imdb: (() => {
      const n = parseFloat(String(find('Internet Movie Database') ?? '').split('/')[0]);
      return Number.isFinite(n) ? n : null;
    })()
  };
}

/**
 * One 0–100 number for ordering the shortlist before a model ever sees it.
 *
 * CRITICS ONLY — Rotten Tomatoes and Metacritic. IMDb is deliberately not in
 * here, and the first live run is why: BATMAN: KNIGHTFALL PART 1 has no RT
 * score and no Metacritic score at all, an IMDb of 8.1, and came second in
 * the whole shortlist on that alone. IMDb's average is a popularity signal
 * wearing a score's clothing — fan enthusiasm for a comic property — which is
 * the exact inflation OMDb was added to correct for, walking back in through
 * the ranking. It stays in the brief as context the model can mention; it
 * does not get a vote.
 *
 * Returns null when no critic has scored the film, and callers must keep
 * those candidates rather than sinking them — see criticScores. An unscored
 * film orders behind every scored one but stays on the list, because "no
 * critic has written about it yet" is not the same as "it is bad", and the
 * model is given the nulls so it can say which it is.
 */
function acclaim (scores) {
  const parts = [];
  if (scores.rottenTomatoes != null) parts.push(scores.rottenTomatoes);
  if (scores.metacritic != null) parts.push(scores.metacritic);
  if (!parts.length) return null;
  return Math.round(parts.reduce((sum, n) => sum + n, 0) / parts.length);
}

function releaseYear (movie) {
  const year = parseInt(String(movie?.release_date || '').slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

/**
 * The eligible shortlist: everything that is genuinely new, genuinely
 * watchable, not already in the library, and above the noise floor.
 *
 * Deliberately does NOT pick the final five — that is a taste judgement made
 * later with the profile. This decides what is even allowed to be considered,
 * and every exclusion here is one the model can't undo.
 *
 * `enrich(movie)` returns `{ providers, omdb }` for one candidate; the caller
 * owns the network. `library` is a Set of TMDB ids already rated.
 */
function shortlistReleases ({
  candidates = [],
  enriched = new Map(),
  library = new Set(),
  now = Date.now(),
  voteFloor = VOTE_FLOOR,
  maxAgeYears = MAX_AGE_YEARS,
  limit = 25
} = {}) {
  const thisYear = new Date(now).getUTCFullYear();
  const seen = new Set();
  const rows = [];

  for (const movie of candidates) {
    if (!movie || !movie.id) continue;
    if (seen.has(movie.id)) continue;            // discover pages overlap
    seen.add(movie.id);
    if (library.has(movie.id)) continue;         // he's already rated it
    if ((movie.vote_count || 0) < voteFloor) continue;

    const year = releaseYear(movie);
    if (year != null && thisYear - year > maxAgeYears) continue;  // the Fight Club guard

    const extra = enriched.get(movie.id) || {};
    const where = availability(extra.providers);
    if (!where) continue;                        // not actually watchable yet

    const scores = criticScores(extra.omdb);
    rows.push({
      id: movie.id,
      title: movie.title,
      year,
      overview: movie.overview || '',
      voteCount: movie.vote_count || 0,
      tmdbScore: movie.vote_average ?? null,
      genres: extra.genres || [],
      director: extra.director || null,
      where,
      scores,
      acclaim: acclaim(scores)
    });
  }

  // Scored films first, best down; unscored keep their popularity order behind
  // them rather than being dropped.
  rows.sort((a, b) => {
    if (a.acclaim == null && b.acclaim == null) return b.voteCount - a.voteCount;
    if (a.acclaim == null) return 1;
    if (b.acclaim == null) return -1;
    return b.acclaim - a.acclaim;
  });
  return rows.slice(0, limit);
}

// --- The anniversary piece ---------------------------------------------------

// Anniversaries worth writing 500 words about. A 37th is not an anniversary,
// it's a date — the roundness is the entire hook, so the list is explicit
// rather than "divisible by five", which would call a 35th as loud as a 50th.
const ANNIVERSARY_YEARS = [10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];

// How loudly each one lands, which is what breaks ties between two films in
// the same week. A 50th beats a 10th even if the 10th is the better film;
// the section is "why this movie, this week".
const ANNIVERSARY_WEIGHT = {
  100: 100, 90: 70, 80: 72, 75: 85, 70: 68, 60: 66, 50: 90, 40: 75, 30: 70, 25: 80, 20: 60, 15: 45, 10: 50
};

function daysBetween (a, b) {
  return Math.round((b - a) / 86400000);
}

/**
 * Films whose release anniversary falls inside the coming week.
 *
 * Works on UTC month/day so a timezone can't move an anniversary across a
 * date boundary and report the wrong number of years. The window is
 * inclusive of today — an anniversary that is TODAY is the best possible
 * version of this section, not a missed one.
 */
function anniversariesThisWeek (films = [], now = Date.now(), windowDays = 7) {
  const today = new Date(now);
  const out = [];

  for (const film of films) {
    const released = String(film?.release_date || '');
    const year = parseInt(released.slice(0, 4), 10);
    const month = parseInt(released.slice(5, 7), 10);
    const day = parseInt(released.slice(8, 10), 10);
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) continue;

    // The anniversary date in the CURRENT year, and in the next one — a week
    // that straddles New Year still has to find a 2 January anniversary.
    for (const inYear of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
      const at = Date.UTC(inYear, month - 1, day);
      const offset = daysBetween(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()), at);
      if (offset < 0 || offset >= windowDays) continue;
      const age = inYear - year;
      if (!ANNIVERSARY_YEARS.includes(age)) continue;
      out.push({
        id: film.id,
        title: film.title,
        year,
        releaseDate: released,
        age,
        daysAway: offset,
        weight: ANNIVERSARY_WEIGHT[age] || 0,
        voteCount: film.vote_count || 0,
        overview: film.overview || ''
      });
      break;
    }
  }

  // Loudest anniversary first; among equals, the film more people have seen,
  // because the piece has to be worth reading for somebody who hasn't.
  out.sort((a, b) => (b.weight - a.weight) || (b.voteCount - a.voteCount));
  return out;
}

// A film is also worth writing about when it is simply BACK — re-entering
// TMDB's weekly trending list decades after release means something happened:
// a re-release, a death, an awards run, a streaming arrival, a reference in
// something new. We can see the effect without knowing the cause, which is
// enough to justify a piece.
//
// Matt, 2026-09-20: "we ought to scan the whole week for information or
// things that have brought it up… whatever the most noteworthy anniversary
// or, like I said, something's in the zeitgeist."
const TRENDING_WEIGHT = 65;

// Below this a "trending old film" is just catalogue drift.
const TRENDING_MIN_AGE_YEARS = 8;

// Ages worth marking for a PERSON.
//
// EVERY MULTIPLE OF FIVE, not just the big round ones. The first version took
// only decades and quarters, which sounds right and is arithmetically almost
// never: one person's birthday lands in a given week about 1.9% of the time,
// so twelve people and eight eligible ages fire roughly twice a year. At
// multiples of five it is a few times a quarter — rare enough to stay a
// treat, common enough to be a real source of variety.
//
// The weights keep the hierarchy that the narrow list was trying to express:
// a centenary is an event, a 65th birthday is a footnote, and a footnote
// scores below every film anniversary so it only ever wins a thin week.
const isMultipleOfFive = (n) => Number.isInteger(n) && n > 0 && n % 5 === 0;
const PERSON_MIN_BIRTHDAY = 50;   // a director turning 45 is not news
const PERSON_MIN_DEATH = 5;

const PERSON_WEIGHT = { 100: 95, 125: 92, 110: 88, 90: 78, 80: 76, 75: 74, 70: 70, 60: 66 };
const PERSON_DEATH_WEIGHT = { 100: 94, 75: 86, 50: 84, 40: 76, 30: 72, 25: 74, 20: 70, 10: 68 };

// What a plain multiple of five is worth when it is not one of the above.
const PERSON_MINOR_WEIGHT = 55;

// A new release remaking an older film ties the two halves of the issue
// together, which is worth more than a minor birthday and less than a major
// one.
const ORIGINAL_WEIGHT = 72;

function sameWeek (isoDate, now, windowDays = 7) {
  const month = parseInt(String(isoDate || '').slice(5, 7), 10);
  const day = parseInt(String(isoDate || '').slice(8, 10), 10);
  if (!Number.isFinite(month) || !Number.isFinite(day)) return null;
  const today = new Date(now);
  const midnight = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  for (const inYear of [today.getUTCFullYear(), today.getUTCFullYear() + 1]) {
    const at = Date.UTC(inYear, month - 1, day);
    const offset = Math.round((at - midnight) / 86400000);
    if (offset >= 0 && offset < windowDays) return inYear;
  }
  return null;
}

/**
 * People with a round birth or death anniversary this week, each carrying the
 * film the piece would hang on.
 *
 * The people come from the reader's own taste profile, so this can only ever
 * surface somebody whose work they already rate — which is the point. The
 * article is about the person; the film is the subject a hat button can hold.
 */
function personAnniversaries (people = [], now = Date.now()) {
  const out = [];
  for (const person of people) {
    if (!person?.film?.id) continue;

    const deathYear = sameWeek(person.deathday, now);
    if (deathYear != null) {
      const age = deathYear - parseInt(String(person.deathday).slice(0, 4), 10);
      if (isMultipleOfFive(age) && age >= PERSON_MIN_DEATH) {
        out.push({
          person, age, kind: 'death', weight: PERSON_DEATH_WEIGHT[age] || PERSON_MINOR_WEIGHT
        });
        continue;   // one claim per person; a death anniversary is the louder
      }
    }

    const birthYear = sameWeek(person.birthday, now);
    if (birthYear != null) {
      const age = birthYear - parseInt(String(person.birthday).slice(0, 4), 10);
      if (isMultipleOfFive(age) && age >= PERSON_MIN_BIRTHDAY) {
        out.push({ person, age, kind: 'birth', weight: PERSON_WEIGHT[age] || PERSON_MINOR_WEIGHT });
      }
    }
  }
  return out.sort((a, b) => (b.weight - a.weight) || (b.person.film.vote_count - a.person.film.vote_count));
}

/**
 * Everything with a claim on the feature slot this week, ranked.
 *
 * Two kinds of claim, scored on one scale so they can compete:
 *
 *   anniversary — a round birthday falling in the coming seven days. The
 *                 roundness is the hook, so a 50th outranks a 10th.
 *   trending    — an old film back in TMDB's weekly trending list.
 *
 * A film with BOTH claims is the strongest thing on the list and gets a
 * bonus, because "it turns 40 this week AND people are watching it again" is
 * a better reason than either alone.
 */
function featureCandidates ({
  anniversaries = [],
  trending = [],
  people = [],
  originals = [],
  now = Date.now(),
  minAgeYears = TRENDING_MIN_AGE_YEARS,
  limit = 12
} = {}) {
  const thisYear = new Date(now).getUTCFullYear();
  const byId = new Map();

  for (const a of anniversaries) {
    byId.set(a.id, {
      id: a.id,
      title: a.title,
      year: a.year,
      releaseDate: a.releaseDate,
      overview: a.overview,
      voteCount: a.voteCount,
      reason: 'anniversary',
      turning: a.age,
      daysAway: a.daysAway,
      alsoTrending: false,
      weight: a.weight
    });
  }

  for (const t of trending) {
    const year = parseInt(String(t?.release_date || '').slice(0, 4), 10);
    if (!Number.isFinite(year) || thisYear - year < minAgeYears) continue;
    const existing = byId.get(t.id);
    if (existing) {
      // Both claims at once — the best hook there is.
      existing.alsoTrending = true;
      existing.weight += 10;
      continue;
    }
    byId.set(t.id, {
      id: t.id,
      title: t.title,
      year,
      releaseDate: t.release_date,
      overview: t.overview || '',
      voteCount: t.vote_count || 0,
      reason: 'trending',
      turning: null,
      daysAway: null,
      alsoTrending: true,
      weight: TRENDING_WEIGHT
    });
  }

  // A person's round anniversary, hung on their signature film. If that film
  // is already on the list for its own reasons, the person is the better hook
  // — two occasions at once — so it replaces the weaker claim.
  for (const entry of personAnniversaries(people, now)) {
    const film = entry.person.film;
    const year = parseInt(String(film.release_date || '').slice(0, 4), 10) || null;
    const was = entry.kind === 'death' ? 'died' : 'was born';
    const candidate = {
      id: film.id,
      title: film.title,
      year,
      releaseDate: film.release_date,
      overview: film.overview,
      voteCount: film.vote_count,
      reason: 'person',
      turning: null,
      alsoTrending: false,
      person: `${entry.person.name} ${was} ${entry.age} years ago this week`,
      occasion: entry.kind,
      weight: entry.weight
    };
    const existing = byId.get(film.id);
    if (!existing || candidate.weight > existing.weight) byId.set(film.id, candidate);
  }

  // An older film a new release shares its title with. Unverified by
  // construction — the brief says so and the model is told to drop it if the
  // two turn out to be unrelated.
  for (const entry of originals) {
    const film = entry?.original;
    if (!film?.id || byId.has(film.id)) continue;
    byId.set(film.id, {
      id: film.id,
      title: film.title,
      year: film.year,
      releaseDate: film.release_date,
      overview: film.overview || '',
      voteCount: film.vote_count || 0,
      reason: 'original',
      turning: null,
      alsoTrending: false,
      relatedTo: entry.newTitle,
      occasion: null,
      weight: ORIGINAL_WEIGHT
    });
  }

  return [...byId.values()]
    .sort((a, b) => (b.weight - a.weight) || (b.voteCount - a.voteCount))
    .slice(0, limit);
}

// --- The issue ---------------------------------------------------------------

/**
 * The facts handed to the model, and nothing else.
 *
 * Everything in here came from an API or from the user's own library. The
 * model's job is to rank, explain and write — never to remember. If a field
 * is null it stays null, so the prompt can say "no critic score" rather than
 * letting the model fill the hole from whatever it half-recalls.
 */
function issueBrief ({ shortlist = [], features = [], profile = null, weekOf = null } = {}) {
  return {
    weekOf,
    profile,
    releases: shortlist.map((r) => ({
      id: r.id,
      title: r.title,
      year: r.year,
      director: r.director,
      genres: r.genres,
      overview: r.overview,
      rottenTomatoes: r.scores.rottenTomatoes,
      metacritic: r.scores.metacritic,
      imdb: r.scores.imdb,
      availability: r.where.summary,
      streamingOn: r.where.stream,
      rentOn: r.where.rent
    })),
    // Named `features` rather than `anniversaries` since 2026-09-20: a round
    // birthday is one claim on the slot, being back in circulation is
    // another, and the model is told which is which so it can say WHY this
    // film, this week.
    // NOTE: `daysAway` is deliberately NOT in the brief. It was, and the
    // model reached straight for it — picking a 40th falling exactly on
    // press day over a 75th four days later, and opening with "forty years
    // ago today". Matt, 2026-09-20: "I don't care so much that the
    // anniversary was exactly the day that the newsletter was being
    // written." The week is the unit; the day inside it is noise, and the
    // surest way to stop the model weighing it is not to tell it.
    features: features.map((f) => ({
      id: f.id,
      title: f.title,
      year: f.year,
      reason: f.reason,
      turning: f.turning,
      occasion: f.occasion || null,
      person: f.person || null,
      relatedTo: f.relatedTo || null,
      alsoTrendingNow: f.alsoTrending
    }))
  };
}

/**
 * The ISO date of the Friday an issue belongs to, which is also its id.
 *
 * Issues are keyed by their week, not by when the job happened to run: a
 * retry, a manual devMode rebuild and the scheduled run all have to land on
 * the same issue rather than stacking three up. UTC throughout — the key is
 * an identifier, not a display date.
 */
function weekKey (now = Date.now()) {
  const d = new Date(now);
  const day = d.getUTCDay();                    // 0 Sun … 5 Fri … 6 Sat
  const back = (day - 5 + 7) % 7;               // days since the most recent Friday
  const friday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
  return friday.toISOString().slice(0, 10);
}

/**
 * Whether this account should get an issue right now.
 *
 * `alwaysOn` is the testing switch Matt asked for ("set it up just for
 * testing so that it shows up all the time"): it bypasses the day-of-week and
 * the already-sent check, so a devMode rebuild always produces something to
 * look at. It never bypasses the OPT-IN — an account that said no stays off
 * even in testing.
 */
function issueDue ({ prefs = {}, lastIssue = null, now = Date.now(), alwaysOn = false } = {}) {
  if (!prefs.newsletter) return { due: false, reason: 'not opted in' };
  const key = weekKey(now);
  if (alwaysOn) return { due: true, weekKey: key, reason: 'always-on (testing)' };
  if (new Date(now).getUTCDay() !== 5) return { due: false, reason: 'not Friday' };
  if (lastIssue === key) return { due: false, reason: 'this week already sent' };
  return { due: true, weekKey: key, reason: 'Friday, no issue yet' };
}

module.exports = {
  VOTE_FLOOR,
  MAX_AGE_YEARS,
  ANNIVERSARY_YEARS,
  TRENDING_WEIGHT,
  TRENDING_MIN_AGE_YEARS,
  availability,
  criticScores,
  acclaim,
  releaseYear,
  shortlistReleases,
  anniversariesThisWeek,
  personAnniversaries,
  featureCandidates,
  PERSON_MIN_BIRTHDAY,
  PERSON_MIN_DEATH,
  PERSON_MINOR_WEIGHT,
  ORIGINAL_WEIGHT,
  issueBrief,
  weekKey,
  issueDue
};
