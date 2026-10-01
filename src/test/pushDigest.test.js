import { describe, it, expect } from 'vitest';
import {
  buildPushDigest,
  stickinessDigest,
  tiebreakDigest,
  awardsYearsNeedingInput,
  gamesDigest
} from '@/assets/javascript/pushDigest.js';
import { GAME_NAMES } from '@/mixins/gameData.js';

// The digest is what the push Lambda trusts VERBATIM — it never re-derives
// prompt logic. So these tests pin the digest to the same behaviour the
// on-screen prompts have, including the boundary arithmetic that lets the
// server count candidates FORWARD in time from a stale digest.

const NOW = new Date('2026-08-27T12:00:00Z').getTime();
const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 604800000;
const SIX_MONTHS = 15778476000;

const getRating = (entry) => ({ calculatedTotal: entry.__score });

const entry = (id, title, { score = 8, ratedAt, rating = {} } = {}) => ({
  __score: score,
  movie: { id, title, release_date: '2020-06-01', runtime: 120 },
  ratings: [{ date: ratedAt, ...rating }]
});

describe('stickinessDigest', () => {
  it('counts films past the one-week boundary without a stickiness rating', () => {
    const entries = [
      entry(1, 'Old, unrated', { ratedAt: NOW - 10 * ONE_DAY }),
      entry(2, 'Fresh, unrated', { ratedAt: NOW - 2 * ONE_DAY }),
      entry(3, 'Old, already rated', {
        ratedAt: NOW - 10 * ONE_DAY,
        rating: { userAddedStickiness: true, userAddedSixMonthStickiness: true }
      })
    ];
    const digest = stickinessDigest(entries, {}, NOW);
    expect(digest.count).toBe(1);
    expect(digest.nextTitle).toBe('Old, unrated');
  });

  it('a film with week-stickiness done still comes due at six months', () => {
    const entries = [entry(1, 'Sixer', {
      ratedAt: NOW - SIX_MONTHS - ONE_DAY,
      rating: { userAddedStickiness: true }
    })];
    expect(stickinessDigest(entries, {}, NOW).count).toBe(1);
  });

  it('publishes FUTURE due boundaries so the server can count forward in time', () => {
    const ratedAt = NOW - 5 * ONE_DAY; // due in 2 days
    const digest = stickinessDigest([entry(1, 'Soon', { ratedAt })], {}, NOW);
    expect(digest.count).toBe(0);
    expect(digest.dueTimes).toContain(ratedAt + ONE_WEEK);
    // The server-side count at (boundary + 1ms) must see it as due.
    const sendTime = ratedAt + ONE_WEEK + 1;
    const dueAtSend = digest.count + digest.dueTimes.filter((t) => t <= sendTime).length;
    expect(dueAtSend).toBe(1);
  });

  it('names the film behind every upcoming boundary, with when it was rated', () => {
    // Bug (Natalie, 2026-09-01): the push named "Picture 06" when the app
    // asked about Coraline. Coraline matured after the digest was published;
    // the server counted it through dueTimes but could only name nextTitle.
    const ratedAt = NOW - 3 * ONE_DAY;
    const entries = [
      entry(1, 'Picture 06', { ratedAt: NOW - 30 * ONE_DAY }),
      entry(2, 'Coraline', { ratedAt })
    ];
    const digest = stickinessDigest(entries, {}, NOW);
    expect(digest.nextTitle).toBe('Picture 06');
    expect(digest.nextRatedAt).toBe(NOW - 30 * ONE_DAY);
    expect(digest.upcoming).toEqual([{ at: ratedAt + ONE_WEEK, title: 'Coraline', ratedAt }]);
    // dueTimes is still the plain list the deployed Lambda counts with.
    expect(digest.dueTimes).toEqual([ratedAt + ONE_WEEK]);
  });

  it('leads with the most recently rated due film, same as the prompt', () => {
    const entries = [
      entry(1, 'Older', { ratedAt: NOW - 30 * ONE_DAY }),
      entry(2, 'Newer', { ratedAt: NOW - 8 * ONE_DAY })
    ];
    expect(stickinessDigest(entries, {}, NOW).nextTitle).toBe('Newer');
  });

  it('uses the LAST rating element, not the newest by date (the mixin behaviour)', () => {
    // Last element already has stickiness — even though an earlier element
    // doesn't. The prompt only reads the last element, so nothing is due.
    const entries = [{
      __score: 8,
      movie: { id: 1, title: 'Rewatched' },
      ratings: [
        { date: NOW - 400 * ONE_DAY },
        { date: NOW - 10 * ONE_DAY, userAddedStickiness: true, userAddedSixMonthStickiness: true }
      ]
    }];
    expect(stickinessDigest(entries, {}, NOW).count).toBe(0);
  });

  it('goes silent when the user disabled the stickiness prompt', () => {
    const entries = [entry(1, 'Due', { ratedAt: NOW - 10 * ONE_DAY })];
    const digest = stickinessDigest(entries, { stickinessPromptState: 'disabled' }, NOW);
    expect(digest.count).toBe(0);
    expect(digest.dueTimes).toEqual([]);
  });
});

describe('tiebreakDigest', () => {
  it('reports a fresh adjacent tie with its group size', () => {
    const entries = [
      entry(1, 'A', { score: 9, ratedAt: NOW }),
      entry(2, 'B', { score: 8, ratedAt: NOW }),
      entry(3, 'C', { score: 8, ratedAt: NOW }),
      entry(4, 'D', { score: 8, ratedAt: NOW }),
      entry(5, 'E', { score: 7, ratedAt: NOW })
    ];
    const digest = tiebreakDigest(entries, {}, getRating);
    expect(digest.due).toBe(true);
    expect(digest.count).toBe(3);
  });

  it('an in-flight tournament is due regardless of current scores', () => {
    const entries = [
      entry(1, 'A', { score: 9, ratedAt: NOW }),
      entry(2, 'B', { score: 8, ratedAt: NOW })
    ];
    const settings = { tieBreakTournament: { contestantIds: [10, 11, 12, 13] } };
    const digest = tiebreakDigest(entries, settings, getRating);
    expect(digest.due).toBe(true);
    expect(digest.count).toBe(4); // frozen contestant list, not a fresh scan
  });

  it('no ties, no tournament — nothing due', () => {
    const entries = [
      entry(1, 'A', { score: 9, ratedAt: NOW }),
      entry(2, 'B', { score: 8, ratedAt: NOW })
    ];
    expect(tiebreakDigest(entries, {}, getRating, NOW)).toMatchObject({ due: false, count: 0, pinned: false });
  });

  it('goes silent when the user disabled the tiebreak prompt', () => {
    const entries = [
      entry(1, 'A', { score: 8, ratedAt: NOW }),
      entry(2, 'B', { score: 8, ratedAt: NOW })
    ];
    const digest = tiebreakDigest(entries, { tieBreakPromptState: 'disabled' }, getRating);
    expect(digest.due).toBe(false);
  });
});

describe('awardsYearsNeedingInput', () => {
  const yearEntries = (year, count, ratedAt = NOW - 30 * ONE_DAY) => Array.from(
    { length: count },
    (_, i) => ({
      __score: 8,
      movie: { id: year * 100 + i, title: `Movie ${i}`, release_date: `${year}-06-01`, runtime: 120 },
      ratings: [{ date: ratedAt }]
    })
  );

  it('a year past the threshold with no awards yet needs input', () => {
    const entries = yearEntries(1997, 3);
    const settings = { awardsYearThreshold: 3 };
    expect(awardsYearsNeedingInput(entries, settings, NOW)).toEqual([1997]);
  });

  it('a completed year with no movies since is done', () => {
    const entries = yearEntries(1997, 3, NOW - 30 * ONE_DAY);
    const settings = {
      awardsYearThreshold: 3,
      personalAwards: { 1997: { completed: true, lastUpdated: NOW - ONE_DAY } }
    };
    expect(awardsYearsNeedingInput(entries, settings, NOW)).toEqual([]);
  });

  it('a completed year reopens when a newer movie lands in it', () => {
    const entries = [
      ...yearEntries(1997, 3, NOW - 30 * ONE_DAY),
      ...yearEntries(1997, 1, NOW - ONE_DAY) // rated after completion
    ];
    const settings = {
      awardsYearThreshold: 3,
      personalAwards: { 1997: { completed: true, lastUpdated: NOW - 10 * ONE_DAY } }
    };
    expect(awardsYearsNeedingInput(entries, settings, NOW)).toEqual([1997]);
  });

  it('a started-but-not-completed year still needs input', () => {
    const entries = yearEntries(1997, 3);
    const settings = {
      awardsYearThreshold: 3,
      personalAwards: { 1997: { completed: false } }
    };
    expect(awardsYearsNeedingInput(entries, settings, NOW)).toEqual([1997]);
  });

  it('goes silent when the user disabled the awards prompt', () => {
    const entries = yearEntries(1997, 3);
    const settings = { awardsYearThreshold: 3, awardsPromptState: 'disabled' };
    expect(awardsYearsNeedingInput(entries, settings, NOW)).toEqual([]);
  });
});

describe('buildPushDigest', () => {
  it('always publishes a complete object, empty sections included', () => {
    const digest = buildPushDigest({ entries: [], settings: {}, getRating, now: NOW });
    expect(digest).toEqual({
      updatedAt: NOW,
      stickiness: { count: 0, nextTitle: null, nextRatedAt: null, dueTimes: [], upcoming: [], eligibleAt: 0 },
      // No lastTweak on a fresh account, so Home.vue's `|| now` fallback
      // makes the first tiebreak wait one full interval.
      tiebreak: { due: false, count: 0, eligibleAt: NOW + ONE_DAY, pinned: false },
      awards: { years: [], eligibleAt: 0 },
      games: gamesDigest({})
    });
  });
});

// Bug, 2026-08-28: a push announced chores, and tapping it landed on an app
// with no prompt at all. The digest published what was due IN THE DATA;
// Home.vue additionally gates each prompt behind its daily quota
// (promptQuota.js). `eligibleAt` publishes that gate so the sender can only
// promise work the app will really show.
describe('eligibleAt — the quota gate the app applies', () => {
  const HOUR = 60 * 60 * 1000;

  it('stickiness with no configured limit is always eligible', () => {
    const d = stickinessDigest([], {}, NOW);
    expect(d.eligibleAt).toBe(0);
  });

  it('stickiness rate-limited today reports when the prompt reopens', () => {
    const settings = { stickinessPromptsPerDay: 4, lastStickinessPromptAt: NOW - HOUR };
    // 4 a day → one every 6 hours → five hours left to wait.
    expect(stickinessDigest([], settings, NOW).eligibleAt).toBe(NOW - HOUR + 6 * HOUR);
  });

  it('an allowance of zero empties the section — the prompt is off', () => {
    const entries = [entry(1, 'Waiting', { ratedAt: NOW - 30 * ONE_DAY })];
    const settings = { stickinessPromptsPerDay: 0 };
    expect(stickinessDigest(entries, settings, NOW).count).toBe(0);
  });

  it('tiebreak mirrors Home.vue: lastTweak + a day over the allowance', () => {
    const entries = [
      entry(1, 'A', { score: 8, ratedAt: NOW }),
      entry(2, 'B', { score: 8, ratedAt: NOW })
    ];
    const settings = { lastTweak: NOW - HOUR, tieBreakTweak: 10 };
    const d = tiebreakDigest(entries, settings, getRating, NOW);
    expect(d.due).toBe(true);
    // 10 a day → every 2.4h → 1.4h still to wait. This is exactly the case
    // that produced the empty screen.
    expect(d.eligibleAt).toBe(NOW - HOUR + (24 / 10) * HOUR);
    expect(d.eligibleAt).toBeGreaterThan(NOW);
  });

  it('a live tournament is flagged as pinning the screen', () => {
    const settings = { tieBreakTournament: { contestantIds: [1, 2, 3] } };
    expect(tiebreakDigest([], settings, getRating, NOW).pinned).toBe(true);
    expect(tiebreakDigest([], {}, getRating, NOW).pinned).toBe(false);
  });

  it('awards publish their gate too', () => {
    const digest = buildPushDigest({ entries: [], settings: {}, getRating, now: NOW });
    expect(digest.awards).toHaveProperty('eligibleAt');
    expect(digest.stickiness).toHaveProperty('eligibleAt');
    expect(digest.tiebreak).toHaveProperty('eligibleAt');
  });
});

describe('dueTimes counts each film once', () => {
  it('a film waiting on BOTH its week and six-month pass emits one boundary', () => {
    // Rated three days ago with neither stickiness recorded. Emitting both
    // boundaries would let the server count this single film twice.
    const entries = [entry(1, 'Both pending', { ratedAt: NOW - 3 * ONE_DAY })];
    const d = stickinessDigest(entries, {}, NOW);
    expect(d.count).toBe(0);
    expect(d.dueTimes).toHaveLength(1);
    expect(d.dueTimes[0]).toBe(NOW - 3 * ONE_DAY + 604800000); // the WEEK one
  });

  it('a film that only needs its six-month pass emits that boundary', () => {
    // Rated five months ago, week-stickiness already given: its only
    // remaining boundary is the six-month one, about a month away — inside
    // the 90-day publishing horizon.
    const ratedAt = NOW - 150 * ONE_DAY;
    const entries = [entry(1, 'Week done', { ratedAt, rating: { userAddedStickiness: true } })];
    const d = stickinessDigest(entries, {}, NOW);
    expect(d.dueTimes).toEqual([ratedAt + SIX_MONTHS]);
  });

  it('a boundary beyond the horizon is not published yet', () => {
    // Six months away is further than the 90-day horizon; the app
    // republishes constantly, so it will be published when it comes close.
    const entries = [entry(1, 'Far off', {
      ratedAt: NOW - 3 * ONE_DAY,
      rating: { userAddedStickiness: true }
    })];
    expect(stickinessDigest(entries, {}, NOW).dueTimes).toEqual([]);
  });
});

// The games reminder (2026-09-07) names only games not yet played today. The
// Lambda decides "today" in the user's timezone; the digest's job is to
// carry every game, by name, with when it was last played.
describe('gamesDigest', () => {
  it('lists every game by name, unplayed ones with no time', () => {
    const digest = gamesDigest({});
    expect(digest.list.length).toBe(Object.keys(GAME_NAMES).length);
    expect(digest.list.find((g) => g.key === 'wordle')).toEqual({ key: 'wordle', name: 'Reel Wordle', lastPlayedAt: null });
  });

  it('takes the latest recorded round as the last play', () => {
    const settings = { games: { history: { wordle: [{ at: NOW - 3 * ONE_DAY }, { at: NOW - ONE_DAY }] } } };
    expect(gamesDigest(settings).list.find((g) => g.key === 'wordle').lastPlayedAt).toBe(NOW - ONE_DAY);
  });

  it('reads history that came back from Firebase as an object', () => {
    const settings = { games: { history: { trivia: { a: { at: NOW - 5 * ONE_DAY }, b: { at: NOW - 2 * ONE_DAY } } } } };
    expect(gamesDigest(settings).list.find((g) => g.key === 'trivia').lastPlayedAt).toBe(NOW - 2 * ONE_DAY);
  });

  // The streak games stamp a win on the first correct answer but only record
  // a round when the streak ends — quitting mid-streak is still playing.
  it('counts a win stamp as playing when it is newer than the last round', () => {
    const stampDay = new Date(NOW);
    const settings = {
      games: {
        history: { timeline: [{ at: NOW - 10 * ONE_DAY }] },
        wins: { timeline: stampDay.toDateString() }
      }
    };
    const midnight = new Date(stampDay.toDateString()).getTime();
    expect(gamesDigest(settings).list.find((g) => g.key === 'timeline').lastPlayedAt).toBe(midnight);
  });

  it('rides along in the full digest', () => {
    const digest = buildPushDigest({ entries: [], settings: {}, getRating, now: NOW });
    expect(digest.games.list.length).toBe(Object.keys(GAME_NAMES).length);
  });
});

// Bug report 2026-10-01: shorts were turning up in tiebreaks with the
// "Include short films" setting off. The chore notification must agree.
describe('tiebreakDigest with short films turned off', () => {
  const film = (id, score, runtime) => ({ ...entry(id, `Film ${id}`, { score, ratedAt: NOW }), dbKey: `k-${id}`, movie: { id, runtime } });

  it('ignores a tie made only of shorts', () => {
    const entries = [film(1, 9, 120), film(2, 7, 15), film(3, 7, 20)];
    expect(tiebreakDigest(entries, {}, getRating, NOW).due).toBe(false);
    expect(tiebreakDigest(entries, { includeShorts: true }, getRating, NOW).count).toBe(2);
  });

  it('does not count a tournament that holds a short', () => {
    const entries = [film(1, 8, 15), film(2, 8, 120), film(3, 6, 120)];
    const settings = { tieBreakTournament: { contestantIds: ['k-1', 'k-2'] } };
    expect(tiebreakDigest(entries, settings, getRating, NOW)).toMatchObject({ due: false, pinned: false });
    expect(tiebreakDigest(entries, { ...settings, includeShorts: true }, getRating, NOW).pinned).toBe(true);
  });
});

