import { describe, it, expect } from 'vitest';
import {
  dueFromDigest,
  newsIn,
  nextBaseline,
  spacingMs,
  shouldSend,
  composeMessage,
  friendLogBody,
  stickinessLead,
  EMPTY_BASELINE,
  localDateKey,
  gamesDue,
  shouldSendGames,
  composeGamesMessage,
  externalWatches,
  externalLogsDue,
  signupsDue,
  emailGuessFromKey,
  composeSignupMessages,
  SIGNUP_MAX_PER_SWEEP,
  alamoListings,
  listingsDue,
  showTimeLabel,
  composeListingMessages,
  decodeEntities,
  veeziDateTime,
  veeziListings,
  afiListings,
  boxofficeListings,
  LISTINGS_MAX_PER_SWEEP,
  LISTINGS_FORGET_MS
} from '../../aws-lambda/pushCadence.js';

// Matt, 2026-08-28: notify "as the prompts come in", not once a day. The
// whole risk of that change is nagging — re-announcing a standing backlog
// every few hours — so most of these tests are about the times it must STAY
// QUIET. The Lambda is otherwise untested code, which is exactly why this
// decision was extracted into a pure module.

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-08-28T18:00:00Z').getTime();

const digestWith = ({ count = 0, dueTimes = [], nextTitle = null, nextRatedAt = null, upcoming = [], tiebreak = null, years = [] } = {}) => ({
  updatedAt: NOW - 6 * HOUR,
  stickiness: { count, dueTimes, nextTitle, nextRatedAt, upcoming },
  tiebreak: tiebreak || { due: false, count: 0 },
  awards: { years }
});

// Inside the waking window, app closed a while ago, well past the spacing.
const baseArgs = (overrides = {}) => ({
  prefs: {},
  baseline: EMPTY_BASELINE,
  now: NOW,
  localHour: 12,
  lastSentAt: NOW - 12 * HOUR,
  digestUpdatedAt: NOW - 6 * HOUR,
  ...overrides
});

describe('dueFromDigest', () => {
  it('counts boundaries that have passed since the app last published', () => {
    const digest = digestWith({ count: 2, dueTimes: [NOW - HOUR, NOW - 60, NOW + HOUR] });
    expect(dueFromDigest(digest, {}, NOW).stickinessCount).toBe(4);
  });

  it('honours per-category opt-outs', () => {
    const digest = digestWith({
      count: 3,
      tiebreak: { due: true, count: 4 },
      years: [1997]
    });
    const due = dueFromDigest(digest, { stickiness: false, tiebreak: false, awards: false }, NOW);
    expect(due).toEqual({ stickinessCount: 0, tiebreak: null, awardYears: [] });
  });
});

describe('newsIn', () => {
  it('more waiting films than we have mentioned is news', () => {
    const due = { stickinessCount: 5, tiebreak: null, awardYears: [] };
    expect(newsIn(due, { stickinessCount: 4 }).any).toBe(true);
  });

  it('the same backlog we already announced is NOT news', () => {
    const due = { stickinessCount: 13, tiebreak: null, awardYears: [] };
    expect(newsIn(due, { stickinessCount: 13 }).any).toBe(false);
  });

  it('a shrinking backlog is not news — doing the work must not trigger a push', () => {
    const due = { stickinessCount: 9, tiebreak: null, awardYears: [] };
    expect(newsIn(due, { stickinessCount: 13 }).any).toBe(false);
  });

  it('an award year we have never named is news; one we have is not', () => {
    const due = { stickinessCount: 0, tiebreak: null, awardYears: [1997, 2003] };
    expect(newsIn(due, { awardYears: [1997] }).newAwardYears).toEqual([2003]);
    expect(newsIn(due, { awardYears: [1997, 2003] }).any).toBe(false);
  });

  it('a tiebreak appearing is news, a standing one is not', () => {
    const due = { stickinessCount: 0, tiebreak: { due: true, count: 3 }, awardYears: [] };
    expect(newsIn(due, { tiebreak: false }).newTiebreak).toBe(true);
    expect(newsIn(due, { tiebreak: true }).any).toBe(false);
  });
});

describe('nextBaseline', () => {
  it('after sending, everything currently due counts as said', () => {
    const due = { stickinessCount: 7, tiebreak: { due: true, count: 2 }, awardYears: [1997] };
    expect(nextBaseline(due, EMPTY_BASELINE, true)).toEqual({
      stickinessCount: 7, tiebreak: true, awardYears: [1997]
    });
  });

  it('ratchets DOWN when not sending, so a finished chore re-arms', () => {
    // Announced 13, they rated all but 2, then a new film matures.
    const afterWork = { stickinessCount: 2, tiebreak: null, awardYears: [] };
    const lowered = nextBaseline(afterWork, { stickinessCount: 13 }, false);
    expect(lowered.stickinessCount).toBe(2);
    // That third film is now genuinely news again.
    expect(newsIn({ stickinessCount: 3, tiebreak: null, awardYears: [] }, lowered).any).toBe(true);
  });

  it('never ratchets UP without sending — a growing backlog stays news', () => {
    const grown = { stickinessCount: 20, tiebreak: null, awardYears: [] };
    expect(nextBaseline(grown, { stickinessCount: 13 }, false).stickinessCount).toBe(13);
  });

  it('drops award years that are no longer due, so they can be news again', () => {
    const due = { stickinessCount: 0, tiebreak: null, awardYears: [2003] };
    const next = nextBaseline(due, { awardYears: [1997, 2003] }, false);
    expect(next.awardYears).toEqual([2003]);
  });
});

describe('spacingMs', () => {
  it('divides the WAKING WINDOW by the allowance, not the whole day', () => {
    // 12-hour window, 4 a day → every 3 hours. Dividing 24h by 4 would give
    // 6h and quietly deliver about half the stated number.
    expect(spacingMs({ windowStart: 9, windowEnd: 21, pushesPerDay: 4 })).toBe(3 * HOUR);
  });

  it('falls back to a sane window when the configured one is inverted', () => {
    expect(spacingMs({ windowStart: 22, windowEnd: 6, pushesPerDay: 4 })).toBe(3 * HOUR);
  });
});

describe('shouldSend — the quiet cases', () => {
  const due = { stickinessCount: 5, tiebreak: null, awardYears: [] };

  it('stays quiet when nothing is due', () => {
    const result = shouldSend(baseArgs({ due: { stickinessCount: 0, tiebreak: null, awardYears: [] } }));
    expect(result).toMatchObject({ send: false, reason: 'nothing-due' });
  });

  it('stays quiet outside the waking window', () => {
    expect(shouldSend(baseArgs({ due, localHour: 3 }))).toMatchObject({ send: false, reason: 'outside-window' });
    expect(shouldSend(baseArgs({ due, localHour: 22 }))).toMatchObject({ send: false, reason: 'outside-window' });
  });

  it('stays quiet while the app is open — the prompts are already on screen', () => {
    const result = shouldSend(baseArgs({ due, digestUpdatedAt: NOW - 5 * 60 * 1000 }));
    expect(result).toMatchObject({ send: false, reason: 'in-app' });
  });

  it('respects the spacing between sends', () => {
    const result = shouldSend(baseArgs({ due, lastSentAt: NOW - HOUR }));
    expect(result).toMatchObject({ send: false, reason: 'too-soon' });
  });

  it('THE NAGGING GUARD: will not re-announce a backlog it already announced', () => {
    const result = shouldSend(baseArgs({
      due: { stickinessCount: 13, tiebreak: null, awardYears: [] },
      baseline: { stickinessCount: 13, tiebreak: false, awardYears: [] },
      lastSentAt: NOW - 4 * HOUR
    }));
    expect(result).toMatchObject({ send: false, reason: 'no-news' });
  });

  it('stays quiet when push is switched off entirely', () => {
    expect(shouldSend(baseArgs({ due, prefs: { enabled: false } }))).toMatchObject({ send: false });
  });
});

describe('shouldSend — the cases that should fire', () => {
  it('fires when a film newly matures into stickiness', () => {
    const result = shouldSend(baseArgs({
      due: { stickinessCount: 3, tiebreak: null, awardYears: [] },
      baseline: { stickinessCount: 2, tiebreak: false, awardYears: [] },
      lastSentAt: NOW - 4 * HOUR
    }));
    expect(result.send).toBe(true);
    expect(result.reason).toBe('news');
  });

  it('re-mentions a still-unfinished chore a day later, with no new news', () => {
    const result = shouldSend(baseArgs({
      due: { stickinessCount: 13, tiebreak: null, awardYears: [] },
      baseline: { stickinessCount: 13, tiebreak: false, awardYears: [] },
      lastSentAt: NOW - 25 * HOUR
    }));
    expect(result).toMatchObject({ send: true, reason: 'stale' });
  });

  it('several small arrivals through one day each get their own ping', () => {
    // Films mature at 10:00, 13:00 and 16:00; spacing is 3h.
    let baseline = EMPTY_BASELINE;
    let lastSentAt = NOW - 30 * HOUR;
    const sends = [];

    [{ hour: 10, count: 1 }, { hour: 13, count: 2 }, { hour: 16, count: 3 }].forEach(({ hour, count }) => {
      const at = NOW + hour * HOUR;
      const due = { stickinessCount: count, tiebreak: null, awardYears: [] };
      const result = shouldSend({
        due, prefs: {}, baseline, now: at, localHour: hour, lastSentAt, digestUpdatedAt: 0
      });
      if (result.send) {
        sends.push(hour);
        lastSentAt = at;
      }
      baseline = nextBaseline(due, baseline, result.send);
    });

    expect(sends).toEqual([10, 13, 16]);
  });

  it("'daily' cadence still behaves as it did: one nudge, at the chosen hour", () => {
    const due = { stickinessCount: 4, tiebreak: null, awardYears: [] };
    const prefs = { cadence: 'daily', hour: 19 };
    expect(shouldSend(baseArgs({ due, prefs, localHour: 14 }))).toMatchObject({ send: false, reason: 'wrong-hour' });
    expect(shouldSend(baseArgs({ due, prefs, localHour: 19, lastSentAt: NOW - 30 * HOUR }))).toMatchObject({ send: true });
    // No news requirement in daily mode — the standing backlog is the point.
    const sameBacklog = shouldSend(baseArgs({
      due, prefs, localHour: 19, baseline: { stickinessCount: 4 }, lastSentAt: NOW - 30 * HOUR
    }));
    expect(sameBacklog.send).toBe(true);
  });
});

describe('stickinessLead', () => {
  // Bug report (Natalie, 2026-09-01): "it said that Picture 06 needed a
  // stickiness, even though it was actually Coraline that needed stickiness."
  // Picture 06 was the digest's nextTitle; Coraline crossed its boundary
  // after the digest was published and, being the more recently rated, led
  // the prompt when she arrived.
  const DAY = 24 * HOUR;
  const coraline = { at: NOW - HOUR, title: 'Coraline', ratedAt: NOW - HOUR - 7 * DAY };

  it('names the film that just matured over the older one already waiting', () => {
    const digest = digestWith({
      count: 1, nextTitle: 'Picture 06', nextRatedAt: NOW - 30 * DAY,
      dueTimes: [coraline.at], upcoming: [coraline]
    });
    expect(stickinessLead(digest, NOW)).toBe('Coraline');
    const due = { stickinessCount: 2, tiebreak: null, awardYears: [] };
    const message = composeMessage(due, digest, { any: true, newStickiness: true, newAwardYears: [] }, NOW);
    expect(message.title).toBe('Coraline is ready for its stickiness rating (+1 more)');
  });

  it('keeps the already-waiting film in front when it was rated more recently', () => {
    // A six-month boundary belongs to a film rated half a year ago; a film
    // that came due on its week boundary is newer, and the prompt keeps it.
    const sixMonth = { at: NOW - HOUR, title: 'Old One', ratedAt: NOW - 183 * DAY };
    const digest = digestWith({
      count: 1, nextTitle: 'Last Week', nextRatedAt: NOW - 8 * DAY,
      dueTimes: [sixMonth.at], upcoming: [sixMonth]
    });
    expect(stickinessLead(digest, NOW)).toBe('Last Week');
  });

  it('ignores boundaries still in the future', () => {
    const later = { at: NOW + HOUR, title: 'Not Yet', ratedAt: NOW - 6 * DAY };
    const digest = digestWith({ count: 1, nextTitle: 'Sinners', nextRatedAt: NOW - 9 * DAY, dueTimes: [later.at], upcoming: [later] });
    expect(stickinessLead(digest, NOW)).toBe('Sinners');
  });

  it('names nothing rather than the wrong film when matured films have no names', () => {
    // A digest published before `upcoming` existed: something matured, and
    // we cannot say what. The old behaviour here was exactly the bug.
    const digest = digestWith({ count: 1, nextTitle: 'Picture 06', dueTimes: [NOW - HOUR] });
    expect(stickinessLead(digest, NOW)).toBeNull();
    const due = { stickinessCount: 2, tiebreak: null, awardYears: [] };
    const message = composeMessage(due, digest, { any: true, newStickiness: true, newAwardYears: [] }, NOW);
    expect(message.title).toBe('2 films are ready for a stickiness check');
  });

  it('still names the lone waiting film when nothing has matured', () => {
    const digest = digestWith({ count: 1, nextTitle: 'Sinners' });
    expect(stickinessLead(digest, NOW)).toBe('Sinners');
  });
});

describe('composeMessage', () => {
  it('names the film when one just matured, and counts the rest', () => {
    const due = { stickinessCount: 3, tiebreak: null, awardYears: [] };
    const digest = digestWith({ count: 3, nextTitle: 'Sinners' });
    const message = composeMessage(due, digest, { any: true, newStickiness: true, newAwardYears: [] });
    expect(message.title).toBe('Sinners is ready for its stickiness rating (+2 more)');
  });

  it('names the film plainly when it is the only one waiting', () => {
    const due = { stickinessCount: 1, tiebreak: null, awardYears: [] };
    const digest = digestWith({ count: 1, nextTitle: 'Sinners' });
    const message = composeMessage(due, digest, { any: true, newStickiness: true, newAwardYears: [] });
    expect(message.title).toBe('Sinners is ready for its stickiness rating');
  });

  it('falls back to counts for a stale re-mention', () => {
    const due = { stickinessCount: 13, tiebreak: null, awardYears: [] };
    const digest = digestWith({ count: 13, nextTitle: 'Sinners' });
    const message = composeMessage(due, digest, { any: false, newStickiness: false, newAwardYears: [] });
    expect(message.title).toBe('13 films are ready for a stickiness check');
  });

  it('puts the other chores in the body', () => {
    const due = {
      stickinessCount: 2,
      tiebreak: { due: true, count: 4 },
      awardYears: [1997]
    };
    const message = composeMessage(due, digestWith({ count: 2 }), { any: false, newAwardYears: [] });
    expect(message.body).toBe('4 films are tied · 1997 needs its personal awards');
  });

  // Bug report (Matt, 2026-08-28): "The notification told me that I had three
  // [award] years to deal with, but really since we only deal with one at a
  // time it should not give me a number. I should just say you have a movie
  // here. Maybe you could tell me the year."
  it('names one award year rather than counting them', () => {
    const due = { stickinessCount: 0, tiebreak: null, awardYears: [2009, 2014, 2019] };
    const message = composeMessage(due, digestWith({ count: 0 }), { any: false, newAwardYears: [] });
    expect(message.title).toBe('2009 needs its personal awards');
    expect(message.title).not.toMatch(/\d+ years/);
  });

  // Bug report (2026-09-13): tapping a notification should land on Home
  // with "the applicable notification already opened and ready to go". The
  // message says which chore its headline is about; the Lambda turns that
  // into `?open=`.
  it('says which chore the headline is about, in the order the app shows them', () => {
    const both = { stickinessCount: 2, tiebreak: { due: true, count: 4 }, awardYears: [1997] };
    expect(composeMessage(both, digestWith({ count: 2 }), { any: false, newAwardYears: [] }).open).toBe('stickiness');
    const tie = { stickinessCount: 0, tiebreak: { due: true, count: 2 }, awardYears: [1997] };
    expect(composeMessage(tie, digestWith({ count: 0 }), { any: false, newAwardYears: [] }).open).toBe('tiebreak');
    const awards = { stickinessCount: 0, tiebreak: null, awardYears: [1997] };
    expect(composeMessage(awards, digestWith({ count: 0 }), { any: false, newAwardYears: [] }).open).toBe('awards');
  });

  it('names the earliest year, which is the one the app hands you first', () => {
    // yearsMeetingAwardsThreshold sorts ascending and the awards modal works
    // the earliest first, so [0] is the year actually about to be offered.
    const due = { stickinessCount: 0, tiebreak: null, awardYears: [1997, 2004] };
    const message = composeMessage(due, digestWith({ count: 0 }), { any: false, newAwardYears: [] });
    expect(message.title).toBe('1997 needs its personal awards');
  });
});

// Bug, 2026-08-28: "Cinema Roll gave me a push notification this morning
// about some stickiness updates that I needed to do. But then when I clicked
// the notification and arrived in the app, there's no stickiness prompt
// there." The digest reported what was due IN THE DATA; Home.vue also gates
// every prompt behind a per-prompt daily quota, so the push named chores the
// app then refused to display. `eligibleAt` (published per section) is the
// gate, and nothing may be announced before it opens.
describe('quota gates — only promise what the app will actually show', () => {
  const now = NOW

  it('a chore still inside its quota window is not due for notification', () => {
    // The real shape of that morning: tiebreak due in the data, but the
    // on-screen prompt suppressed for another two hours.
    const digest = {
      stickiness: { count: 0, dueTimes: [], eligibleAt: 0 },
      tiebreak: { due: true, count: 2, eligibleAt: now + 2 * HOUR },
      awards: { years: [2009, 2014], eligibleAt: now + 9 * HOUR },
    }
    const due = dueFromDigest(digest, {}, now)
    expect(due.tiebreak).toBeNull()
    expect(due.awardYears).toEqual([])
    expect(shouldSend(baseArgs({ due }))).toMatchObject({ send: false, reason: 'nothing-due' })
  })

  it('once the gate opens, the same chore is announced', () => {
    const digest = {
      stickiness: { count: 0, dueTimes: [], eligibleAt: 0 },
      tiebreak: { due: true, count: 2, eligibleAt: now - 60_000 },
      awards: { years: [], eligibleAt: 0 },
    }
    const due = dueFromDigest(digest, {}, now)
    expect(due.tiebreak).toMatchObject({ count: 2 })
    expect(shouldSend(baseArgs({ due, baseline: EMPTY_BASELINE })).send).toBe(true)
  })

  it('stickiness maturing behind a closed gate is still not announced', () => {
    const digest = {
      // Two boundaries already passed, so the data says two films wait...
      stickiness: { count: 0, dueTimes: [now - 2 * HOUR, now - HOUR], eligibleAt: now + 3 * HOUR },
      tiebreak: { due: false, count: 0, eligibleAt: 0 },
      awards: { years: [], eligibleAt: 0 },
    }
    // ...but the prompt itself is rate-limited, so the push stays quiet.
    expect(dueFromDigest(digest, {}, now).stickinessCount).toBe(0)
  })

  it('a live tournament pins the screen, so nothing else may be promised', () => {
    const digest = {
      stickiness: { count: 9, dueTimes: [], eligibleAt: 0 },
      tiebreak: { due: true, count: 4, eligibleAt: 0, pinned: true },
      awards: { years: [1997], eligibleAt: 0 },
    }
    const due = dueFromDigest(digest, {}, now)
    expect(due.stickinessCount).toBe(0)
    expect(due.awardYears).toEqual([])
    expect(due.tiebreak).toMatchObject({ count: 4 })
  })

  it('a digest with no eligibleAt at all (older client) still works', () => {
    const digest = { stickiness: { count: 3, dueTimes: [] }, tiebreak: { due: false }, awards: { years: [] } }
    expect(dueFromDigest(digest, {}, now).stickinessCount).toBe(3)
  })
})

// "You should have the option in your notifications to turn off the score so
// you see that they watched it, but you don't see their score" (2026-09-06).
describe('friendLogBody', () => {
  const line = 'They gave it a 7.16.';

  it('includes the score by default', () => {
    expect(friendLogBody(line, {})).toBe(line);
    expect(friendLogBody(line, undefined)).toBe(line);
    expect(friendLogBody(line, { friendLogScores: true })).toBe(line);
  });

  it('leaves the score out when the recipient has turned it off', () => {
    expect(friendLogBody(line, { friendLogScores: false })).toBe('Tap to see it in their library.');
  });

  it('has nothing to hide when the rater does not share ratings', () => {
    expect(friendLogBody(null, { friendLogScores: true })).toBe('Tap to see it in their library.');
  });
});

// --- The games reminder (2026-09-07) ----------------------------------------
// "An optional notification, one that defaults to off, but you can turn it
// on, that reminds you to play the games every day, maybe even you can
// choose per game." Off by default, one fixed hour, and it only ever names
// games not yet played that day — in the USER's day, not UTC's.

describe('gamesDue', () => {
  const TZ = 'America/New_York';
  // 18:00Z on Aug 28 is 2pm in New York.
  const games = (overrides = {}) => ({
    games: {
      list: [
        { key: 'wordle', name: 'Reel Wordle', lastPlayedAt: null },
        { key: 'trivia', name: 'Trivia', lastPlayedAt: NOW - 2 * HOUR },
        { key: 'timeline', name: 'Timeline', lastPlayedAt: NOW - 20 * HOUR },
        ...(overrides.extra || [])
      ]
    }
  });

  it('keeps games never played or played before today', () => {
    expect(gamesDue(games(), {}, NOW, TZ).map((g) => g.key)).toEqual(['wordle', 'timeline']);
  });

  it("decides today by the user's clock, not UTC", () => {
    // NOW is 18:00Z. A play 9 hours earlier (09:00Z) is 5am the same day in
    // New York — played today — but 11pm the previous evening in Honolulu,
    // where the game is therefore still waiting.
    const played = { key: 'stamp', name: 'Stamp', lastPlayedAt: NOW - 9 * HOUR };
    expect(gamesDue({ games: { list: [played] } }, {}, NOW, TZ).length).toBe(0);
    expect(gamesDue({ games: { list: [played] } }, {}, NOW, 'Pacific/Honolulu').length).toBe(1);
  });

  it('drops games muted in gamePicks, and nothing else', () => {
    const prefs = { gamePicks: { wordle: false, trivia: true } };
    expect(gamesDue(games(), prefs, NOW, TZ).map((g) => g.key)).toEqual(['timeline']);
  });

  it('is empty for a digest published before the list existed', () => {
    expect(gamesDue({ stickiness: {} }, {}, NOW, TZ)).toEqual([]);
    expect(gamesDue(null, {}, NOW, TZ)).toEqual([]);
  });

  it('formats the local date key', () => {
    expect(localDateKey(TZ, NOW)).toBe('2026-08-28');
    expect(localDateKey('Asia/Tokyo', NOW)).toBe('2026-08-29');
  });
});

describe('shouldSendGames', () => {
  const on = { enabled: true, games: true, gamesHour: 20 };
  const base = { now: NOW, localHour: 20, lastGamesSentAt: NOW - 30 * HOUR, digestUpdatedAt: NOW - 6 * HOUR };

  it('is off by default, and off when notifications are off', () => {
    expect(shouldSendGames({ ...base, prefs: {} }).reason).toBe('games-off');
    expect(shouldSendGames({ ...base, prefs: { games: true, enabled: false } }).reason).toBe('disabled');
  });

  it('sends at the chosen hour, once a day', () => {
    expect(shouldSendGames({ ...base, prefs: on })).toEqual({ send: true, reason: 'games' });
    expect(shouldSendGames({ ...base, prefs: on, localHour: 19 }).reason).toBe('wrong-hour');
    expect(shouldSendGames({ ...base, prefs: on, lastGamesSentAt: NOW - 2 * HOUR }).reason).toBe('too-soon');
    expect(shouldSendGames({ ...base, prefs: { ...on, gamesHour: 9 }, localHour: 9 }).send).toBe(true);
  });

  it('stays quiet while the app is open', () => {
    expect(shouldSendGames({ ...base, prefs: on, digestUpdatedAt: NOW - 5 * 60 * 1000 }).reason).toBe('in-app');
  });
});

describe('composeGamesMessage', () => {
  const g = (key, name) => ({ key, name });

  it('says nothing when every game has been played', () => {
    expect(composeGamesMessage([], 11)).toBeNull();
  });

  it('deep-links a lone game to itself', () => {
    expect(composeGamesMessage([g('wordle', 'Reel Wordle')], 11)).toEqual({
      title: 'Reel Wordle is waiting for you today',
      body: 'Tap to play.',
      navigate: '/games/wordle'
    });
  });

  it('names up to four, then counts the rest, and lands on the hub', () => {
    const all = [g('a', 'Higher or Lower'), g('b', 'Reel Wordle'), g('c', 'Connections'), g('d', 'Six Degrees'), g('e', 'Timeline'), g('f', 'Trivia')];
    expect(composeGamesMessage(all, 6)).toEqual({
      title: "Today's games are waiting",
      body: 'Higher or Lower, Reel Wordle, Connections, Six Degrees and 2 more.',
      navigate: '/games'
    });
    expect(composeGamesMessage(all.slice(0, 3), 6)).toEqual({
      title: '3 games still to play today',
      body: 'Higher or Lower, Reel Wordle and Connections.',
      navigate: '/games'
    });
  });
});

// Matt, report -P1jvQ2VY03wwbsTEwD-: "I don't get notifications when friends
// of mine that are on movie log instead of cinema roll log new movies. They
// show up in my film club, but I don't get a notification like I do if a
// cinema roll user logs a movie." A Cinema Roll friend's own client announces
// the log; an external friend has no client of ours, so the sweep reads their
// feed. The risk of reading a whole library on a timer is a flood, so these
// tests are mostly about the times it must stay quiet.
describe('friends on other apps', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 8, 17, 18, 0, 0);

  const interchangeFeed = (movies) => ({
    format: 'film-club/1',
    source: 'cinemaroll',
    name: 'Brian',
    marker: NOW,
    movieCount: movies.length,
    movies
  });

  it('reads the newest viewing out of an interchange feed, newest first', () => {
    const watches = externalWatches(interchangeFeed([
      { tmdbId: 11, title: 'Alien', rating: 8.5, viewings: [{ watchedAt: NOW - DAY }] },
      { tmdbId: 22, title: 'Heat', rating: 9.1, viewings: [{ watchedAt: NOW - 60000 }, { watchedAt: NOW - 5 * DAY }] }
    ]));
    expect(watches.map((w) => w.title)).toEqual(['Heat', 'Alien']);
    expect(watches[0]).toEqual({ tmdbId: 22, title: 'Heat', watchedAt: NOW - 60000, score: 9.1 });
  });

  // The raw Movie Log shape: nested under movie.tmdb, viewings keyed by date
  // strings, and the id on the record rather than the movie.
  it('reads a raw Movie Log feed too, in either container shape', () => {
    const record = {
      movieId: 33,
      movie: {
        title: 'Ronin',
        tmdb: { id: 33, poster_path: '/x.jpg' },
        viewings: [{ date: '2026-09-16T10:00:00.000Z', rating: 7.25 }]
      }
    };
    const fromArray = externalWatches([record]);
    const fromMap = externalWatches({ '-Nabc': record });
    expect(fromArray).toEqual(fromMap);
    expect(fromArray[0]).toEqual({
      tmdbId: 33,
      title: 'Ronin',
      watchedAt: Date.UTC(2026, 8, 16, 10, 0, 0),
      score: 7.25
    });
  });

  it('ignores junk rather than throwing', () => {
    expect(externalWatches(null)).toEqual([]);
    expect(externalWatches({ format: 'film-club/1', movies: [{ tmdbId: 1, title: 'No viewings' }] })).toEqual([]);
    expect(externalWatches({ nothing: 'useful' })).toEqual([]);
  });

  it('says NOTHING the first time it sees a friend, and records where they were', () => {
    const watches = externalWatches(interchangeFeed([
      { tmdbId: 11, title: 'Alien', rating: 8.5, viewings: [{ watchedAt: NOW - DAY }] }
    ]));
    const due = externalLogsDue({ watches, seenAt: 0, now: NOW });
    expect(due.announce).toEqual([]);
    expect(due.seeded).toBe(true);
    expect(due.nextSeenAt).toBe(NOW - DAY);
  });

  it('announces only what is newer than the marker', () => {
    const watches = externalWatches(interchangeFeed([
      { tmdbId: 11, title: 'Alien', rating: 8.5, viewings: [{ watchedAt: NOW - 3 * DAY }] },
      { tmdbId: 22, title: 'Heat', rating: 9.1, viewings: [{ watchedAt: NOW - 60000 }] }
    ]));
    const due = externalLogsDue({ watches, seenAt: NOW - DAY, now: NOW });
    expect(due.announce.map((w) => w.title)).toEqual(['Heat']);
    expect(due.nextSeenAt).toBe(NOW - 60000);
  });

  it('stays silent when the feed has not moved', () => {
    const watches = externalWatches(interchangeFeed([
      { tmdbId: 22, title: 'Heat', rating: 9.1, viewings: [{ watchedAt: NOW - 60000 }] }
    ]));
    const first = externalLogsDue({ watches, seenAt: NOW - DAY, now: NOW });
    expect(first.announce).toHaveLength(1);
    // The next sweep, fifteen minutes later, same feed.
    const second = externalLogsDue({ watches, seenAt: first.nextSeenAt, now: NOW + 900000 });
    expect(second.announce).toEqual([]);
    expect(second.nextSeenAt).toBe(first.nextSeenAt);
  });

  it('does not announce a backfill, but does absorb it', () => {
    const watches = externalWatches(interchangeFeed([
      { tmdbId: 11, title: 'An old favourite', rating: 8.5, viewings: [{ watchedAt: NOW - 400 * DAY }] }
    ]));
    // Newer than the marker, but far too old to be news.
    const due = externalLogsDue({ watches, seenAt: NOW - 500 * DAY, now: NOW });
    expect(due.announce).toEqual([]);
    expect(due.nextSeenAt).toBe(NOW - 400 * DAY);
  });

  it('caps a burst at three, newest first', () => {
    const watches = externalWatches(interchangeFeed(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
        tmdbId: n,
        title: `Film ${n}`,
        rating: 7,
        viewings: [{ watchedAt: NOW - n * 60000 }]
      }))
    ));
    const due = externalLogsDue({ watches, seenAt: NOW - DAY, now: NOW });
    expect(due.announce.map((w) => w.title)).toEqual(['Film 1', 'Film 2', 'Film 3']);
    // The marker still jumps past ALL of them - the other five are not news later.
    expect(due.nextSeenAt).toBe(NOW - 60000);
  });

  it('reuses friendLogBody, so the recipient still controls the score line', () => {
    const watch = { tmdbId: 22, title: 'Heat', watchedAt: NOW, score: 9.1 };
    const scoreLine = `They gave it a ${watch.score.toFixed(2)}.`;
    expect(friendLogBody(scoreLine, {})).toBe('They gave it a 9.10.');
    expect(friendLogBody(scoreLine, { friendLogScores: false })).toBe('Tap to see it in their library.');
    expect(friendLogBody(null, {})).toBe('Tap to see it in their library.');
  });
});

// Matt, 2026-09-28: "It would be cool if I knew when someone signed up." The
// risk is announcing people who were already here, so the first run is silent.
describe('new sign-ups', () => {
  const NOW = Date.UTC(2026, 8, 28, 15);

  it('says nothing on the first run, and records everyone already here', () => {
    const due = signupsDue({ known: null, current: ['a-gmail-com', 'b-me-com'], now: NOW });
    expect(due.fresh).toEqual([]);
    expect(due.seeded).toBe(true);
    expect(due.nextKnown).toEqual({ 'a-gmail-com': NOW, 'b-me-com': NOW });
  });

  it('announces only accounts it has not seen before', () => {
    const known = { 'a-gmail-com': 1 };
    const due = signupsDue({ known, current: ['a-gmail-com', 'new-person-gmail-com'], now: NOW });
    expect(due.fresh).toEqual(['new-person-gmail-com']);
    expect(due.nextKnown).toEqual({ 'a-gmail-com': 1, 'new-person-gmail-com': NOW });
  });

  it('stays silent when nobody is new', () => {
    const due = signupsDue({ known: { 'a-gmail-com': 1 }, current: ['a-gmail-com'], now: NOW });
    expect(due.fresh).toEqual([]);
    expect(due.seeded).toBe(false);
  });

  it('does not forget an account whose node briefly disappears', () => {
    const known = { 'a-gmail-com': 1, 'b-me-com': 2 };
    const gone = signupsDue({ known, current: ['a-gmail-com'], now: NOW });
    expect(gone.nextKnown).toEqual(known);
    const back = signupsDue({ known: gone.nextKnown, current: ['a-gmail-com', 'b-me-com'], now: NOW });
    expect(back.fresh).toEqual([]);
  });

  it('turns keys from common providers back into readable addresses', () => {
    expect(emailGuessFromKey('jane-doe-gmail-com')).toBe('jane-doe@gmail.com');
    expect(emailGuessFromKey('x7-privaterelay-appleid-com')).toBe('x7@privaterelay.appleid.com');
    expect(emailGuessFromKey('someone-example-org')).toBe('someone-example-org');
  });

  it('writes one notification per sign-up, name first when there is one', () => {
    const messages = composeSignupMessages([
      { key: 'jane-gmail-com', name: 'Jane' },
      { key: 'bob-icloud-com', name: '' }
    ]);
    expect(messages).toEqual([
      { title: 'New Cinema Roll sign-up', body: 'Jane (jane@gmail.com)', tag: 'signup-jane-gmail-com' },
      { title: 'New Cinema Roll sign-up', body: 'bob@icloud.com', tag: 'signup-bob-icloud-com' }
    ]);
  });

  it('collapses a burst into a single summary', () => {
    const fresh = Array.from({ length: SIGNUP_MAX_PER_SWEEP + 1 }, (_, i) => ({ key: `p${i}-gmail-com`, name: '' }));
    const messages = composeSignupMessages(fresh);
    expect(messages).toHaveLength(1);
    expect(messages[0].title).toBe(`${fresh.length} new Cinema Roll sign-ups`);
  });
});

// Matt, 2026-09-28: "notify me when new movies are listed for my local
// Alamo" - the one he keeps refreshing is DC Bryant Street. The feed is
// Alamo's own market schedule; the risks are the same as sign-ups (announce
// the whole board on day one) plus one of their own: a board that drifts.
describe('theater listings', () => {
  const BRYANT = { key: 'alamo-bryant-street', name: 'Alamo Bryant Street', url: 'https://drafthouse.com/dc/theater/dc-bryant-street' };
  const feed = {
    data: {
      presentations: [
        { slug: 'dune-part-three', show: { slug: 'dune-part-three', title: 'Dune: Part Three' }, eventType: null },
        { slug: 'advance-screening-dune-part-three', show: { slug: 'dune-part-three', title: 'Dune: Part Three' }, eventType: { title: 'The Big Show Insider Screening' } },
        { slug: 'halloween-1978', show: { slug: 'halloween-1978', title: 'Halloween (1978)' } },
        { slug: 'crystal-city-only', show: { slug: 'crystal-city-only', title: 'Elsewhere' } }
      ],
      sessions: [
        { cinemaId: '1101', presentationSlug: 'dune-part-three', showTimeClt: '2026-12-18T19:30:00' },
        { cinemaId: '1101', presentationSlug: 'dune-part-three', showTimeClt: '2026-12-17T10:15:00' },
        { cinemaId: '1101', presentationSlug: 'advance-screening-dune-part-three', showTimeClt: '2026-12-15T18:00:00' },
        { cinemaId: '1102', presentationSlug: 'crystal-city-only', showTimeClt: '2026-10-01T18:00:00' },
        { cinemaId: '1101', presentationSlug: 'halloween-1978', showTimeClt: '2026-10-31T21:00:00' }
      ]
    }
  };

  it('keeps only the chosen cinema, one entry per presentation, earliest showing first', () => {
    const listings = alamoListings(feed, '1101');
    expect(listings.map((l) => l.slug)).toEqual(['advance-screening-dune-part-three', 'dune-part-three', 'halloween-1978']);
    expect(listings[1].firstShowTime).toBe('2026-12-17T10:15:00');
    expect(listings[1].url).toBe('https://drafthouse.com/dc/show/dune-part-three');
  });

  it('a special presentation of a film is its own listing, named for what it is', () => {
    const [advance, regular] = alamoListings(feed, '1101');
    expect(advance.title).toBe('Dune: Part Three (The Big Show Insider Screening)');
    expect(regular.title).toBe('Dune: Part Three');
  });

  it('survives an empty or malformed feed', () => {
    expect(alamoListings(null, '1101')).toEqual([]);
    expect(alamoListings({ data: {} }, '1101')).toEqual([]);
    expect(alamoListings({ data: { sessions: [{ cinemaId: '1101', presentationSlug: 'x' }] } }, '1101'))
      .toEqual([{ slug: 'x', title: 'x', firstShowTime: null, url: 'https://drafthouse.com/dc/show/x' }]);
  });

  it('the first run announces nothing and records the whole board', () => {
    const current = alamoListings(feed, '1101');
    const result = listingsDue({ known: null, current, now: NOW });
    expect(result.seeded).toBe(true);
    expect(result.fresh).toEqual([]);
    expect(Object.keys(result.nextKnown).sort()).toEqual(current.map((l) => l.slug));
  });

  it('a listing not on the stored board is news; the rest are not', () => {
    const current = alamoListings(feed, '1101');
    const known = { 'dune-part-three': NOW - HOUR, 'halloween-1978': NOW - HOUR };
    const result = listingsDue({ known, current, now: NOW });
    expect(result.fresh.map((l) => l.slug)).toEqual(['advance-screening-dune-part-three']);
    expect(result.nextKnown['advance-screening-dune-part-three']).toBe(NOW);
    expect(result.nextKnown['dune-part-three']).toBe(NOW);
  });

  it('a listing that drops off the board for one sweep is not news when it returns', () => {
    const known = { 'dune-part-three': NOW - 2 * HOUR };
    const gone = listingsDue({ known, current: [], now: NOW - HOUR });
    expect(gone.nextKnown['dune-part-three']).toBe(NOW - 2 * HOUR);
    const back = listingsDue({ known: gone.nextKnown, current: alamoListings(feed, '1101'), now: NOW });
    expect(back.fresh.map((l) => l.slug)).not.toContain('dune-part-three');
  });

  it('a listing gone for a fortnight is forgotten, so a repertory return is news again', () => {
    const known = { 'halloween-1978': NOW - LISTINGS_FORGET_MS - 1 };
    const forgotten = listingsDue({ known, current: [], now: NOW });
    expect(forgotten.nextKnown).toEqual({});
    const nextYear = listingsDue({ known: forgotten.nextKnown, current: alamoListings(feed, '1101'), now: NOW + HOUR });
    expect(nextYear.fresh.map((l) => l.slug)).toContain('halloween-1978');
  });

  it('formats the cinema\'s local clock without touching the Lambda\'s timezone', () => {
    expect(showTimeLabel('2026-12-15T18:00:00')).toBe('Tue Dec 15, 6:00 PM');
    expect(showTimeLabel('2026-10-31T00:05:00')).toBe('Sat Oct 31, 12:05 AM');
    expect(showTimeLabel('2026-07-04T12:00:00')).toBe('Sat Jul 4, 12:00 PM');
    expect(showTimeLabel(null)).toBe('');
  });

  it('one push per new listing, tapping through to its ticket page, each with its own tag', () => {
    const fresh = alamoListings(feed, '1101').slice(0, 2);
    const messages = composeListingMessages(fresh, BRYANT);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      title: 'New at Alamo Bryant Street',
      body: 'Dune: Part Three (The Big Show Insider Screening) · first showing Tue Dec 15, 6:00 PM',
      tag: 'listing-alamo-bryant-street-advance-screening-dune-part-three',
      navigate: 'https://drafthouse.com/dc/show/advance-screening-dune-part-three'
    });
    expect(messages[1].tag).not.toBe(messages[0].tag);
  });

  it('a burst of listings collapses into one summary that opens the schedule', () => {
    const fresh = Array.from({ length: LISTINGS_MAX_PER_SWEEP + 1 }, (_, i) => ({ slug: `film-${i}`, title: `Film ${i}`, firstShowTime: null, url: `https://drafthouse.com/dc/show/film-${i}` }));
    const messages = composeListingMessages(fresh, BRYANT);
    expect(messages).toHaveLength(1);
    expect(messages[0].title).toBe(`${LISTINGS_MAX_PER_SWEEP + 1} new listings at Alamo Bryant Street`);
    expect(messages[0].body).toBe('Film 0, Film 1, Film 2, Film 3');
    expect(messages[0].navigate).toBe(BRYANT.url);
  });

  it('nothing new means no messages', () => {
    expect(composeListingMessages([], BRYANT)).toEqual([]);
  });
});

// The other three theaters Matt named the same night ("the AFI in Silver
// Spring … the Miracle Theater … a really small independent theater in
// Fairfax" — Cinema Arts). None has a JSON feed; these fixtures are cut
// from the real pages, so a parser that survives them survives the sites.
describe('theater listings — the parsed sites', () => {
  const VEEZI = `
    <div id="sessionsByDateConent"><div class="date"><h3 class="date-title">Friday 2, October</h3>
      <div
        class="film "
        id="" name=""
        ><div class="poster-container"><img class="poster" src="/Media/Poster?siteToken=tok&amp;code=0000002468" alt="Glory" /></div>
        <div><h3 class="title"> Glory </h3><p><span class="censor">R</span></p><div class="sessions"><div class="date-container"><h4 class="date">Friday 2, October</h4>
        <ul class="session-times"><li><a href="https://ticketing.useast.veezi.com/purchase/2907?siteToken=tok"><time>7:00 PM</time></a></li></ul></div></div></div></div></div>
    <div class="date"><h3 class="date-title">Sunday 4, October</h3>
      <div class="film " ><img class="poster" src="/Media/Poster?siteToken=tok&amp;code=0000002468" alt="Glory" /><h3 class="title">Glory</h3>
        <div class="date-container"><h4 class="date">Sunday 4, October</h4><ul class="session-times"><li><a href="https://ticketing.useast.veezi.com/purchase/2908?siteToken=tok"><time>2:00 PM</time></a></li></ul></div></div></div></div>
    <div id="sessionsByFilmConent">
      <div class="film " ><img class="poster" src="/Media/Poster?siteToken=tok&amp;code=0000002470" alt="Selma" /><h3 class="title">Selma &amp; Friends</h3>
        <div class="date-container"><h4 class="date">Friday 6, November</h4><ul class="session-times"><li><a href="https://ticketing.useast.veezi.com/purchase/2910?siteToken=tok"><time>7:00 PM</time></a></li></ul></div>
        <div class="date-container"><h4 class="date">Saturday 7, November</h4><ul class="session-times"><li><a href="https://ticketing.useast.veezi.com/purchase/2911?siteToken=tok"><time>2:00 PM</time></a></li></ul></div></div>
    </div>`;
  const SEPT_28 = new Date('2026-09-28T22:00:00Z').getTime();

  it('a Veezi page yields one film per film code with its earliest showing and a ticket link', () => {
    const listings = veeziListings(VEEZI, { now: SEPT_28 });
    expect(listings).toEqual([
      { slug: '0000002468', title: 'Glory', firstShowTime: '2026-10-02T19:00:00', url: 'https://ticketing.useast.veezi.com/purchase/2907?siteToken=tok' },
      { slug: '0000002470', title: 'Selma & Friends', firstShowTime: '2026-11-06T19:00:00', url: 'https://ticketing.useast.veezi.com/purchase/2910?siteToken=tok' }
    ]);
  });

  it('Veezi dates carry no year: a January date seen in December is next year, yesterday is this year', () => {
    const dec = new Date('2026-12-20T12:00:00Z').getTime();
    expect(veeziDateTime('Friday 8, January', '7:00 PM', dec)).toBe('2027-01-08T19:00:00');
    expect(veeziDateTime('Saturday 19, December', '12:15 AM', dec)).toBe('2026-12-19T00:15:00');
    expect(veeziDateTime('Sunday 4, October', '2:00 PM', SEPT_28)).toBe('2026-10-04T14:00:00');
    expect(veeziDateTime('nonsense', '2:00 PM', SEPT_28)).toBeNull();
  });

  it('an empty Veezi page is an empty board, not a crash', () => {
    expect(veeziListings('', { now: SEPT_28 })).toEqual([]);
    expect(veeziListings('<div class="film "><h3 class="title">No code</h3></div>', { now: SEPT_28 })).toEqual([]);
  });

  const AFI = `
    <section id="now_plying_movies"><div class="container">
      <div class="movie_item "><a href="https://silver.afi.com/movies/detail/0100005647"><div class="img_wrapper"></div></a>
        <div class="item-details" ><h3 class="item-title"> <a href="https://silver.afi.com/movies/detail/0100005647" class="movie-detail">&quot;Fallen Angels&quot; by No&euml;l Coward</a></h3><p>Sparkling…</p></div></div>
      <div class="movie_item "><a href="https://silver.afi.com/movies/detail/0100005662"></a>
        <div class="item-details"><h3 class="item-title"><a href="https://silver.afi.com/movies/detail/0100005662">THE CONDOR DAUGHTER</a></h3></div></div>
      <div class="movie_item "><a href="https://silver.afi.com/movies/detail/0100005662"></a>
        <div class="item-details"><h3 class="item-title"><a href="https://silver.afi.com/movies/detail/0100005662">THE CONDOR DAUGHTER (again)</a></h3></div></div>
    </div></section>`;

  it('AFI Silver: one listing per Vista film id, first title wins, no dates on the page', () => {
    expect(afiListings(AFI)).toEqual([
      { slug: '0100005647', title: '"Fallen Angels" by Noël Coward', firstShowTime: null, url: 'https://silver.afi.com/movies/detail/0100005647' },
      { slug: '0100005662', title: 'THE CONDOR DAUGHTER', firstShowTime: null, url: 'https://silver.afi.com/movies/detail/0100005662' }
    ]);
    expect(afiListings('')).toEqual([]);
  });

  it('Cinema Arts: scheduled ids joined to the static movie list, earliest day first', () => {
    const scheduled = { movieIds: {}, scheduledDays: { 3690: ['2026-10-26'], 327174: ['2026-10-03', '2026-10-02', 'garbage'], 999: ['2026-10-05'] } };
    const movies = { nodes: [{ id: '3690', title: "All the President's Men", path: '/movies/3690-all-the-presidents-men' }, { id: '327174', title: 'Digger', path: '/movies/327174-digger' }] };
    expect(boxofficeListings(scheduled, movies, 'https://www.cinemaartstheatre.com/')).toEqual([
      { slug: '327174', title: 'Digger', firstShowTime: '2026-10-02', url: 'https://www.cinemaartstheatre.com/movies/327174-digger' },
      { slug: '3690', title: "All the President's Men", firstShowTime: '2026-10-26', url: 'https://www.cinemaartstheatre.com/movies/3690-all-the-presidents-men' },
      { slug: '999', title: 'Movie 999', firstShowTime: '2026-10-05', url: 'https://www.cinemaartstheatre.com' }
    ]);
    expect(boxofficeListings(null, null, 'https://x.test')).toEqual([]);
  });

  it('a date-only showing reads "from", a timed one "first showing"', () => {
    expect(showTimeLabel('2026-10-26')).toBe('Mon Oct 26');
    const [dated] = composeListingMessages([{ slug: 'a', title: 'Digger', firstShowTime: '2026-10-02', url: 'u' }], { key: 'k', name: 'Cinema Arts' });
    expect(dated.body).toBe('Digger · from Fri Oct 2');
    const [timed] = composeListingMessages([{ slug: 'a', title: 'Glory', firstShowTime: '2026-10-02T19:00:00', url: 'u' }], { key: 'k', name: 'the Miracle' });
    expect(timed.body).toBe('Glory · first showing Fri Oct 2, 7:00 PM');
    const [bare] = composeListingMessages([{ slug: 'a', title: 'Faust', firstShowTime: null, url: 'u' }], { key: 'k', name: 'AFI Silver' });
    expect(bare.body).toBe('Faust');
  });

  it('decodes the entities these pages actually use', () => {
    expect(decodeEntities('Sabrina &#8211; 1954 &amp; &quot;Glory&quot; &#x27;s &euml;')).toBe('Sabrina – 1954 & "Glory" \'s ë');
  });
});
