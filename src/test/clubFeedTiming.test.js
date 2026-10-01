import { describe, it, expect, vi, beforeEach } from 'vitest';
import { dayFeedFrom, dayFeedMarker, dayCopyDue } from '../../aws-lambda/pushCadence.js';
import { toInterchange } from '@/assets/javascript/interchange.js';

// "When we set up the right away versus end of day toggle for people getting
// notifications about my watches, you'd asked, should we do that for external
// users as well? ... I would like it more if they all looked the same on my
// page" (Matt, 2026-10-01). Movie Log friends all read one public feed, so
// End of day is one switch for all of them: the live feed is parked at
// social/clubFeedLive and the push Lambda publishes this copy.

vi.mock('axios');
vi.mock('@sentry/vue');
vi.mock('@/router', () => ({ default: { push: vi.fn() } }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((entry) => ({ calculatedTotal: entry?.ratings?.[0]?.calculatedTotal ?? 0 }))
}));

const calls = [];
vi.mock('firebase/database', () => ({
  serverTimestamp: () => ({ '.sv': 'timestamp' }),
  getDatabase: vi.fn(() => ({})),
  ref: vi.fn((db, path) => path),
  onValue: vi.fn(),
  set: vi.fn((path, value) => { calls.push(['set', path, value]); return Promise.resolve(); }),
  update: vi.fn((path, value) => { calls.push(['update', path, value]); return Promise.resolve(); }),
  query: vi.fn(),
  orderByChild: vi.fn(),
  startAt: vi.fn(),
  get: vi.fn(() => Promise.resolve({ val: () => null }))
}));
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(() => ({})) }));

const TZ = 'America/New_York';
// Wall-clock time in New York, early October (EDT, UTC-4).
const ny = (month, day, hour, minute = 0) => Date.UTC(2026, month - 1, day, hour + 4, minute);
const noonUtc = (month, day) => Date.UTC(2026, month - 1, day, 12);

const CUTOFF = ny(10, 1, 0);            // this morning's midnight
const HEAT = ny(10, 1, 14);             // first watch, this afternoon
const TENET_TODAY = ny(10, 1, 10);      // a rewatch this morning...
const TENET_BEFORE = ny(9, 20, 21, 30); // ...of a film first seen on the 20th
const ALIEN = ny(9, 30, 23, 30);        // last night, before midnight

const entry = (id, title, rating, viewings) => ({
  movie: { id, title, poster_path: `/${id}.jpg`, release_date: '1995-06-15' },
  ratings: viewings.map(([date, medium], index) => ({ date, medium, calculatedTotal: index === 0 ? rating : 0 }))
});

function liveFeed () {
  return toInterchange([
    entry(1, 'Heat', 9, [[HEAT]]),
    entry(2, 'Tenet', 8, [[TENET_TODAY, 'Theater'], [TENET_BEFORE, 'Blu-ray']]),
    entry(3, 'Alien', 7, [[ALIEN]])
  ], (item) => ({ calculatedTotal: item.ratings[0].calculatedTotal }), { name: 'Matt', now: ny(10, 1, 14, 5) });
}

describe('the end-of-day Interchange feed', () => {
  it('leaves out a film first watched today', () => {
    const copy = dayFeedFrom(liveFeed(), { cutoff: CUTOFF, tz: TZ, marker: CUTOFF });
    expect(copy.movies.map((movie) => movie.title)).toEqual(['Tenet', 'Alien']);
    expect(copy.movieCount).toBe(2);
  });

  it('keeps a rewatch at its previous viewing', () => {
    const tenet = dayFeedFrom(liveFeed(), { cutoff: CUTOFF, tz: TZ, marker: CUTOFF }).movies.find((movie) => movie.tmdbId === 2);
    expect(tenet.viewings).toEqual([{ watchedAt: noonUtc(9, 20), medium: 'Blu-ray' }]);
  });

  it('turns every time into a date: last night at 11:30 is just the 30th', () => {
    const copy = dayFeedFrom(liveFeed(), { cutoff: CUTOFF, tz: TZ, marker: CUTOFF });
    const stamps = copy.movies.flatMap((movie) => movie.viewings.map((viewing) => viewing.watchedAt));
    expect(stamps).toEqual([noonUtc(9, 20), noonUtc(9, 30)]);
    expect(copy.dayOnly).toBe(true);
  });

  it('carries the marker it is given, not the live feed\'s publish time', () => {
    const live = liveFeed();
    expect(dayFeedFrom(live, { cutoff: CUTOFF, tz: TZ, marker: CUTOFF }).marker).toBe(CUTOFF);
    expect(live.marker).toBe(ny(10, 1, 14, 5));
  });

  it('releases everything once the next midnight passes', () => {
    const tomorrow = ny(10, 2, 0);
    const copy = dayFeedFrom(liveFeed(), { cutoff: tomorrow, tz: TZ, marker: tomorrow });
    expect(copy.movies.map((movie) => movie.title)).toEqual(['Heat', 'Tenet', 'Alien']);
    expect(copy.movies[0].viewings).toEqual([{ watchedAt: noonUtc(10, 1) }]);
  });

  it('leaves the live feed alone', () => {
    const live = liveFeed();
    const before = JSON.stringify(live);
    dayFeedFrom(live, { cutoff: CUTOFF, tz: TZ, marker: CUTOFF });
    expect(JSON.stringify(live)).toBe(before);
  });

  it('refuses something that is not a feed', () => {
    expect(dayFeedFrom(null, { cutoff: CUTOFF, tz: TZ, marker: CUTOFF })).toBe(null);
    expect(dayFeedFrom({ name: 'x' }, { cutoff: CUTOFF, tz: TZ, marker: CUTOFF })).toBe(null);
  });
});

describe('when the sweep rebuilds the public copy', () => {
  it('rebuilds at midnight and when the app republishes, and not otherwise', () => {
    const release = { cutoff: CUTOFF, source: 111, marker: CUTOFF };
    expect(dayCopyDue({ release: null, cutoff: CUTOFF, source: 111 }).rebuild).toBe(true);
    expect(dayCopyDue({ release, cutoff: CUTOFF, source: 111 }).rebuild).toBe(false);
    expect(dayCopyDue({ release, cutoff: CUTOFF, source: 222 }).rebuild).toBe(true);
    expect(dayCopyDue({ release, cutoff: ny(10, 2, 0), source: 111 }).rebuild).toBe(true);
  });

  it('marks a new day with its midnight, and a same-day rebuild one past the last', () => {
    expect(dayFeedMarker(null, CUTOFF)).toBe(CUTOFF);
    expect(dayFeedMarker({ cutoff: CUTOFF, marker: CUTOFF }, CUTOFF)).toBe(CUTOFF + 1);
    expect(dayFeedMarker({ cutoff: CUTOFF, marker: CUTOFF + 1 }, ny(10, 2, 0))).toBe(ny(10, 2, 0));
  });
});

describe('publishing the feed', () => {
  let store;
  const SECRET = '0123456789abcdef0123456789abcdef';

  beforeEach(async () => {
    calls.length = 0;
    vi.resetModules();
    store = (await import('@/store/index.js')).default;
    store.commit('setDatabaseTopKey', 'matt-example-com');
    store.commit('setMovieLog', { a: entry(3, 'Alien', 7, [[ALIEN]]) });
    store.commit('setDbLoaded', true);
  });

  it('right away: the public feed, and nothing parked', async () => {
    store.commit('setSettings', { clubFeedKey: SECRET });
    await store.dispatch('publishClubFeed');
    expect(calls.map(([kind, path, value]) => [kind, path, value === null ? null : 'feed'])).toEqual([
      ['set', 'social/clubFeedLive/matt-example-com', null],
      ['set', `clubFeed/matt-example-com/${SECRET}`, 'feed']
    ]);
    expect(calls[1][2].movies[0].viewings[0].watchedAt).toBe(ALIEN);
  });

  it('end of day: parks the live feed privately and never touches the public one', async () => {
    store.commit('setSettings', { clubFeedKey: SECRET, clubFeedTiming: 'day' });
    await store.dispatch('publishClubFeed');
    expect(calls).toHaveLength(1);
    const [kind, path, value] = calls[0];
    expect([kind, path]).toEqual(['update', 'social/clubFeedLive/matt-example-com']);
    expect(value.secret).toBe(SECRET);
    expect(typeof value.tz).toBe('string');
    expect(value.feed.movies[0].title).toBe('Alien');
  });
});
