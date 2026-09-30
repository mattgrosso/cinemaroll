// Pure, store-free statistics for the Game Stats screen — the "more fun
// stats and more in-depth numbers" round (Matt, 2026-09-06: "The game
// stats page I find it not particularly [fun] to look at... more in-depth
// numbers of the different games and make the whole page just look more
// fun").
//
// Everything here is derived from what the games ALREADY record —
// settings/games/history/<key> round records ({ at, ...metrics }, capped
// at HISTORY_CAP), settings/games/plays/<key> session counters and
// settings/games/wins/<key> today-stamps. Every function returns null (or
// an empty list) when the records can't honestly support a stat, so the
// screen hides that block rather than showing a zero.
//
// gameHistory.js keeps the original stat lines and round chips; this file
// adds the personal-record, form, habits and movie layers on top.

const DAY_MS = 24 * 60 * 60 * 1000;
export const TREND_WINDOW = 10;
// A "recent vs all-time" comparison needs enough history on both sides to
// mean something; below this it's noise dressed as insight.
export const TREND_MIN_ROUNDS = TREND_WINDOW + 3;
// A favourite weekday/time-of-day claim needs a few rounds behind it.
export const HABIT_MIN_ROUNDS = 4;

const plural = (count, noun, pluralNoun = `${noun}s`) => `${count} ${count === 1 ? noun : pluralNoun}`;

// One descriptor per game: which field is the headline number, which
// direction is "better", and how to phrase a value. `winsOnly` games only
// count the field on won rounds (a lost Clue Budget has $0 by definition);
// `wonField` names the boolean that says a round was won.
export const METRICS = {
  'higher-lower': { kind: 'streak', field: 'streak', better: 'high', phrase: (v) => `${v} in a row`, noun: 'run' },
  'you-or-crowd': { kind: 'streak', field: 'streak', better: 'high', phrase: (v) => `${v} in a row`, noun: 'run' },
  timeline: { kind: 'streak', field: 'streak', better: 'high', phrase: (v) => `${v} in a row`, noun: 'run' },
  tagline: { kind: 'streak', field: 'streak', better: 'high', phrase: (v) => `${v} in a row`, noun: 'run' },
  wordle: { kind: 'solve', field: 'guesses', better: 'low', phrase: (v) => plural(v, 'guess', 'guesses'), noun: 'puzzle' },
  connections: { kind: 'solve', field: 'mistakes', better: 'low', phrase: (v) => (v === 0 ? 'flawless' : plural(v, 'mistake')), noun: 'puzzle' },
  'six-degrees': { kind: 'solve', field: 'steps', better: 'low', phrase: (v) => plural(v, 'step'), noun: 'chain' },
  'clue-budget': { kind: 'winloss', field: 'saved', better: 'high', winsOnly: true, wonField: 'won', phrase: (v) => `$${v} left`, noun: 'round' },
  trivia: { kind: 'winloss', field: 'facts', better: 'low', winsOnly: true, wonField: 'won', phrase: (v) => plural(v, 'fact'), noun: 'round' },
  'poster-zoom': { kind: 'winloss', field: 'zoomOuts', better: 'low', winsOnly: true, wonField: 'won', phrase: (v) => plural(v, 'zoom-out'), noun: 'round' },
  cineplexity: { kind: 'winloss', field: 'misses', better: 'low', winsOnly: true, wonField: 'swept', phrase: (v) => plural(v, 'miss', 'misses'), noun: 'round' },
  stamp: { kind: 'volume', field: 'decided', better: 'high', phrase: (v) => plural(v, 'poster'), noun: 'sweep' }
};

export function toRecords (history) {
  const list = Array.isArray(history) ? history : Object.values(history || {});
  return list.filter((record) => record && typeof record === 'object');
}

const isWon = (metric, record) => (metric.wonField ? record[metric.wonField] === true : true);
const isFinite = (value) => Number.isFinite(value);

// The rounds whose headline field counts toward records and averages.
function scoringRounds (metric, records) {
  return records
    .map((record, index) => ({ record, index }))
    .filter(({ record }) => isFinite(record[metric.field]) && (!metric.winsOnly || isWon(metric, record)));
}

const betterThan = (metric, a, b) => (metric.better === 'high' ? a > b : a < b);

// The personal record: best value in the better direction, and WHEN it was
// first set — a tie doesn't move the date, the first time you got there is
// the record. `beatenTimes` says how many later rounds equalled it.
export function personalRecord (gameKey, history) {
  const metric = METRICS[gameKey];
  if (!metric || metric.kind === 'volume') return null;
  const rounds = scoringRounds(metric, toRecords(history));
  if (!rounds.length) return null;

  let best = rounds[0];
  rounds.forEach((round) => {
    if (betterThan(metric, round.record[metric.field], best.record[metric.field])) best = round;
  });
  const value = best.record[metric.field];
  const matched = rounds.filter((round) => round.record[metric.field] === value).length;
  return {
    value,
    label: metric.phrase(value),
    at: isFinite(best.record.at) ? best.record.at : null,
    index: best.index,
    matched
  };
}

const average = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);
const round1 = (value) => (value == null ? null : Math.round(value * 10) / 10);

// Recent form: the last TREND_WINDOW scoring rounds against everything
// before them. `verdict` is in the better direction — 'up' always means
// improving, whichever way the number itself moved.
export function recentTrend (gameKey, history, window = TREND_WINDOW) {
  const metric = METRICS[gameKey];
  if (!metric || metric.kind === 'volume') return null;
  const values = scoringRounds(metric, toRecords(history)).map(({ record }) => record[metric.field]);
  if (values.length < TREND_MIN_ROUNDS) return null;

  const recent = average(values.slice(-window));
  const earlier = average(values.slice(0, -window));
  const delta = recent - earlier;
  // Under a tenth of a unit either way is a flat line, not a trend.
  const improving = metric.better === 'high' ? delta > 0 : delta < 0;
  const verdict = Math.abs(delta) < 0.1 ? 'flat' : (improving ? 'up' : 'down');
  return { recent: round1(recent), earlier: round1(earlier), verdict, window: Math.min(window, values.length) };
}

// Every round as a bar, chronological, for the form strip. `height` is
// 0..1 in the better direction — the tallest bar is always the best round,
// so a low-is-good game still reads left-to-right as "taller = better".
// Lost rounds in win/loss games draw as empty (height 0, won: false).
export function formSeries (gameKey, history) {
  const metric = METRICS[gameKey];
  if (!metric || metric.kind === 'volume') return [];
  const records = toRecords(history);
  if (!records.length) return [];
  const scored = scoringRounds(metric, records);
  const values = scored.map(({ record }) => record[metric.field]);
  if (!values.length) return [];
  const max = Math.max(...values);
  const min = Math.min(...values);
  const record = personalRecord(gameKey, records);

  return records.map((entry, index) => {
    const value = entry[metric.field];
    const scoring = isFinite(value) && (!metric.winsOnly || isWon(metric, entry));
    let height = 0;
    if (scoring) {
      if (max === min) {
        height = 1;
      } else if (metric.better === 'high') {
        // Floor at a sliver so a legitimate low still shows as played.
        height = 0.15 + 0.85 * ((value - min) / (max - min));
      } else {
        height = 0.15 + 0.85 * ((max - value) / (max - min));
      }
    }
    return {
      value: isFinite(value) ? value : null,
      at: isFinite(entry.at) ? entry.at : null,
      won: metric.wonField ? isWon(metric, entry) : scoring,
      height,
      best: Boolean(record && record.index === index && scoring)
    };
  });
}

// Win/loss games: current run of wins (or losses) and the longest run of
// wins ever. Streak and solve games have no losses recorded, so null.
export function winStreaks (gameKey, history) {
  const metric = METRICS[gameKey];
  if (!metric || !metric.wonField) return null;
  const records = toRecords(history).filter((record) => typeof record[metric.wonField] === 'boolean');
  if (!records.length) return null;

  let best = 0;
  let run = 0;
  records.forEach((record) => {
    run = isWon(metric, record) ? run + 1 : 0;
    if (run > best) best = run;
  });

  const lastWon = isWon(metric, records[records.length - 1]);
  let current = 0;
  for (let i = records.length - 1; i >= 0 && isWon(metric, records[i]) === lastWon; i--) current++;

  const wins = records.filter((record) => isWon(metric, record)).length;
  return { current, currentIsWins: lastWon, best, wins, losses: records.length - wins };
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function timeOfDaySlot (hour) {
  if (hour >= 5 && hour < 12) return 'mornings';
  if (hour >= 12 && hour < 17) return 'afternoons';
  if (hour >= 17 && hour < 21) return 'evenings';
  return 'late nights';
}

function mode (values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  let top = null;
  counts.forEach((count, value) => {
    if (top === null || count > top.count) top = { value, count };
  });
  return top;
}

export function localDayKey (timestamp) {
  const date = new Date(timestamp);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

// When the game gets played: first and latest round, favourite weekday and
// time of day (both need HABIT_MIN_ROUNDS and a clear plurality), distinct
// days played.
export function habits (history, now = Date.now()) {
  const stamps = toRecords(history).map((record) => record.at).filter((at) => isFinite(at) && at > 0 && at <= now + DAY_MS);
  if (!stamps.length) return null;

  const days = new Set(stamps.map(localDayKey));
  const result = {
    rounds: stamps.length,
    first: Math.min(...stamps),
    latest: Math.max(...stamps),
    daysPlayed: days.size,
    weekday: null,
    slot: null
  };

  if (stamps.length >= HABIT_MIN_ROUNDS) {
    const weekday = mode(stamps.map((at) => new Date(at).getDay()));
    if (weekday && weekday.count > stamps.length / 4) result.weekday = WEEKDAYS[weekday.value];
    const slot = mode(stamps.map((at) => timeOfDaySlot(new Date(at).getHours())));
    if (slot && slot.count > stamps.length / 3) result.slot = slot.value;
  }
  return result;
}

// Rounds that carried a movie key (the single-target games record
// `movie: <dbKey>` since Sep 2026). `resolve(dbKey)` turns a key into a
// library entry, or null when it's gone — those rounds are dropped.
export function movieFacts (gameKey, history, resolve, limit = 6) {
  const metric = METRICS[gameKey];
  if (!metric) return { stumped: [], nailed: [] };
  const records = toRecords(history).filter((record) => record.movie != null);
  if (!records.length) return { stumped: [], nailed: [] };

  const stumpedCounts = new Map();
  const nailed = [];
  records.forEach((record) => {
    const entry = resolve(record.movie);
    if (!entry) return;
    if (metric.wonField && !isWon(metric, record)) {
      const existing = stumpedCounts.get(record.movie) || { entry, count: 0, at: record.at };
      existing.count += 1;
      stumpedCounts.set(record.movie, existing);
      return;
    }
    if (isFinite(record[metric.field])) {
      nailed.push({ entry, value: record[metric.field], label: metric.phrase(record[metric.field]), at: record.at });
    }
  });

  const stumped = [...stumpedCounts.values()]
    .sort((a, b) => b.count - a.count || (b.at || 0) - (a.at || 0))
    .slice(0, limit);
  nailed.sort((a, b) => (metric.better === 'high' ? b.value - a.value : a.value - b.value) || (b.at || 0) - (a.at || 0));

  return { stumped, nailed: nailed.slice(0, limit) };
}

export function formatDay (timestamp, now = Date.now()) {
  if (!isFinite(timestamp)) return null;
  const date = new Date(timestamp);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// The one-sentence headline at the top of each game's card. Plain language,
// the biggest fact first, never a placeholder.
export function headline (gameKey, history, now = Date.now()) {
  const metric = METRICS[gameKey];
  const records = toRecords(history);
  if (!metric || !records.length) return null;

  if (metric.kind === 'volume') {
    const decided = records.map((r) => r.decided).filter(isFinite).reduce((a, b) => a + b, 0);
    const changes = records.map((r) => r.changes).filter(isFinite).reduce((a, b) => a + b, 0);
    if (!decided) return null;
    return changes
      ? `You've judged ${plural(decided, 'poster')} and changed your mind on ${changes} of them.`
      : `You've judged ${plural(decided, 'poster')} and stood by every one.`;
  }

  const record = personalRecord(gameKey, records);
  const when = record?.at ? ` on ${formatDay(record.at, now)}` : '';

  if (metric.kind === 'streak') {
    if (!record) return null;
    if (record.matched > 1) return `Your best run is ${record.label} — you've hit it ${record.matched} times.`;
    return `Your best run is ${record.label}, set${when}.`;
  }

  if (metric.kind === 'solve') {
    const solved = records.length;
    if (!record) return `${plural(solved, metric.noun)} solved.`;
    if (record.matched === solved) return `${plural(solved, metric.noun)} solved, every one in ${record.label}.`;
    return `${plural(solved, metric.noun)} solved. Best: ${record.label}${when}.`;
  }

  // winloss
  const streaks = winStreaks(gameKey, records);
  const played = streaks ? streaks.wins + streaks.losses : records.length;
  const wins = streaks ? streaks.wins : 0;
  if (!wins) return `${plural(played, metric.noun)} played, still hunting the first win.`;
  if (wins === played) {
    return record
      ? `Unbeaten in ${plural(played, metric.noun)}. Best: ${record.label}${when}.`
      : `Unbeaten in ${plural(played, metric.noun)}.`;
  }
  return record
    ? `Won ${wins} of ${played}. Best: ${record.label}${when}.`
    : `Won ${wins} of ${played}.`;
}

// The trend as a sentence for the form strip's caption.
export function trendSentence (gameKey, trend) {
  const metric = METRICS[gameKey];
  if (!metric || !trend) return null;
  const unit = metric.field === 'saved' ? '$' : '';
  const recent = `${unit}${trend.recent}`;
  const earlier = `${unit}${trend.earlier}`;
  const base = `Last ${trend.window}: ${recent} on average, against ${earlier} before that.`;
  if (trend.verdict === 'up') return `${base} Heating up.`;
  if (trend.verdict === 'down') return `${base} Off the pace.`;
  return `${base} Steady.`;
}

// Consecutive calendar days (through today or yesterday) with at least one
// round in any game. Yesterday keeps the streak alive: a streak shouldn't
// read as broken at 9am because you haven't played yet.
export function dayStreak (dayKeys, now = Date.now()) {
  const days = new Set(dayKeys);
  if (!days.size) return 0;
  let cursor = now;
  if (!days.has(localDayKey(cursor))) {
    cursor -= DAY_MS;
    if (!days.has(localDayKey(cursor))) return 0;
  }
  let streak = 0;
  while (days.has(localDayKey(cursor))) {
    streak++;
    cursor -= DAY_MS;
  }
  return streak;
}

// The cross-game scoreboard at the top of the screen.
export function overallStats ({ plays = {}, history = {}, wins = {} } = {}, names = {}, now = Date.now(), todayStamp = new Date(now).toDateString()) {
  const gameKeys = new Set([...Object.keys(plays || {}), ...Object.keys(history || {})]);
  let rounds = 0;
  let sessions = 0;
  const stamps = [];
  const perDay = new Map();
  let favourite = null;

  gameKeys.forEach((key) => {
    const count = plays?.[key] || 0;
    sessions += count;
    if (count > 0 && (!favourite || count > favourite.sessions)) favourite = { key, name: names[key] || key, sessions: count };
    toRecords(history?.[key]).forEach((record) => {
      rounds++;
      if (isFinite(record.at) && record.at > 0) {
        stamps.push(record.at);
        const day = localDayKey(record.at);
        perDay.set(day, (perDay.get(day) || 0) + 1);
      }
    });
  });

  if (!rounds && !sessions) return null;

  let busiest = null;
  perDay.forEach((count, day) => {
    if (!busiest || count > busiest.rounds) busiest = { day, rounds: count };
  });

  const wonToday = Object.values(wins || {}).filter((stamp) => stamp === todayStamp).length;
  const gamesPlayed = [...gameKeys].filter((key) => (plays?.[key] || 0) > 0 || toRecords(history?.[key]).length > 0).length;

  return {
    rounds,
    sessions,
    gamesPlayed,
    daysPlayed: perDay.size,
    streak: dayStreak([...perDay.keys()], now),
    busiest: busiest ? { ...busiest, label: formatDay(new Date(`${busiest.day}T12:00:00`).getTime(), now) } : null,
    first: stamps.length ? Math.min(...stamps) : null,
    latest: stamps.length ? Math.max(...stamps) : null,
    favourite,
    wonToday
  };
}
