// Stories from Matt's own film log, for Newsprinted (Matt, 2026-10-28: "there's
// tons of data in there that should be fun to look at … it would be fun to
// have stories get generated … look for an angle within these concepts").
//
// Seven kinds, each a fact sheet built here from the log (pure, tested) and
// then written up by a model that is handed the sheet and nothing else:
//
//   sits          the morning after a film is logged: where it sits among
//                 the director's, the year's, the genre's; firsts; counts
//   on-this-day   what he watched on this date in past years
//   month         on the 1st: last month against the same month a year ago
//   milestone     the day a round number is crossed (films, theater visits,
//                 hours, the year's count)
//   unfinished    Sundays: directors he has nearly finished
//   anniversary   Mondays: a favourite turning 10, 25, 50 this week
//   numbers       the 15th: one pattern in the data, a different one each month
//
// The rule from the newsletter holds: the log supplies facts, the model
// supplies the angle and the prose. Every story also carries a short fact
// line built here, so the truth is on the page whatever the prose does.

const DAY = 864e5;
const TZ = 'America/New_York';

// --- The log, flattened ------------------------------------------------------

const num = (v) => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : null;
};
const when = (d) => {
  const t = typeof d === 'number' ? d : Date.parse(d);
  return Number.isFinite(t) ? t : null;
};

/** Every rating as a row: { film, title, year, date, rating, medium, prior } oldest first. */
function flatten (log) {
  const rows = [];
  for (const entry of Object.values(log || {})) {
    const movie = entry?.movie || {};
    const title = movie.title || entry?.ratings?.[0]?.title || '';
    const year = Number(String(movie.release_date || '').slice(0, 4)) || entry?.ratings?.[0]?.year || null;
    const ratings = (entry?.ratings || []).map((r) => ({ date: when(r?.date), rating: num(r?.rating), medium: r?.medium || '' })).filter((r) => r.date && r.rating != null).sort((a, b) => a.date - b.date);
    ratings.forEach((r, i) => rows.push({ film: movie.id || title, title, year, movie, date: r.date, rating: r.rating, medium: r.medium, prior: ratings.slice(0, i).map((p) => p.rating) }));
  }
  return rows.sort((a, b) => a.date - b.date);
}

const local = (t) => {
  const d = new Date(new Date(t).toLocaleString('en-US', { timeZone: TZ }));
  return { y: d.getFullYear(), m: d.getMonth(), d: d.getDate(), dow: d.getDay(), hour: d.getHours() };
};
const dayKey = (t) => { const l = local(t); return `${l.y}-${String(l.m + 1).padStart(2, '0')}-${String(l.d).padStart(2, '0')}`; };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOWS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const avg = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100 : null);
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
const directorsOf = (movie) => [...new Set((movie?.crew || []).filter((c) => c?.job === 'Director' && c.name).map((c) => c.name))];
const isTheater = (m) => /theater|theatre|cinema/i.test(m || '');
const dateWords = (t) => new Date(t).toLocaleDateString('en-US', { timeZone: TZ, month: 'long', day: 'numeric', year: 'numeric' });

// --- 1. Where this sits --------------------------------------------------------

/** A sheet per film logged after `since` (and not after `now`). */
function sitsSheets (rows, since, now) {
  const fresh = rows.filter((r) => r.date > since && r.date <= now);
  const out = [];
  for (const r of fresh) {
    const before = rows.filter((x) => x.date < r.date);
    const seenFilms = new Set(before.map((x) => x.film));
    const facts = {
      film: { title: r.title, year: r.year, rating: r.rating, medium: r.medium || 'unknown', watchedOn: dateWords(r.date), runtimeMinutes: r.movie?.runtime || null, genres: (r.movie?.genres || []).map((g) => g.name).slice(0, 3), countries: (r.movie?.production_countries || []).map((c) => c.name) },
      rewatch: r.prior.length ? { timesBefore: r.prior.length, previousRatings: r.prior.map(r1), change: r1(r.rating - r.prior[r.prior.length - 1]) } : null,
      directors: directorsOf(r.movie).map((name) => {
        const theirs = before.filter((x) => directorsOf(x.movie).includes(name) && x.film !== r.film);
        const films = new Map(); for (const x of theirs) films.set(x.film, { title: x.title, rating: x.rating });
        const list = [...films.values()];
        const higher = list.filter((f) => f.rating > r.rating).length;
        return { name, filmsSeenBefore: list.length, thisRanks: list.length ? `${higher + 1} of ${list.length + 1}` : 'first', theirAverageBefore: avg(list.map((f) => f.rating)), theirBest: list.sort((a, b) => b.rating - a.rating)[0] || null };
      }),
      releaseYear: (() => { const same = before.filter((x) => x.year === r.year && x.film !== r.film); const films = new Map(); for (const x of same) films.set(x.film, x.rating); const list = [...films.values()]; return { year: r.year, filmsSeenBefore: list.length, thisRanks: list.length ? `${list.filter((v) => v > r.rating).length + 1} of ${list.length + 1}` : 'first' }; })(),
      genre: (() => { const g = r.movie?.genres?.[0]?.name; if (!g) return null; const same = before.filter((x) => (x.movie?.genres || []).some((y) => y.name === g)); return { name: g, filmsSeenBefore: new Set(same.map((x) => x.film)).size, averageBefore: avg(same.map((x) => x.rating)) }; })(),
      firsts: {
        newCountry: (r.movie?.production_countries || []).map((c) => c.name).filter((c) => !before.some((x) => (x.movie?.production_countries || []).some((y) => y.name === c))),
        newDecade: r.year && !before.some((x) => x.year && Math.floor(x.year / 10) === Math.floor(r.year / 10)) ? `${Math.floor(r.year / 10) * 10}s` : null
      },
      actors: (r.movie?.cast || []).slice(0, 8).map((c) => ({ name: c.name, filmsSeenWithThem: new Set(before.filter((x) => (x.movie?.cast || []).slice(0, 12).some((y) => y.name === c.name)).map((x) => x.film)).size + 1 })).filter((a) => a.filmsSeenWithThem >= 5),
      counts: {
        filmsLoggedAllTime: seenFilms.size + (seenFilms.has(r.film) ? 0 : 1),
        thisYearSoFar: before.filter((x) => local(x.date).y === local(r.date).y).length + 1,
        theaterVisitNumber: isTheater(r.medium) ? before.filter((x) => isTheater(x.medium)).length + 1 : null,
        thisYearRank: (() => { const ys = before.filter((x) => local(x.date).y === local(r.date).y); return `${ys.filter((x) => x.rating > r.rating).length + 1} of ${ys.length + 1}`; })(),
        longestThisYear: r.movie?.runtime && !before.some((x) => local(x.date).y === local(r.date).y && (x.movie?.runtime || 0) >= r.movie.runtime)
      }
    };
    out.push({ kind: 'sits', key: `${r.film}-${dayKey(r.date)}`, film: r.film, facts, factLine: `${r.title} (${r.year || '?'}) · ${r1(r.rating)} · ${r.medium || 'at home'}${facts.directors[0] ? ` · ${facts.directors[0].name}: ${facts.directors[0].thisRanks === 'first' ? 'first of theirs' : `ranks ${facts.directors[0].thisRanks} of theirs`}` : ''}`, expiresDays: 3 });
  }
  return out;
}

// --- 2. On this day -------------------------------------------------------------

function onThisDaySheet (rows, now) {
  const l = local(now);
  const hits = rows.filter((r) => { const x = local(r.date); return x.m === l.m && x.d === l.d && x.y < l.y; }).map((r) => ({ yearsAgo: l.y - local(r.date).y, title: r.title, year: r.year, rating: r1(r.rating), medium: r.medium || 'at home', director: directorsOf(r.movie)[0] || null, rewatch: r.prior.length > 0 }));
  if (!hits.length) return null;
  return { kind: 'on-this-day', key: dayKey(now), facts: { today: `${MONTHS[l.m]} ${l.d}`, watched: hits }, factLine: hits.map((h) => `${h.yearsAgo}y ago: ${h.title} (${h.rating})`).join(' · '), expiresDays: 1 };
}

// --- 3. Month in review -----------------------------------------------------------

function monthStats (rows, y, m) {
  const inMonth = rows.filter((r) => { const l = local(r.date); return l.y === y && l.m === m; });
  if (!inMonth.length) return null;
  const sorted = [...inMonth].sort((a, b) => b.rating - a.rating);
  return {
    month: `${MONTHS[m]} ${y}`,
    films: inMonth.length,
    theater: inMonth.filter((r) => isTheater(r.medium)).length,
    rewatches: inMonth.filter((r) => r.prior.length).length,
    hours: Math.round(inMonth.reduce((a, r) => a + (r.movie?.runtime || 0), 0) / 60),
    average: avg(inMonth.map((r) => r.rating)),
    best: sorted.slice(0, 3).map((r) => ({ title: r.title, year: r.year, rating: r1(r.rating) })),
    worst: { title: sorted[sorted.length - 1].title, year: sorted[sorted.length - 1].year, rating: r1(sorted[sorted.length - 1].rating) },
    oldest: inMonth.filter((r) => r.year).sort((a, b) => a.year - b.year)[0] ? { title: inMonth.filter((r) => r.year).sort((a, b) => a.year - b.year)[0].title, year: inMonth.filter((r) => r.year).sort((a, b) => a.year - b.year)[0].year } : null,
    decades: Object.entries(inMonth.reduce((o, r) => { if (r.year) { const d = `${Math.floor(r.year / 10) * 10}s`; o[d] = (o[d] || 0) + 1; } return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 3),
    busiestDay: (() => { const c = {}; for (const r of inMonth) { const k = DOWS[local(r.date).dow]; c[k] = (c[k] || 0) + 1; } return Object.entries(c).sort((a, b) => b[1] - a[1])[0]; })()
  };
}
function monthSheet (rows, now) {
  const l = local(now);
  const pm = l.m === 0 ? 11 : l.m - 1;
  const py = l.m === 0 ? l.y - 1 : l.y;
  const last = monthStats(rows, py, pm);
  if (!last) return null;
  return { kind: 'month', key: `${py}-${String(pm + 1).padStart(2, '0')}`, facts: { lastMonth: last, sameMonthLastYear: monthStats(rows, py - 1, pm), yearToDate: rows.filter((r) => local(r.date).y === py).length }, factLine: `${last.month}: ${last.films} films, ${last.theater} in theaters, ${last.hours} hours, average ${last.average}`, expiresDays: 7 };
}

// --- 4. Milestones ------------------------------------------------------------------

const EVERY = { films: 100, theater: 50, hours: 500, year: 100, ratings: 100 };
function totals (rows, now) {
  const y = local(now).y;
  return {
    films: new Set(rows.map((r) => r.film)).size,
    ratings: rows.length,
    theater: rows.filter((r) => isTheater(r.medium)).length,
    hours: Math.floor(rows.reduce((a, r) => a + (r.movie?.runtime || 0), 0) / 60),
    year: rows.filter((r) => local(r.date).y === y).length
  };
}
const MILESTONE_WORDS = { films: 'films logged', ratings: 'viewings logged', theater: 'trips to the theater', hours: 'hours of film', year: 'films this year' };
function milestoneSheets (rows, done, now) {
  const t = totals(rows, now);
  const out = [];
  for (const [kind, every] of Object.entries(EVERY)) {
    const reached = Math.floor(t[kind] / every) * every;
    if (!reached) continue;
    const key = kind === 'year' ? `year-${local(now).y}-${reached}` : `${kind}-${reached}`;
    if (done?.[key]) continue;
    // The viewing that crossed the line, so the story can name it.
    let acc = 0; let crosser = null;
    const sortedRows = [...rows].sort((a, b) => a.date - b.date);
    const seen = new Set();
    for (const r of sortedRows) {
      if (kind === 'year' && local(r.date).y !== local(now).y) continue;
      if (kind === 'theater' && !isTheater(r.medium)) continue;
      if (kind === 'films') { if (seen.has(r.film)) continue; seen.add(r.film); acc += 1; } else if (kind === 'hours') acc += (r.movie?.runtime || 0) / 60; else acc += 1;
      if (acc >= reached) { crosser = r; break; }
    }
    out.push({ kind: 'milestone', key, facts: { milestone: `${reached} ${MILESTONE_WORDS[kind]}`, measure: kind, reached, crossedBy: crosser ? { title: crosser.title, year: crosser.year, rating: r1(crosser.rating), on: dateWords(crosser.date), medium: crosser.medium } : null, totals: t, firstLogged: rows[0] ? dateWords(rows[0].date) : null }, factLine: `${reached} ${MILESTONE_WORDS[kind]}${crosser ? `, crossed with ${crosser.title}` : ''}`, expiresDays: 3 });
  }
  return out;
}

// --- 5. Unfinished business ---------------------------------------------------------

function unfinishedSheet (log, rows, now) {
  const today = new Date(now).toISOString().slice(0, 10);
  const dirs = new Map();
  for (const entry of Object.values(log || {})) {
    const movie = entry?.movie; if (!movie?.id) continue;
    for (const c of movie.crew || []) {
      if (c?.job !== 'Director' || !c.name) continue;
      const d = dirs.get(c.name) || { name: c.name, seen: new Map(), filmography: null };
      d.seen.set(movie.id, { title: movie.title, rating: r1(avg((entry.ratings || []).map((r) => num(r?.rating)).filter((x) => x != null))) });
      if (!d.filmography && Array.isArray(c.filmography) && c.filmography.length) d.filmography = c.filmography;
      dirs.set(c.name, d);
    }
  }
  const near = [];
  for (const d of dirs.values()) {
    if (d.seen.size < 3 || !d.filmography) continue;
    // Features with an audience, already out; the filmography carries shorts and TV bits too.
    const left = d.filmography.filter((f) => f?.id && !d.seen.has(f.id) && f.release_date && f.release_date < today && (f.popularity || 0) >= 3);
    if (left.length < 1 || left.length > 2) continue;
    const seen = [...d.seen.values()].sort((a, b) => b.rating - a.rating);
    near.push({ director: d.name, seen: d.seen.size, average: avg(seen.map((s) => s.rating).filter((x) => x != null)), best: seen[0], left: left.map((f) => ({ title: f.title, year: String(f.release_date).slice(0, 4) })) });
  }
  if (!near.length) return null;
  near.sort((a, b) => b.seen - a.seen);
  return { kind: 'unfinished', key: dayKey(now), facts: { directors: near.slice(0, 5) }, factLine: near.slice(0, 3).map((n) => `${n.director}: ${n.left.map((f) => f.title).join(', ')} left`).join(' · '), expiresDays: 7 };
}

// --- 7. Anniversaries ---------------------------------------------------------------

const ROUND = new Set([10, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100]);
function anniversariesSheet (rows, now) {
  const l = local(now);
  const best = new Map();
  for (const r of rows) if (r.rating >= 8.5 && r.movie?.release_date) { const b = best.get(r.film); if (!b || r.rating > b.rating) best.set(r.film, r); }
  const hits = [];
  for (const r of best.values()) {
    const [ry, rm, rd] = r.movie.release_date.split('-').map(Number);
    const age = l.y - ry;
    if (!ROUND.has(age)) continue;
    const anniv = new Date(l.y, rm - 1, rd).getTime();
    const start = new Date(l.y, l.m, l.d).getTime();
    if (anniv < start || anniv >= start + 7 * DAY) continue;
    hits.push({ title: r.title, year: ry, turns: age, on: `${MONTHS[rm - 1]} ${rd}`, released: r.movie.release_date, yourRating: r1(r.rating), youWatched: dateWords(r.date), director: directorsOf(r.movie)[0] || null, timesSeen: r.prior.length + 1 });
  }
  if (!hits.length) return null;
  hits.sort((a, b) => b.yourRating - a.yourRating);
  return { kind: 'anniversary', key: dayKey(now), facts: { thisWeek: hits.slice(0, 4) }, factLine: hits.slice(0, 3).map((h) => `${h.title} turns ${h.turns} on ${h.on}`).join(' · '), expiresDays: 7 };
}

// --- 8. The numbers -----------------------------------------------------------------

const PATTERNS = ['medium', 'weekday', 'runtime', 'decade', 'country', 'rewatch', 'month', 'spread'];
function numbersSheet (rows, now, pattern = PATTERNS[local(now).m % PATTERNS.length]) {
  const by = (keyOf) => { const g = {}; for (const r of rows) { const k = keyOf(r); if (k == null) continue; (g[k] = g[k] || []).push(r.rating); } return Object.entries(g).map(([k, v]) => ({ group: k, films: v.length, average: avg(v) })).filter((x) => x.films >= 10); };
  let facts;
  if (pattern === 'medium') facts = { question: 'Do theaters get better ratings than home?', groups: by((r) => (isTheater(r.medium) ? 'Theater' : r.medium ? 'At home' : null)) };
  else if (pattern === 'weekday') facts = { question: 'Which night of the week does he watch most, and rate highest?', groups: by((r) => DOWS[local(r.date).dow]) };
  else if (pattern === 'runtime') facts = { question: 'Do long films fare better with him?', groups: by((r) => (r.movie?.runtime ? (r.movie.runtime < 95 ? 'Under 95 min' : r.movie.runtime < 120 ? '95–119 min' : r.movie.runtime < 150 ? '120–149 min' : '150 min and over') : null)) };
  else if (pattern === 'decade') facts = { question: 'Which decade of film does he rate highest, and which has he seen most of?', groups: by((r) => (r.year ? `${Math.floor(r.year / 10) * 10}s` : null)) };
  else if (pattern === 'country') facts = { question: 'Where do his films come from, and which countries rate best?', groups: by((r) => r.movie?.production_countries?.[0]?.name || null).sort((a, b) => b.films - a.films).slice(0, 8) };
  else if (pattern === 'rewatch') {
    const swings = rows.filter((r) => r.prior.length).map((r) => ({ title: r.title, year: r.year, from: r1(r.prior[r.prior.length - 1]), to: r1(r.rating) })).sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)).slice(0, 6);
    facts = { question: 'When he watches a film again, does it go up or down?', rewatches: rows.filter((r) => r.prior.length).length, up: rows.filter((r) => r.prior.length && r.rating > r.prior[r.prior.length - 1]).length, biggestSwings: swings };
  } else if (pattern === 'month') facts = { question: 'Which month of the year is his heaviest?', groups: by((r) => MONTHS[local(r.date).m]) };
  else facts = { question: 'How does he spread his ratings?', bands: ['0–3', '3–5', '5–7', '7–9', '9–10'].map((b, i) => { const [lo, hi] = [[0, 3], [3, 5], [5, 7], [7, 9], [9, 10.01]][i]; return { band: b, films: rows.filter((r) => r.rating >= lo && r.rating < hi).length }; }), total: rows.length, averageAllTime: avg(rows.map((r) => r.rating)) };
  return { kind: 'numbers', key: `${pattern}-${dayKey(now).slice(0, 7)}`, facts: { pattern, ...facts, since: rows[0] ? dateWords(rows[0].date) : null, viewings: rows.length }, factLine: facts.question, expiresDays: 7 };
}

// --- What's due today ------------------------------------------------------------------

/** The sheets to write this morning, given the state of what's been written. */
function dueSheets (log, state, now = Date.now(), { force = false } = {}) {
  const rows = flatten(log);
  const l = local(now);
  const sheets = [];
  const since = state?.lastRatingAt || now - 36 * 3600e3;
  sheets.push(...sitsSheets(rows, since, now).slice(-4));
  const otd = onThisDaySheet(rows, now); if (otd) sheets.push(otd);
  sheets.push(...milestoneSheets(rows, state?.milestones || {}, now));
  if (l.d === 1 || force) { const m = monthSheet(rows, now); if (m) sheets.push(m); }
  if (l.dow === 0 || force) { const u = unfinishedSheet(log, rows, now); if (u) sheets.push(u); }
  if (l.dow === 1 || force) { const a = anniversariesSheet(rows, now); if (a) sheets.push(a); }
  if (l.d === 15 || force) sheets.push(numbersSheet(rows, now));
  const written = new Set(state?.written || []);
  return { sheets: sheets.filter((s) => !written.has(`${s.kind}-${s.key}`)), lastRatingAt: Math.max(since, ...rows.map((r) => r.date).filter((d) => d <= now)), rows };
}

// --- The writing ------------------------------------------------------------------------

const STORY_TOOL = {
  name: 'write_story',
  description: 'The finished story for the paper. Call it once, with the whole story.',
  strict: true,
  input_schema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      angle: { type: 'string', description: 'A few words naming the angle you took, for the record (e.g. "a director overtaken by his own early work")' },
      headline: { type: 'string', description: 'Under 80 characters. A newspaper headline, specific, no colon-gimmicks, no exclamation marks.' },
      paragraphs: { type: 'array', items: { type: 'string' }, description: 'Two to four short paragraphs of plain prose, 90 to 200 words in all.' }
    },
    required: ['angle', 'headline', 'paragraphs']
  }
};

const KIND_NOTES = {
  sits: 'The reader logged this film yesterday. Say where it sits in his own viewing: the director, the year, the genre, a first, a count, a rewatch that moved. Pick the one or two most telling facts; do not march through the sheet.',
  'on-this-day': 'What he watched on this date in earlier years. Find the thread, the contrast, or the one that stands out; do not list them all unless there are only two.',
  month: 'Last month in his viewing, against the same month a year earlier. Lead with what changed or what stood out; one or two numbers, not a table.',
  milestone: 'A round number was just crossed. Mark it the way a paper marks a milestone: the film that crossed it, the distance travelled since the first entry, a sense of scale.',
  unfinished: 'Directors he has nearly finished. Choose one or two and make the case, in a line each, for the film left; it is fine to name the rest in passing.',
  anniversary: 'A favourite of his turns a round age this week. Tie the film\'s age to when he saw it and what he gave it. If several, pick the best one and mention the others in a sentence.',
  numbers: 'One pattern in his data. Answer the question plainly with the figures, say what it suggests about him as a viewer, and admit what the numbers cannot tell.'
};

const SYSTEM = `You write short pieces for one person's own morning paper, about his own film log (he keeps every film he watches, with a rating out of 10, the date and where he watched it). Call him "you". The voice is a good arts page: plain, specific, dry, a little warm; never breathless, never listicle. No exclamation marks, no rhetorical questions, no "delve", no "journey", no "testament".

The hard rule: you have the fact sheet and nothing else. Use only names, titles, dates, numbers and ratings that appear in it. Do not add trivia about a film, a director's reputation, a plot, a quote or a release context, even if you are sure of it; the sheet is the whole world. Do not invent what he thought; his rating is what he thought. If the sheet is thin, write less.

Each story takes one angle. A list of recent headlines and angles is given so you take a different one; the same shape of story twice in a row is the failure to avoid. Write 90 to 200 words. Headline under 80 characters.`;

/** Writes one sheet into a story with the model; `recent` is the last few { headline, angle }. */
async function writeStory (client, sheet, recent = [], { model = 'claude-opus-5-5' } = {}) {
  // Forced tool choice is refused by this model family; the prompt names the tool and `strict` keeps the shape.
  const ask = () => client.messages.create({
    model,
    max_tokens: 4000,
    system: SYSTEM,
    tools: [STORY_TOOL],
    tool_choice: { type: 'auto' },
    messages: [{ role: 'user', content: `Kind of story: ${sheet.kind}. ${KIND_NOTES[sheet.kind] || ''}\n\nRecent stories (take a different angle):\n${recent.map((r) => `- ${r.headline} [${r.angle}]`).join('\n') || '- none yet'}\n\nFact sheet:\n${JSON.stringify(sheet.facts, null, 1)}\n\nWrite the story and hand it over with one write_story call; no other reply.` }]
  });
  let message = await ask();
  let call = (message?.content || []).find((b) => b?.type === 'tool_use' && b.name === STORY_TOOL.name);
  if (!call) {
    message = await ask();
    call = (message?.content || []).find((b) => b?.type === 'tool_use' && b.name === STORY_TOOL.name);
  }
  if (!call?.input?.headline || !Array.isArray(call.input.paragraphs)) throw new Error(`No story came back (${message?.stop_reason || 'no reply'})`);
  return { headline: String(call.input.headline).slice(0, 120), angle: String(call.input.angle || '').slice(0, 120), paragraphs: call.input.paragraphs.map((p) => String(p)).filter(Boolean).slice(0, 5) };
}

const escapeHtml = (t) => String(t || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** The feed item for a written sheet. */
function storyItem (sheet, story, now = Date.now()) {
  return {
    id: `log-${sheet.kind}-${sheet.key}`,
    url: sheet.film ? `https://www.cinemaroll.org/movie/${sheet.film}` : 'https://www.cinemaroll.org/',
    title: story.headline,
    content_html: `${story.paragraphs.map((p) => `<p>${escapeHtml(p)}</p>`).join('')}<p><small>${escapeHtml(sheet.factLine)}</small></p>`,
    date_published: new Date(now).toISOString(),
    _newsprinted: { expires: new Date(now + (sheet.expiresDays || 3) * DAY).toISOString() },
    _kind: sheet.kind,
    _angle: story.angle
  };
}

module.exports = { flatten, sitsSheets, onThisDaySheet, monthSheet, monthStats, milestoneSheets, unfinishedSheet, anniversariesSheet, numbersSheet, dueSheets, writeStory, storyItem, totals, PATTERNS, STORY_TOOL, SYSTEM };
