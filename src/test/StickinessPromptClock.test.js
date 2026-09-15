import {
  describe, it, expect, vi, beforeEach, afterEach
} from 'vitest';
import { reactive, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';
import {
  stickinessCandidates,
  mostRecentRatingOf,
  nextStickinessDueAt,
  ONE_WEEK_MS,
  SIX_MONTHS_MS
} from '@/assets/javascript/stickinessCandidates.js';

// Bug reports -P1Xo9Blv0-axmB4zrWL (2026-09-15 02:06) and
// -P1_e7pw0t5rtO7vlFj4 (2026-09-15 15:21): "I just got a notification that
// said that District 9 was ready for its stickiness rating. I tapped on that
// notification on my lock screen and opened up Cinema Roll to the home screen
// but did not show me District 9 or any notification on there, any banner
// about stickiness."
//
// Reproduced from production: District 9 was rated 2026-03-17, had already
// answered its one-week prompt, and crossed its SIX-MONTH boundary at
// 15:19:36. The push Lambda swept at 15:20:45 and correctly named it. Matt
// tapped 37 seconds later and the app showed nothing.
//
// Everything downstream was already right — the quota gate was open, no
// tournament was pinning the screen, `?open=stickiness` was read (the URL he
// reported from had already been stripped of it, which is how we know the
// 2026-09-14 warm-launch fix was working). What was wrong is that
// `resultsThatNeedStickiness` was a computed reading `new Date().getTime()`
// with only the entries array as a reactive dependency. Vue does not re-run a
// computed because the wall clock moved, so the warm PWA held the empty list
// it computed before District 9 matured — permanently, short of a cold launch.
//
// These tests move TIME while holding the library still. That is the bug's
// real sequence; a test that also changed the entries would pass against the
// broken code.
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('lodash/debounce', () => ({ default: vi.fn((fn) => fn) }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    const ratings = media?.ratings || [];
    const rating = ratings.reduce((winner, next) => (
      (next?.date && winner?.date && new Date(next.date) > new Date(winner.date)) ? next : winner
    ), ratings[0] || {});
    return { ...rating, calculatedTotal: rating.calculatedTotal ?? 8, normalizedRating: 8 };
  }),
  getAllRatings: vi.fn(() => [])
}));

const film = (id, title, ratings) => ({
  dbKey: `k-${id}`,
  movie: {
    id,
    title,
    release_date: '1999-05-05',
    genres: [{ name: 'Drama' }],
    cast: [],
    crew: [],
    production_companies: [],
    keywords: []
  },
  ratings
});

// District 9's real shape: one rating, week pass already answered, waiting on
// the six-month one. `MATURES_AT` is the instant the app should start asking.
const RATED_AT = new Date('2026-03-17T12:25:00Z').getTime();
const DISTRICT_9 = film(1, 'District 9', [
  { calculatedTotal: 8, date: RATED_AT, userAddedStickiness: true, stickiness: 2 }
]);
const MATURES_AT = RATED_AT + SIX_MONTHS_MS;

const LIBRARY = [DISTRICT_9];

function mountHome ({ now, query = {} } = {}) {
  const store = {
    state: {
      dbLoaded: true,
      databaseTopKey: 'test-user',
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: 'rating',
      academyAwardWinners: { bestPicture: [] },
      settings: {
        normalizationTweak: 0.25,
        tieBreakTweak: 1,
        includeShorts: false,
        tags: { 'viewing-tags': {} },
        // Far in the future so the tiebreak prompt can never win the
        // priority race and mask what stickiness is doing.
        lastTweak: now + SIX_MONTHS_MS
      },
      filteredResults: [],
      homePageScrollPosition: 0,
      homePageSearchChips: [],
      homePageSearchValue: '',
      homePageNumberOfResults: 25,
      homePageNavigationIntent: null,
      homePageSortValue: null,
      homePageSortOrder: null,
      homePagePromoteGroup: null
    },
    getters: {
      allMediaAsArray: LIBRARY, allMoviesAsArray: LIBRARY, allMediaSortedByRating: LIBRARY
    },
    commit: vi.fn(),
    dispatch: vi.fn()
  };

  const route = reactive({ query: { ...query } });
  const router = { push: vi.fn(), replace: vi.fn() };

  const wrapper = mount(Home, {
    global: {
      mocks: { $store: store, $route: route, $router: router },
      stubs: {
        DBGridLayoutSearchResult: true,
        NoResults: true,
        InsetBrowserModal: true
      }
    }
  });

  return { wrapper, route, router };
}

// The card the reports are about, by the class the prompt actually renders.
const stickinessCardShowing = (wrapper) => wrapper.find('.stickiness-inline').exists();

describe('stickinessCandidates (the pure rules)', () => {
  const ratingOf = mostRecentRatingOf;

  it('does not list a film before its six-month boundary', () => {
    const list = stickinessCandidates(LIBRARY, { ratingOf, now: MATURES_AT - 1000 });
    expect(list).toEqual([]);
  });

  it('lists it the moment the boundary passes', () => {
    const list = stickinessCandidates(LIBRARY, { ratingOf, now: MATURES_AT + 1000 });
    expect(list.map((entry) => entry.movie.title)).toEqual(['District 9']);
  });

  it('still asks the one-week question for a film that never answered it', () => {
    const fresh = film(2, 'Vacation', [{ calculatedTotal: 7, date: RATED_AT }]);
    expect(stickinessCandidates([fresh], { ratingOf, now: RATED_AT + ONE_WEEK_MS - 1 })).toEqual([]);
    expect(stickinessCandidates([fresh], { ratingOf, now: RATED_AT + ONE_WEEK_MS + 1 })).toHaveLength(1);
  });

  it('orders the queue most recently rated first', () => {
    const older = film(3, 'Older', [{ date: RATED_AT - 10 * ONE_WEEK_MS }]);
    const newer = film(4, 'Newer', [{ date: RATED_AT - 2 * ONE_WEEK_MS }]);
    const list = stickinessCandidates([older, newer], { ratingOf, now: RATED_AT });
    expect(list.map((entry) => entry.movie.title)).toEqual(['Newer', 'Older']);
  });

  it('judges a rewatch by its latest-DATED rating, not the last in the array', () => {
    // Logged out of order, which the app allows. The push digest used to read
    // the last element here and the prompt the latest date, so the two could
    // disagree about whether this film was waiting at all.
    const outOfOrder = film(5, 'Rewatched', [
      { date: RATED_AT },
      { date: RATED_AT - 10 * ONE_WEEK_MS, userAddedStickiness: true }
    ]);
    expect(mostRecentRatingOf(outOfOrder).date).toBe(RATED_AT);
    expect(stickinessCandidates([outOfOrder], { ratingOf, now: RATED_AT + ONE_WEEK_MS + 1 })).toHaveLength(1);
  });

  it('reports the earliest boundary a film is still waiting on, and only one', () => {
    expect(nextStickinessDueAt(mostRecentRatingOf(DISTRICT_9), RATED_AT)).toBe(MATURES_AT);

    const neither = film(6, 'Both Passes', [{ date: RATED_AT }]);
    expect(nextStickinessDueAt(mostRecentRatingOf(neither), RATED_AT)).toBe(RATED_AT + ONE_WEEK_MS);
  });
});

describe('the stickiness prompt as the clock moves', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows the card when a film matures while the app sits open — library unchanged', async () => {
    vi.setSystemTime(MATURES_AT - 60000);
    const { wrapper } = mountHome({ now: MATURES_AT - 60000 });
    await nextTick();

    expect(wrapper.vm.resultsThatNeedStickiness).toHaveLength(0);
    expect(stickinessCardShowing(wrapper)).toBe(false);

    // Time passes. The library does NOT change — this is a phone left alone.
    vi.setSystemTime(MATURES_AT + 60000);
    await vi.advanceTimersByTimeAsync(300000);
    await nextTick();

    expect(wrapper.vm.resultsThatNeedStickiness.map((e) => e.movie.title)).toEqual(['District 9']);
    expect(stickinessCardShowing(wrapper)).toBe(true);
    // The collapsed banner counts, it doesn't name — the film's title only
    // appears once the form opens (asserted in the notification tests below).
    expect(wrapper.text()).toContain('1 movie is ready for a stickiness score');
  });

  it('catches up the moment the app returns to the foreground', async () => {
    vi.setSystemTime(MATURES_AT - 60000);
    const { wrapper } = mountHome({ now: MATURES_AT - 60000 });
    await nextTick();
    expect(stickinessCardShowing(wrapper)).toBe(false);

    // iOS suspends a backgrounded PWA's timers, so the interval above is not
    // what saves this on a real phone — coming back to the foreground is.
    vi.setSystemTime(MATURES_AT + 60000);
    document.dispatchEvent(new Event('visibilitychange'));
    await nextTick();
    await nextTick();

    expect(stickinessCardShowing(wrapper)).toBe(true);
  });

  it('shows the card on a warm notification tap, with no timer having fired', async () => {
    // The exact reported sequence: the push fires AT the boundary, so the tap
    // arrives seconds later — long before any interval tick would have run.
    vi.setSystemTime(MATURES_AT - 60000);
    const { wrapper, route } = mountHome({ now: MATURES_AT - 60000 });
    await nextTick();
    expect(stickinessCardShowing(wrapper)).toBe(false);

    vi.setSystemTime(MATURES_AT + 37000);
    route.query = { open: 'stickiness' };
    await nextTick();
    await nextTick();
    await nextTick();

    expect(wrapper.vm.openChoreRequested).toBe(true);
    expect(stickinessCardShowing(wrapper)).toBe(true);
    expect(wrapper.text()).toContain('District 9');
  });

  it('opens the rating form itself, not just the banner, on that tap', async () => {
    vi.setSystemTime(MATURES_AT - 60000);
    const { wrapper, route } = mountHome({ now: MATURES_AT - 60000 });
    await nextTick();

    vi.setSystemTime(MATURES_AT + 37000);
    route.query = { open: 'stickiness' };
    await nextTick();
    await nextTick();
    await nextTick();

    // What the notification promises: the thing you can actually do.
    expect(wrapper.find('.stickiness-select').exists()).toBe(true);
  });
});
