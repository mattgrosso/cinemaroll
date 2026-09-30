// Pure, store-free logic for per-game round history and the statistics
// shown on the Game Stats screen (user request: "add a history for each
// game with some good statistics on how they've gone").
//
// Storage shape: settings/games/history/<gameKey> is an ARRAY of round
// records, oldest first, capped at HISTORY_CAP — settings ride along on
// every launch, so history must stay small. Each record is
// { at: <ms timestamp>, ...small numeric/boolean metrics } — what those
// metrics are is each game's own business (see the per-game summaries
// below); this module never requires specific fields, so a game can evolve
// its record shape without breaking older entries.

export const HISTORY_CAP = 50;

// Appends one round and trims to the cap. Tolerates a missing/object-shaped
// existing history (Firebase round-trips dense arrays fine, but a manually
// touched node could arrive as {0: ..., 1: ...}).
export function appendRound (history, record, cap = HISTORY_CAP) {
  const list = Array.isArray(history) ? history : Object.values(history || {});
  return [...list, record].slice(-cap);
}

const count = (records, predicate) => records.filter(predicate).length;
const numbers = (records, field) => records.map((r) => r?.[field]).filter((v) => Number.isFinite(v));
const max = (values) => (values.length ? Math.max(...values) : null);
const min = (values) => (values.length ? Math.min(...values) : null);
const avg = (values) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : null);

const round1 = (value) => (value == null ? null : Math.round(value * 10) / 10);
const pct = (numerator, denominator) => (denominator ? `${Math.round((numerator / denominator) * 100)}%` : null);

// One stat-line builder per game key (the /games/<key> route tail, same key
// recordGameWin/plays use). Each returns [{ label, value }], skipping any
// stat its records can't support — a stats screen should never show "null".
const SUMMARIES = {
  'higher-lower': (records) => streakSummary(records),
  'you-or-crowd': (records) => streakSummary(records),
  timeline: (records) => streakSummary(records),
  tagline: (records) => streakSummary(records),
  wordle: (records) => [
    stat('Puzzles solved', records.length),
    stat('Best (fewest guesses)', min(numbers(records, 'guesses'))),
    stat('Average guesses', round1(avg(numbers(records, 'guesses'))))
  ],
  connections: (records) => [
    stat('Puzzles solved', records.length),
    stat('Flawless (0 mistakes)', count(records, (r) => r.mistakes === 0)),
    stat('Average mistakes', round1(avg(numbers(records, 'mistakes'))))
  ],
  'six-degrees': (records) => [
    stat('Chains completed', records.length),
    stat('Best (fewest steps)', min(numbers(records, 'steps'))),
    stat('Optimal-length chains', count(records, (r) => Number.isFinite(r.steps) && Number.isFinite(r.optimal) && r.steps <= r.optimal))
  ],
  'clue-budget': (records) => [
    stat('Rounds', records.length),
    stat('Win rate', pct(count(records, (r) => r.won), records.length)),
    stat('Best savings', formatDollars(max(numbers(records.filter((r) => r.won), 'saved')))),
    stat('Average savings (wins)', formatDollars(round1(avg(numbers(records.filter((r) => r.won), 'saved')))))
  ],
  trivia: (records) => [
    stat('Rounds', records.length),
    stat('Win rate', pct(count(records, (r) => r.won), records.length)),
    stat('Fastest solve (facts)', min(numbers(records.filter((r) => r.won), 'facts')))
  ],
  stamp: (records) => [
    stat('Sweeps finished', records.length),
    stat('Library changes made', numbers(records, 'changes').reduce((a, b) => a + b, 0)),
    stat('Posters judged', numbers(records, 'decided').reduce((a, b) => a + b, 0))
  ],
  'poster-zoom': (records) => [
    stat('Rounds', records.length),
    stat('Win rate', pct(count(records, (r) => r.won), records.length)),
    stat('Best (fewest zoom-outs)', min(numbers(records.filter((r) => r.won), 'zoomOuts'))),
    stat('Average zoom-outs (wins)', round1(avg(numbers(records.filter((r) => r.won), 'zoomOuts'))))
  ]
};

function streakSummary (records) {
  const streaks = numbers(records, 'streak');
  return [
    stat('Runs', records.length),
    stat('Best streak', max(streaks)),
    stat('Average streak', round1(avg(streaks)))
  ];
}

function stat (label, value) {
  return { label, value };
}

function formatDollars (value) {
  return value == null ? null : `$${value}`;
}

// One round as a short chip label for the recent-rounds strip — each game's
// primary metric, not the whole record.
const ROUND_LABELS = {
  'higher-lower': (r) => `streak ${r.streak ?? '?'}`,
  'you-or-crowd': (r) => `streak ${r.streak ?? '?'}`,
  timeline: (r) => `streak ${r.streak ?? '?'}`,
  tagline: (r) => `streak ${r.streak ?? '?'}`,
  wordle: (r) => `${r.guesses ?? '?'} guess${r.guesses === 1 ? '' : 'es'}`,
  connections: (r) => (r.mistakes === 0 ? 'flawless' : `${r.mistakes ?? '?'} mistake${r.mistakes === 1 ? '' : 's'}`),
  'six-degrees': (r) => `${r.steps ?? '?'} step${r.steps === 1 ? '' : 's'}`,
  'clue-budget': (r) => (r.won ? `won · $${r.saved ?? 0} left` : 'broke'),
  trivia: (r) => (r.won ? `won in ${r.facts ?? '?'}` : 'missed'),
  stamp: (r) => `${r.changes ?? 0} change${r.changes === 1 ? '' : 's'}`,
  'poster-zoom': (r) => (r.won ? `${r.zoomOuts ?? '?'} out${r.zoomOuts === 1 ? '' : 's'}` : 'gave up')
};

export function formatRound (gameKey, record) {
  const label = ROUND_LABELS[gameKey];
  return label ? label(record || {}) : 'played';
}

// The screen-facing entry point: stat lines for one game, null-stats
// dropped. Unknown game keys get a bare rounds count rather than nothing,
// so adding an eleventh game can't silently hide its history.
export function summarizeGame (gameKey, history) {
  const records = Array.isArray(history) ? history : Object.values(history || {});
  if (!records.length) return [];
  const summary = (SUMMARIES[gameKey] || ((r) => [stat('Rounds', r.length)]))(records);
  return summary.filter((line) => line.value !== null && line.value !== undefined);
}
