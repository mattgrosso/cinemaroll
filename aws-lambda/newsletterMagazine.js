// The newsletter as a magazine (Matt, 2026-11-20: "make this thing look more
// like an article in a magazine ... some pictures", and "several articles ...
// a highlight of a performer or of something going on in the box office ...
// a fun newsletter that feels like a full newsletter once a week").
//
// Pure and dependency-free, like newsletterCompose.js beside it, and tested
// from src/test/newsletterMagazine.test.js. Everything that DECIDES lives
// here; newsletterSources.js fetches and newsletter.js wires.
//
// The same division of labour as the rest of the newsletter: the pictures
// are chosen here from TMDB's own stills (the model never names an image), and
// every number in the three new stories comes from a brief built here.

// --- Pictures ------------------------------------------------------------------

/**
 * The best stills for a film, from TMDB's /movie/{id}/images.
 *
 * Textless backdrops only (`iso_639_1` null): a backdrop with a language is
 * usually a title card or a poster crop, which reads as an ad in the middle
 * of an article. Wide enough to be a full-width picture on a phone at 3x, and
 * the film's own main backdrop left out so the hero isn't repeated inside.
 */
function pickStills (images, { exclude = [], limit = 3, minWidth = 1280 } = {}) {
  const skip = new Set(exclude.filter(Boolean));
  const seen = new Set();
  return (images?.backdrops || [])
    .filter((b) => b?.file_path && !b.iso_639_1 && (b.width || 0) >= minWidth)
    .filter((b) => !skip.has(b.file_path))
    .sort((a, b) => (b.vote_average || 0) - (a.vote_average || 0) || (b.vote_count || 0) - (a.vote_count || 0))
    .map((b) => b.file_path)
    .filter((path) => (seen.has(path) ? false : seen.add(path)))
    .slice(0, limit);
}

/**
 * The hero and the in-article stills for one film: the film's own backdrop
 * leads, the stills follow. When a film has no backdrop, its best still is
 * promoted to the hero.
 */
function storyPictures (backdropPath, images, { stills = 3 } = {}) {
  const picked = pickStills(images, { exclude: [backdropPath], limit: stills + 1 });
  const hero = backdropPath || picked[0] || null;
  const rest = picked.filter((p) => p !== hero).slice(0, stills);
  return { hero, stills: rest };
}

const squash = (s) => String(s || '')
  .replace(/[‘’]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

/**
 * The pull quote, only if it is really in the article.
 *
 * A pull quote is the article quoting itself, so the one thing it must never
 * be is new text: a line the model "pulled" that isn't in the piece is an
 * invented quotation with big type around it. Checked verbatim (quotes and
 * whitespace folded), and kept to a length that sets well in large type.
 */
function verifiedPullQuote (article, quote, { min = 30, max = 220 } = {}) {
  const q = String(quote || '').trim().replace(/^["“‘']+|["”’']+$/g, '').trim();
  if (q.length < min || q.length > max) return null;
  return squash(article).includes(squash(q)) ? q : null;
}

// --- The performer spotlight ----------------------------------------------------

const SPOTLIGHT_MEMORY_MS = 26 * 7 * 86400000;   // half a year before someone comes back

/** Everyone spotlighted in recent issues (the issue being rebuilt excepted). */
function previouslySpotlighted (issues = {}, currentWeekKey = null, now = Date.now()) {
  const ids = new Set();
  for (const [key, issue] of Object.entries(issues || {})) {
    if (!issue || key === currentWeekKey) continue;
    if (now - (Number(issue.builtAt) || 0) > SPOTLIGHT_MEMORY_MS) continue;
    if (issue.spotlight?.personId != null) ids.add(issue.spotlight.personId);
  }
  return ids;
}

const normName = (n) => String(n || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

// The occasion's day this year, as days from `now` (negative = already past).
function daysToAnniversary (isoDate, now) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ''));
  if (!m) return null;
  const today = new Date(now);
  const on = Date.UTC(today.getUTCFullYear(), Number(m[2]) - 1, Number(m[3]));
  const start = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.round((on - start) / 86400000);
}

/**
 * Who the performer spotlight is about this week.
 *
 * `actors` is the reader's own list (newsletter/people, actors they rate above
 * their average, best first), so it can only ever be someone whose work they
 * already like. `people` are TMDB records for the top of that list (id,
 * name, birthday, deathday). `releaseCasts` maps each shortlisted new release
 * to its top-billed cast.
 *
 * In order: an actor they rate who is IN one of this week's new releases (the
 * strongest hook: it ties the spotlight to the picks); then one whose
 * birthday falls in the coming week, or a round (multiple of five) death
 * anniversary; then, so there is a spotlight every week, the highest-ranked
 * actor not featured in the last half year.
 */
function chooseSpotlight ({ actors = [], people = [], releaseCasts = [], recent = new Set(), now = Date.now(), windowDays = 7 } = {}) {
  const rank = new Map(actors.map((a, i) => [normName(a.name), i]));
  const statsOf = (name) => actors[rank.get(normName(name))] || null;
  const fresh = (id) => id != null && !recent.has(id);

  // 1. In a new release this week.
  const inRelease = [];
  for (const release of releaseCasts) {
    for (const member of release.cast || []) {
      if (!rank.has(normName(member.name)) || !fresh(member.id)) continue;
      inRelease.push({ member, release, at: rank.get(normName(member.name)) });
    }
  }
  inRelease.sort((a, b) => a.at - b.at);
  if (inRelease.length) {
    const { member, release } = inRelease[0];
    return {
      personId: member.id,
      name: member.name,
      reason: 'new-release',
      inRelease: { id: release.id, title: release.title, year: release.year, character: member.character || null },
      reader: statsOf(member.name)
    };
  }

  // 2. A birthday this week, or a round death anniversary.
  const year = new Date(now).getUTCFullYear();
  const dated = [];
  for (const person of people) {
    if (!person?.id || !fresh(person.id) || !rank.has(normName(person.name))) continue;
    if (person.deathday) {
      const away = daysToAnniversary(person.deathday, now);
      const years = year - Number(String(person.deathday).slice(0, 4));
      if (away != null && away >= 0 && away < windowDays && years > 0 && years % 5 === 0) {
        dated.push({ person, occasion: 'death', years, at: rank.get(normName(person.name)) });
      }
      continue;   // no birthdays for the dead: "would have turned 83" is a weak hook
    }
    const away = daysToAnniversary(person.birthday, now);
    const years = year - Number(String(person.birthday || '').slice(0, 4));
    if (away != null && away >= 0 && away < windowDays && years > 0) {
      dated.push({ person, occasion: 'birthday', years, at: rank.get(normName(person.name)) });
    }
  }
  dated.sort((a, b) => a.at - b.at);
  if (dated.length) {
    const { person, occasion, years } = dated[0];
    return { personId: person.id, name: person.name, reason: occasion, years, reader: statsOf(person.name) };
  }

  // 3. A favourite, so the section is never empty.
  for (const person of people) {
    if (person?.id && fresh(person.id) && rank.has(normName(person.name))) {
      return { personId: person.id, name: person.name, reason: 'favourite', reader: statsOf(person.name) };
    }
  }
  return null;
}

/**
 * The spotlight's facts. `credits` is TMDB's /person/{id}/movie_credits,
 * `details` is /person/{id}; `seenIds` is the reader's library.
 */
function spotlightBrief (choice, { details = {}, credits = {}, seenIds = new Set() } = {}) {
  if (!choice) return null;
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds);
  const acting = (credits.cast || [])
    .filter((c) => c?.id && c.title && c.release_date && !/^(himself|herself|themselves|self)\b/i.test(c.character || ''))
    .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0));
  const unique = [];
  const ids = new Set();
  for (const c of acting) if (!ids.has(c.id)) { ids.add(c.id); unique.push(c); }
  const films = unique.slice(0, 14).map((c) => ({
    id: c.id,
    title: c.title,
    year: Number(String(c.release_date).slice(0, 4)) || null,
    character: c.character || null,
    readerHasSeen: seen.has(c.id)
  }));
  return {
    name: choice.name,
    reason: choice.reason,
    years: choice.years ?? null,
    born: details.birthday || null,
    died: details.deathday || null,
    birthplace: details.place_of_birth || null,
    // TMDB's biography, as context only, cut short: it is community-written
    // and the prompt treats it as background, never as a quotable source.
    biography: String(details.biography || '').slice(0, 900) || null,
    inThisWeeksRelease: choice.inRelease || null,
    readerRatesThem: choice.reader ? { films: choice.reader.films, average: choice.reader.average } : null,
    readerHasSeenOfThese: films.filter((f) => f.readerHasSeen).length,
    bestKnownFilms: films
  };
}

/** The spotlight's still: the best-known film they're in that has a backdrop, the reader's own first. */
function spotlightFilm (credits = {}, seenIds = new Set()) {
  const seen = seenIds instanceof Set ? seenIds : new Set(seenIds);
  const cast = (credits.cast || []).filter((c) => c?.id && c.backdrop_path)
    .sort((a, b) => (b.vote_count || 0) - (a.vote_count || 0)).slice(0, 8);
  return cast.find((c) => seen.has(c.id)) || cast[0] || null;
}

// --- The box office -------------------------------------------------------------

/**
 * The most recent weekend in a Box Office History calendar that has finished
 * by `now` (a weekend's chart only exists after its Sunday).
 */
function latestWeekend (calendar, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  return (calendar?.weekends || [])
    .filter((w) => w?.k && w.e && w.e < today)
    .sort((a, b) => String(b.e).localeCompare(String(a.e)))[0] || null;
}

/**
 * The box office story's facts, from Box Office History's weekend chart.
 *
 * `chart` is weekends/<key>.json; `pastCalendars` maps a years-ago count to
 * that year's calendar/<year>.json, for "this weekend in history" (the same
 * weekend, its #1); `seenRows` holds the archive ids of chart rows the reader
 * has in their library (matched to TMDB by the caller).
 */
function boxOfficeBrief ({ chart, pastCalendars = {}, seenRows = new Set() } = {}) {
  const rows = (chart?.rows || []).filter((r) => r?.title && r.gross > 0).sort((a, b) => a.rank - b.rank);
  if (rows.length < 3) return null;
  const top = rows.slice(0, 10).map((r) => ({
    rank: r.rank,
    title: r.title,
    weekendGross: r.gross,
    changeFromLastWeekendPercent: Number.isFinite(r.change) ? r.change : null,
    lastWeekendRank: r.lastRank === 'new' ? 'new this weekend' : (r.lastRank ?? null),
    weekInRelease: r.week ?? null,
    theaters: r.theaters ?? null,
    perTheaterAverage: r.average ?? null,
    totalSoFar: r.total ?? null,
    distributor: r.distributor || null,
    readerHasSeen: seenRows.has(r.id)
  }));
  const holds = rows.slice(0, 10).filter((r) => Number.isFinite(r.change) && r.lastRank !== 'new');
  const best = holds.slice().sort((a, b) => b.change - a.change)[0];
  const worst = holds.slice().sort((a, b) => a.change - b.change)[0];
  // The same weekend in past years, matched by DATE: the archive's older
  // calendars key their weekends "2016-1", not "2016W01", and a week number
  // drifts a day or two against the calendar anyway. Closest start within
  // three days of this one's, moved to that year.
  const startOf = (iso) => Date.parse(`${String(iso).slice(0, 10)}T00:00:00Z`);
  const history = Object.entries(pastCalendars)
    .map(([ago, cal]) => {
      const target = startOf(`${cal?.year}${String(chart.start).slice(4, 10)}`);
      const w = (cal?.weekends || [])
        .filter((x) => x?.s && x.top && Math.abs(startOf(x.s) - target) <= 3 * 86400000)
        .sort((a, b) => Math.abs(startOf(a.s) - target) - Math.abs(startOf(b.s) - target))[0];
      return w ? { yearsAgo: Number(ago), year: cal.year, dates: `${w.s} to ${w.e}`, numberOne: w.top, numberOneGross: w.g, wholeChartGross: w.tg } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.yearsAgo - b.yearsAgo);
  return {
    weekend: chart.label ? `${chart.label}, ${chart.year}` : `${chart.start} to ${chart.end}`,
    days: chart.days || 3,
    wholeChart: {
      films: chart.total?.movies ?? null,
      gross: chart.total?.gross ?? null,
      changeFromLastWeekendPercent: chart.total?.change ?? null
    },
    top10: top,
    openers: top.filter((r) => r.lastWeekendRank === 'new this weekend').map((r) => r.title),
    bestHold: best ? { title: best.title, changePercent: best.change } : null,
    steepestDrop: worst && worst !== best ? { title: worst.title, changePercent: worst.change } : null,
    thisWeekendInHistory: history
  };
}

// --- The reader's own week ------------------------------------------------------

/**
 * What the reader logged in the issue's week, from the profile's `recentLog`
 * (newsletterProfile.js). Null when they logged nothing: an empty week is
 * not a column.
 */
function logColumnBrief (profile, now = Date.now(), windowDays = 7) {
  const since = now - windowDays * 86400000;
  const rows = (profile?.recentLog || [])
    .filter((r) => r?.title && Number.isFinite(Date.parse(r.date)) && Date.parse(r.date) > since && Date.parse(r.date) <= now + 86400000)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (!rows.length) return null;
  const scores = rows.map((r) => r.score).filter(Number.isFinite);
  return {
    viewings: rows.map((r) => ({ title: r.title, year: r.year ?? null, score: r.score ?? null, watchedOn: r.date, where: r.medium || null, rewatch: Boolean(r.rewatch), director: r.director || null })),
    count: rows.length,
    averageScore: scores.length ? Number((scores.reduce((s, n) => s + n, 0) / scores.length).toFixed(1)) : null,
    best: rows.slice().sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0]?.title || null,
    loggedThisYear: profile?.loggedThisYear ?? null,
    libraryAverage: profile?.libraryAverage ?? null
  };
}

/** The film whose picture heads the log column: the week's highest score. */
function logColumnFilm (profile, now = Date.now(), windowDays = 7) {
  const since = now - windowDays * 86400000;
  return (profile?.recentLog || [])
    .filter((r) => r?.id && Date.parse(r.date) > since)
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1))[0] || null;
}

module.exports = {
  pickStills,
  storyPictures,
  verifiedPullQuote,
  previouslySpotlighted,
  chooseSpotlight,
  spotlightBrief,
  spotlightFilm,
  latestWeekend,
  boxOfficeBrief,
  logColumnBrief,
  logColumnFilm,
  SPOTLIGHT_MEMORY_MS
};
