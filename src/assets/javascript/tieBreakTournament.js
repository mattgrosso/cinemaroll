// Pure round-robin tournament state machine for resolving a group of movies
// tied on rating score. Vue-free and store-free (same pattern as
// games/bracket.js) so it's unit-testable without mounting anything, and so
// its state is plain JSON — it gets persisted directly to
// settings/tieBreakTournament in Firebase, since a tournament can span many
// days at the existing one-match-per-daily-quota-slot pace.
//
// Contestant membership is frozen at creation time (contestantIds is never
// recomputed from a fresh tie scan). That's deliberate: a movie rated later
// that happens to also match the tied score must NOT be swept into an
// already-running tournament — it waits for the next tie scan, which only
// ever runs once there is no active tournament (see TweakInline.vue).

import { isShortEntry } from './shorts.js';

// The stored tournament, unless it pits a short film against the rest while
// the "include short films" setting is off — then it no longer counts, and
// the caller treats it as absent (TweakInline clears the record and starts
// over without the short). Bug report 2026-10-01: "I'm still seeing shorts
// tied in tiebreakers, which feels like they should be excluded from that if
// I have shorts turned off." An unknown contestant (library not loaded yet)
// is never taken as a short, so a cold launch can't throw a tournament away.
export function liveTournament (tournament, entries, includeShorts) {
  if (!tournament) return null;
  if (includeShorts) return tournament;
  const ids = new Set(tournament.contestantIds || []);
  const holdsShort = (entries || []).some((entry) => ids.has(entry?.dbKey) && isShortEntry(entry));
  return holdsShort ? null : tournament;
}

// Finds the full contiguous run of entries sharing the same score as the
// first adjacent tie in `sortedEntries` (works regardless of best-first or
// worst-first order, since a tied group is contiguous either way).
// `getScore` extracts the comparable score from an entry.
/**
 * How many films the tiebreak prompt is actually about.
 *
 * Report -P-FN61DdMmTJ0J9XJWy (2026-08-17): "The new ties dialogue always
 * says there are two movies tied where in fact, they are often more than
 * two." The copy was a fixed "Two films"; this is the real number — the
 * frozen contestant list once a tournament exists, otherwise the tied
 * group that opening it would enter.
 */
export function tiedContestantCount (tournament, tiedGroup) {
  const frozen = tournament?.contestantIds?.length;
  if (frozen) return frozen;
  return (tiedGroup || []).length;
}

const SMALL_NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/** `3` → 'Three', `14` → '14'. Keeps the prompt's written-out voice. */
export function countWord (count) {
  // Not "Zero": Number(null) is 0, and an absent count should say nothing
  // at all rather than narrate a tie between no films.
  if (count === null || count === undefined || count === '') return '';
  const number = Number(count);
  if (!Number.isFinite(number) || number < 0) return '';
  const word = SMALL_NUMBERS[number];
  if (!word) return String(number);
  return word.charAt(0).toUpperCase() + word.slice(1);
}

export function findTiedGroup (sortedEntries, getScore) {
  const firstTiedIndex = sortedEntries.findIndex((entry, index) => {
    const next = sortedEntries[index + 1];
    return Boolean(next) && getScore(entry) === getScore(next);
  });

  if (firstTiedIndex === -1) return [];

  const score = getScore(sortedEntries[firstTiedIndex]);
  let start = firstTiedIndex;
  let end = firstTiedIndex + 1;

  while (start > 0 && getScore(sortedEntries[start - 1]) === score) start--;
  while (end + 1 < sortedEntries.length && getScore(sortedEntries[end + 1]) === score) end++;

  return sortedEntries.slice(start, end + 1);
}

// Every unique pair among the contestants, in stable original order (i.e.
// every one of contestant 0's matches, then every remaining one of
// contestant 1's, etc). Shuffled afterward by createRoundRobinTournament
// when an rng is supplied — kept as a separate, order-only step so a caller
// that omits rng (most of this file's own tests) still gets this exact,
// easily-asserted-on order.
function buildSchedule (contestantIds) {
  const schedule = [];
  for (let i = 0; i < contestantIds.length; i++) {
    for (let j = i + 1; j < contestantIds.length; j++) {
      schedule.push({ a: contestantIds[i], b: contestantIds[j] });
    }
  }
  return schedule;
}

// Fisher-Yates. Kept local (not imported from games/gameUtils.js) so this
// module stays fully self-contained — see its "architecturally separate
// from the Rate-Off game" framing elsewhere in the docs.
function shuffle (array, rng) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Reorders a schedule so consecutive matches share no contestant, wherever
 * that is possible.
 *
 * Matt, 2026-08-19, on posters being slow to swap between rounds: "I think we
 * could solve a lot by just not letting the same movie be in two consecutive
 * matchups, then it wouldn't be as confusing."
 *
 * Right: when a film carries over, the screen changes only on one side, and a
 * half-loaded swap is indistinguishable from no swap at all. Two entirely
 * different posters can't be misread that way.
 *
 * Greedy, and it cannot always succeed — for the smallest ties the maths
 * forbids it:
 *
 *   3 films → 3 matches (ab, ac, bc). Every pair shares a film with every
 *     other pair, so both transitions repeat no matter the order.
 *   4 films → 6 matches. Each match has exactly ONE other it is disjoint
 *     from (its complement), so at most 3 of the 5 transitions can be clean
 *     and 2 repeats are forced.
 *   5+ films → 0 repeats, always achievable and achieved.
 *
 * Both small cases here hit the proven optimum, verified by brute force
 * against every permutation. They are also the common tie sizes, which is
 * why the loading gate in TweakInline is the other half of this fix rather
 * than a belt-and-braces extra: with three or four films tied, some
 * carry-over is unavoidable.
 *
 * Among the disjoint candidates it takes the one whose films have the most
 * matches still to play, which is what lifts 5+ from "nearly always clean"
 * to "always clean": it spends the constrained films while options remain,
 * instead of leaving them stranded together at the end. Ties keep the
 * earliest candidate, so a shuffled schedule keeps its shuffled character.
 */
export function spreadSchedule (schedule) {
  const remaining = [...schedule];
  const spread = [];
  let previous = null;

  while (remaining.length) {
    // How many matches each film still has left to play.
    const matchesLeft = {};
    remaining.forEach((match) => {
      matchesLeft[match.a] = (matchesLeft[match.a] || 0) + 1;
      matchesLeft[match.b] = (matchesLeft[match.b] || 0) + 1;
    });

    const disjoint = (match) => !previous
      || (match.a !== previous.a && match.a !== previous.b
        && match.b !== previous.a && match.b !== previous.b);

    const indexed = remaining.map((match, index) => ({ match, index }));
    const eligible = indexed.filter(({ match }) => disjoint(match));
    // Nothing disjoint left — a forced repeat, so consider everything.
    const pool = eligible.length ? eligible : indexed;

    const busiest = (entry) => matchesLeft[entry.match.a] + matchesLeft[entry.match.b];
    // Stable sort, so equal-pressure candidates keep their existing order.
    const chosen = [...pool].sort((x, y) => busiest(y) - busiest(x))[0];

    previous = chosen.match;
    spread.push(previous);
    remaining.splice(chosen.index, 1);
  }

  return spread;
}

// `rng`, when supplied, randomizes match order so play doesn't run through
// every one of one contestant's matches before moving to the next (bug
// report). Defaults to `null` (schedule left in buildSchedule's stable
// order) rather than `Math.random` so existing/new callers that care about a
// deterministic order — mainly this file's own tests — don't have to fight
// randomness; TweakInline.vue's real call site passes Math.random.
//
// spreadSchedule runs in BOTH cases: it is a legibility constraint, not a
// randomization, and an unshuffled schedule is the one that most needs it
// (buildSchedule emits every one of contestant 0's matches back to back).
export function createRoundRobinTournament (contestantIds, rng = null) {
  const wins = {};
  contestantIds.forEach((id) => { wins[id] = 0; });

  const schedule = buildSchedule(contestantIds);

  return {
    contestantIds: [...contestantIds],
    schedule: spreadSchedule(rng ? shuffle(schedule, rng) : schedule),
    nextIndex: 0,
    wins,
    // Filled by recordMatchResult. Firebase drops an empty array on the way
    // out, so every reader treats a missing one as [].
    matchResults: [],
    startedAt: Date.now(),
    finalRanking: null,
    completedAt: null
  };
}

export function currentMatch (tournament) {
  return tournament.schedule[tournament.nextIndex] || null;
}

export function isComplete (tournament) {
  return tournament.nextIndex >= tournament.schedule.length;
}

/**
 * Wins counted ONLY against a given set of opponents — a mini-league table.
 *
 * For two contestants that's literally their head-to-head match: the winner
 * scores 1, the loser 0. For three or more it generalizes the same way league
 * tables do, which is what makes it able to say anything at all about a
 * three-way tie.
 *
 * Reads `matchResults`, which older tournaments (already in flight when this
 * shipped, or persisted before it) simply don't have — hence the `|| []`. A
 * tournament with no records produces an all-zero table, every contestant
 * stays tied, and ranking falls through to the original order exactly as it
 * did before.
 */
function miniLeagueWins (tournament, ids) {
  const inGroup = new Set(ids);
  const table = {};
  ids.forEach((id) => { table[id] = 0; });

  (tournament.matchResults || []).forEach((result) => {
    if (!result) return;
    const { a, b, winnerId } = result;
    // Only matches BETWEEN two members of this group say anything about how
    // they compare with each other.
    if (!inGroup.has(a) || !inGroup.has(b)) return;
    if (winnerId === a || winnerId === b) table[winnerId] += 1;
  });

  return table;
}

/**
 * Ranks contestants by win count descending, breaking equal-win ties on
 * head-to-head.
 *
 * Matt, 2026-08-19: "are you breaking ties with the head-to-head matchups? It
 * seems like the way to go. If two things are tied they ought to be separated
 * by their own head-to-head matchup I suppose that still could lead to a
 * transitive property problem where things work in a circle."
 *
 * He's right on both counts. Head-to-head settles the overwhelmingly common
 * case — two movies on equal wins, one of which beat the other. And it cannot
 * settle a cycle: with A>B, B>C, C>A every one of them has exactly one win
 * inside the group, the mini-league is level, and there is no ordering the
 * results actually support. That case falls back to the original contestant
 * order, deliberately: with the evidence genuinely circular, inventing a
 * winner would be dressing up a coin flip as a judgement. It stays stable and
 * predictable instead.
 */
export function rankContestants (tournament) {
  const entries = tournament.contestantIds
    .map((id, originalIndex) => ({ dbKey: id, wins: tournament.wins[id] || 0, originalIndex }));

  // Group by overall wins, then order within each group by the mini-league
  // among exactly those contestants.
  const byWins = new Map();
  entries.forEach((entry) => {
    if (!byWins.has(entry.wins)) byWins.set(entry.wins, []);
    byWins.get(entry.wins).push(entry);
  });

  const ordered = [];
  [...byWins.keys()].sort((a, b) => b - a).forEach((winCount) => {
    const group = byWins.get(winCount);

    if (group.length === 1) {
      ordered.push(group[0]);
      return;
    }

    const table = miniLeagueWins(tournament, group.map((entry) => entry.dbKey));
    group
      .sort((a, b) => (table[b.dbKey] - table[a.dbKey]) || (a.originalIndex - b.originalIndex))
      .forEach((entry) => ordered.push(entry));
  });

  return ordered.map(({ dbKey, wins }, index) => ({ dbKey, wins, rank: index }));
}


// Immutable — returns a NEW tournament state with the match recorded and
// nextIndex advanced. If that was the last scheduled match, also attaches
// finalRanking + completedAt.
export function recordMatchResult (tournament, winnerId) {
  const match = currentMatch(tournament);
  if (!match) return tournament;

  const wins = { ...tournament.wins, [winnerId]: (tournament.wins[winnerId] || 0) + 1 };
  const nextIndex = tournament.nextIndex + 1;
  // WHO beat whom, not just how many — win counts alone can't break a tie
  // between two contestants who finish level (see rankContestants).
  const matchResults = [...(tournament.matchResults || []), { a: match.a, b: match.b, winnerId }];
  const updated = {
    ...tournament, wins, matchResults, nextIndex
  };

  if (nextIndex >= updated.schedule.length) {
    updated.finalRanking = rankContestants(updated);
    updated.completedAt = Date.now();
  }

  return updated;
}

// 1-indexed "match N of M" plus the contestant count, for a progress readout.
export function progress (tournament) {
  return {
    current: Math.min(tournament.nextIndex + 1, tournament.schedule.length),
    total: tournament.schedule.length,
    contestants: tournament.contestantIds.length
  };
}

// The score adjustment to apply once a tournament completes, generalizing
// the old one-pair-at-a-time tiebreak's flat -0.1 penalty to the loser: rank
// 0 (the top of the final standings) is untouched, each rank below loses a
// further 0.1.
/**
 * How far to nudge each contestant's `tweakValue` by finishing position.
 *
 * NOT the change to the visible score. `tweakValue` is added to `overall`,
 * which is then weighted (2) and divided by 10 — so the score moves by a
 * FIFTH of this: -0.0005 per rank on tweakValue is exactly -0.0001 per rank
 * on `calculatedTotal`, one slot on the FOURTH decimal.
 *
 * That decimal is deliberately invisible. Scores are computed to 4dp
 * (GetRating.js) and displayed at 2dp (formatScore.js), so a tournament
 * verdict re-orders the tied films without moving any number a screen shows.
 * Matt, 2026-08-21: "the tiebreakers should modify... the fourth. Just go
 * all the way, and then I'll have a lot more space."
 *
 * History: was -0.1, then -0.05 — sized to shift the SECOND decimal, because
 * at 2dp that was the smallest step that changed the sort at all. Those old
 * deltas remain in stored tweakValues and still order their groups correctly
 * (they're just 100x the new step); they are not migrated, because they
 * encode real verdicts and rescaling them would change displayed scores.
 * The old comment conceded ties "can't be eliminated, since ~1,300 movies
 * share a few hundred 0.01 slots" — at 4dp there are 100,000 slots, and a
 * whole 18-film group resolves within 0.0017 of score space.
 */
export function tweakDeltaForRank (rank) {
  return -0.0005 * rank;
}
