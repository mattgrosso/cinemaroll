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
  composeGamesMessage
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
