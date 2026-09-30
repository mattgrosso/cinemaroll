import { describe, it, expect } from 'vitest';
import {
  DAY_FRIEND,
  localDayStart,
  nextLocalMidnight,
  dayProfileFrom,
  dayFriendsByOwner,
  dayCopyDue,
  dayNews,
  composeDayMessage
} from '../../aws-lambda/pushCadence.js';
import { countNewFriendUpdates, friendSnapshot } from '../assets/javascript/social.js';

// End-of-day friends (2026-09-30): "people at work who use this, who I would
// rather not see exactly when I watch a movie". The live profile is off
// limits to them (database rules); they read the copy built here.

const TZ = 'America/New_York';
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
// Wall-clock time in New York, late September (EDT, UTC-4).
const ny = (month, day, hour, minute = 0) => Date.UTC(2026, month - 1, day, hour + 4, minute);
const noonUtc = (month, day) => Date.UTC(2026, month - 1, day, 12);

const NOW = ny(9, 30, 15);            // 3pm on Sep 30
const CUTOFF = ny(9, 30, 0);          // that morning's midnight

const HEAT = ny(9, 30, 14);           // first watch, this afternoon
const TENET_TODAY = ny(9, 30, 10);    // a rewatch this morning...
const TENET_BEFORE = ny(9, 20, 21, 30); // ...of a film first seen on the 20th
const ALIEN = ny(9, 29, 23, 30);      // last night, before midnight

function liveProfile ({ withRatings = true } = {}) {
  const profile = {
    name: 'Matt',
    updatedAt: ny(9, 30, 14, 5),
    counts: { titles: 3, viewings: 4 },
    topShelf: [
      { id: 1, t: 'Heat', p: '/heat.jpg', r: 9 },
      { id: 2, t: 'Tenet', p: '/tenet.jpg', r: 8 },
      { id: 3, t: 'Alien', p: '/alien.jpg', r: 7 }
    ],
    crown: { t: 'Heat', p: '/heat.jpg', r: 9, year: 1995 },
    recent: [
      { id: 1, t: 'Heat', p: '/heat.jpg', r: 9, at: HEAT, s: 4.5 },
      { id: 2, t: 'Tenet', p: '/tenet.jpg', r: 8, at: TENET_TODAY, m: 'Theater' },
      { id: 3, t: 'Alien', p: '/alien.jpg', r: 7, at: ALIEN }
    ]
  };
  if (withRatings) {
    profile.ratings = {
      1: { r: 9, at: HEAT, t: 'Heat', p: '/heat.jpg', v: [{ at: HEAT }] },
      2: { r: 8, at: TENET_TODAY, t: 'Tenet', p: '/tenet.jpg', v: [{ at: TENET_TODAY, m: 'Theater' }, { at: TENET_BEFORE, m: 'Blu-ray' }] },
      3: { r: 7, at: ALIEN, t: 'Alien', p: '/alien.jpg', v: [{ at: ALIEN }] }
    };
  }
  return profile;
}

// Every `at` anywhere in the copy, however deep.
function allStamps (value, out = []) {
  if (Array.isArray(value)) value.forEach((item) => allStamps(item, out));
  else if (value && typeof value === 'object') {
    Object.entries(value).forEach(([key, inner]) => {
      if (key === 'at') out.push(inner);
      else allStamps(inner, out);
    });
  }
  return out;
}

describe('the owner\'s midnight', () => {
  it('is local midnight, not UTC', () => {
    expect(localDayStart(TZ, NOW)).toBe(CUTOFF);
    // 11:30pm local is already the next day in UTC; still the same local day.
    expect(localDayStart(TZ, ALIEN)).toBe(ny(9, 29, 0));
  });

  it('survives a DST change between midnight and now', () => {
    // Nov 1 2026: clocks fall back at 2am, so midnight was still EDT.
    expect(localDayStart(TZ, Date.UTC(2026, 10, 1, 20))).toBe(Date.UTC(2026, 10, 1, 4));
    expect(nextLocalMidnight(TZ, Date.UTC(2026, 9, 31, 20))).toBe(Date.UTC(2026, 10, 1, 4));
  });
});

describe('dayProfileFrom', () => {
  const copy = dayProfileFrom(liveProfile(), { cutoff: CUTOFF, tz: TZ });

  it('withholds a film first watched today, everywhere it could show', () => {
    expect(copy.recent.map((item) => item.id)).not.toContain(1);
    expect(copy.ratings['1']).toBeUndefined();
    expect(copy.topShelf.map((item) => item.id)).toEqual([2, 3]);
    expect(copy.crown).toBeNull();
    expect(copy.counts).toEqual({ titles: 2, viewings: 2 });
  });

  it('shows a rewatch from today as its previous viewing', () => {
    const tenet = copy.recent.find((item) => item.id === 2);
    expect(tenet.at).toBe(noonUtc(9, 20));
    expect(tenet.m).toBe('Blu-ray');
    expect(copy.ratings['2'].at).toBe(noonUtc(9, 20));
    expect(copy.ratings['2'].v).toEqual([{ at: noonUtc(9, 20), m: 'Blu-ray' }]);
  });

  it('keeps last night, dated by the OWNER\'s calendar', () => {
    const alien = copy.recent.find((item) => item.id === 3);
    // 11:30pm on the 29th in New York is the 30th in UTC.
    expect(alien.at).toBe(noonUtc(9, 29));
    expect(alien.d).toBe(1);
    expect(alien.pub).toBe(CUTOFF);
    expect(copy.recent.map((item) => item.id)).toEqual([3, 2]);
  });

  it('carries no time of day anywhere', () => {
    const stamps = allStamps(copy);
    expect(stamps.length).toBeGreaterThan(3);
    stamps.forEach((at) => expect(at % DAY).toBe(12 * HOUR));
    expect(copy.updatedAt).toBeLessThanOrEqual(CUTOFF);
    expect(copy.dayOnly).toBe(true);
  });

  it('works for a shelf-only sharer, who publishes no ratings map', () => {
    const shelf = dayProfileFrom(liveProfile({ withRatings: false }), { cutoff: CUTOFF, tz: TZ });
    expect(shelf.ratings).toBeUndefined();
    // With no per-viewing list the rewatch can't be re-dated, so it waits too.
    expect(shelf.recent.map((item) => item.id)).toEqual([3]);
    expect(shelf.counts).toEqual({ titles: 1, viewings: 2 });
  });

  it('feeds the Film Club row a day, and the badge its release time', () => {
    const snapshot = friendSnapshot(new Map(), copy);
    expect(snapshot.lastWatchedDayOnly).toBe(true);
    // Opened at 11pm last night: Alien's date is earlier than that, but it
    // was released at midnight, so it is still new.
    expect(countNewFriendUpdates({ matt: copy }, ny(9, 29, 23))).toBe(1);
    expect(countNewFriendUpdates({ matt: copy }, CUTOFF + HOUR)).toBe(0);
  });
});

describe('who shares at the end of the day', () => {
  it('counts only mutual friends on a day edge', () => {
    const edges = {
      matt: { coworker: DAY_FRIEND, pal: true, pending: DAY_FRIEND },
      coworker: { matt: true },
      pal: { matt: true }
    };
    expect(dayFriendsByOwner(edges)).toEqual({ matt: ['coworker'] });
    expect(dayFriendsByOwner(null)).toEqual({});
  });
});

describe('dayCopyDue', () => {
  it('seeds silently, then rebuilds on a new day or a republish', () => {
    expect(dayCopyDue({ release: null, cutoff: CUTOFF, source: 5 })).toEqual({ rebuild: true, announce: false });
    expect(dayCopyDue({ release: { cutoff: CUTOFF, source: 5 }, cutoff: CUTOFF, source: 5 })).toEqual({ rebuild: false, announce: false });
    expect(dayCopyDue({ release: { cutoff: CUTOFF, source: 5 }, cutoff: CUTOFF, source: 6 }).rebuild).toBe(true);
    expect(dayCopyDue({ release: { cutoff: CUTOFF - DAY, source: 5 }, cutoff: CUTOFF, source: 5 })).toEqual({ rebuild: true, announce: true });
  });
});

describe('the midnight push', () => {
  it('announces what the new copy shows that the old one did not', () => {
    const afternoon = dayProfileFrom(liveProfile(), { cutoff: CUTOFF, tz: TZ });
    const midnight = ny(10, 1, 0, 5);
    const released = dayProfileFrom(liveProfile(), { cutoff: localDayStart(TZ, midnight), tz: TZ });
    const news = dayNews(afternoon.recent, released.recent, { since: CUTOFF - 7 * DAY });
    // Tenet counts: the rewatch is news even though the film was already there.
    expect(news.map((item) => item.t)).toEqual(['Tenet', 'Heat']);
    expect(dayNews(released.recent, released.recent)).toEqual([]);
  });

  it('ignores anything older than the window', () => {
    const next = [{ id: 9, t: 'Old', at: noonUtc(8, 1), pub: noonUtc(8, 2) }];
    expect(dayNews([], next, { since: CUTOFF - 7 * DAY })).toEqual([]);
  });

  it('names one film, or lists several', () => {
    expect(composeDayMessage('Matt', [{ id: 1, t: 'Heat' }])).toEqual({
      title: 'Matt logged Heat',
      body: 'Tap to see it in their library.',
      navigate: '/movie/1'
    });
    const three = composeDayMessage('Matt', ['Heat', 'Tenet', 'Alien'].map((t, i) => ({ id: i, t })));
    expect(three.title).toBe('Matt logged 3 films');
    expect(three.body).toBe('Heat, Tenet and Alien.');
    expect(three.navigate).toBe('/film-club');
    const six = composeDayMessage('Matt', 'ABCDEF'.split('').map((t, i) => ({ id: i, t })));
    expect(six.body).toBe('A, B, C, D and 2 more.');
    expect(composeDayMessage('Matt', [])).toBeNull();
  });
});

// The wiring, at source level: the two places a 'day' edge must change what
// happens. Neither is reachable from a unit test without Firebase.
describe('the wiring', async () => {
  const { readFileSync } = await import('node:fs');
  const lambda = readFileSync('aws-lambda/push-notify.js', 'utf8');
  const store = readFileSync('src/store/index.js', 'utf8');

  it('leaves end-of-day friends out of the instant friend-log push', () => {
    const fanOut = lambda.slice(lambda.indexOf('const notifyFriendsOfLog'), lambda.indexOf('// --- End-of-day friends'));
    expect(fanOut).toContain('edges[myKey][key] !== DAY_FRIEND');
  });

  it('runs the end-of-day release on every sweep', () => {
    const sweep = lambda.slice(lambda.indexOf('const runSweep'), lambda.indexOf('// --- New sign-ups'));
    expect(sweep).toContain('releaseDayProfiles(now)');
  });

  it('reads the end-of-day copy of a friend who shares that way with me', () => {
    const fetch = store.slice(store.indexOf('async fetchFriendProfiles'));
    expect(fetch).toMatch(/socialEdges\?\.\[key\]\?\.\[me\] === 'day' \? 'dayProfiles' : 'profiles'/);
  });
});
