import {
  describe, it, expect, vi
} from 'vitest';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';

// Bug report, 2026-08-19: "Sometimes the prompt on the home screen will tell me
// that I need to do some tiebreakers and then as soon as I choose the first one
// in the tournament, it hides itself, and then the prompt turns into a
// stickiness rating instead of a tiebreaker rating and then once I do the
// stickiness resume the tournament it's awkward like this."
//
// Matt named both acceptable outcomes and both are covered here: a tiebreak
// must not take the screen when stickiness is also waiting, AND a tournament
// already under way must not be interrupted by one.
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('lodash/debounce', () => ({ default: vi.fn((fn) => fn) }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    const rating = (media?.ratings && media.ratings[0]) || {};
    return { ...rating, calculatedTotal: rating.calculatedTotal ?? 8, normalizedRating: 8 };
  }),
  getAllRatings: vi.fn(() => [])
}));

const LONG_AGO = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();

// Rated long enough ago, with no stickiness recorded, so it is waiting for a
// stickiness pass. Equal scores so the pair is also a tie.
const needsStickiness = (id, title, calculatedTotal) => ({
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
  ratings: [{ calculatedTotal, date: LONG_AGO }]
});

const LIBRARY = [
  needsStickiness(1, 'First Film', 8),
  needsStickiness(2, 'Second Film', 8),
  needsStickiness(3, 'Third Film', 8)
];

function mountHome ({ library = LIBRARY, settings = {} } = {}) {
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
        // Long past, so a tiebreak is due. NOT 0: the app reads lastTweak
        // with `|| Date.now()`, so a falsy 0 means "just now" and nothing is
        // ever due.
        lastTweak: 1,
        ...settings
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
      allMediaAsArray: library, allMoviesAsArray: library, allMediaSortedByRating: library
    },
    commit: vi.fn(),
    dispatch: vi.fn()
  };

  return mount(Home, {
    global: {
      mocks: { $store: store, $route: { query: {} }, $router: { push: vi.fn() } },
      stubs: {
        DBGridLayoutSearchResult: true,
        NoResults: true,
        StickinessModal: true,
        TweakModal: true,
        InsetBrowserModal: true
      }
    }
  });
}

describe('which prompt the home screen shows', () => {
  it('shows stickiness, not a tiebreak, when both are waiting', () => {
    // Every film here is both tied AND overdue for stickiness.
    const wrapper = mountHome();

    expect(wrapper.vm.resultsThatNeedStickiness.length).toBeGreaterThan(0);
    expect(wrapper.vm.shouldShowTieBreakModal).toBe(true);
    expect(wrapper.vm.activeModalType).toBe('stickiness');
  });

  it('decides nothing at all until the library has actually loaded', () => {
    // The flip's real cause. A tournament record arrives from settings before
    // the library does; with no entries, stickiness cannot be detected, so a
    // tiebreak used to win a race it would lose a moment later. An empty
    // library on its own proves nothing — there is no tie to find either —
    // so the record has to be present for this to mean anything.
    const wrapper = mountHome({
      library: [],
      settings: {
        tieBreakTournament: {
          contestantIds: ['k-1', 'k-2'],
          schedule: [{ a: 'k-1', b: 'k-2' }],
          nextIndex: 0,
          wins: { 'k-1': 0, 'k-2': 0 },
          matchResults: [],
          finalRanking: null,
          completedAt: null
        }
      }
    });

    expect(wrapper.vm.shouldShowTieBreakModal).toBe(true);
    expect(wrapper.vm.activeModalType).toBe(null);
  });

  it('keeps a tournament already under way, even once stickiness is waiting', () => {
    const wrapper = mountHome({
      settings: {
        tieBreakTournament: {
          contestantIds: ['k-1', 'k-2', 'k-3'],
          schedule: [{ a: 'k-1', b: 'k-2' }, { a: 'k-1', b: 'k-3' }, { a: 'k-2', b: 'k-3' }],
          nextIndex: 1,
          wins: { 'k-1': 1, 'k-2': 0, 'k-3': 0 },
          matchResults: [{ a: 'k-1', b: 'k-2', winnerId: 'k-1' }],
          finalRanking: null,
          completedAt: null
        }
      }
    });

    // Stickiness is genuinely waiting and still does not get the screen.
    expect(wrapper.vm.resultsThatNeedStickiness.length).toBeGreaterThan(0);
    expect(wrapper.vm.activeModalType).toBe('tieBreak');
  });

  it('lets stickiness through again once the tournament record is gone', () => {
    const wrapper = mountHome({ settings: { tieBreakTournament: null } });

    expect(wrapper.vm.activeModalType).toBe('stickiness');
  });

  it('still respects a deliberately disabled tiebreak prompt', () => {
    // Pinning an in-progress tournament must not override an explicit "off".
    const wrapper = mountHome({
      settings: {
        tieBreakPromptState: 'disabled',
        tieBreakTournament: {
          contestantIds: ['k-1', 'k-2'],
          schedule: [{ a: 'k-1', b: 'k-2' }],
          nextIndex: 0,
          wins: { 'k-1': 0, 'k-2': 0 },
          matchResults: [],
          finalRanking: null,
          completedAt: null
        }
      }
    });

    expect(wrapper.vm.activeModalType).not.toBe('tieBreak');
  });

  // Bug report 2026-10-01: "I'm still seeing shorts tied in tiebreakers,
  // which feels like they should be excluded from that if I have shorts
  // turned off."
  describe('with short films turned off', () => {
    const short = (id, title, calculatedTotal) => {
      const entry = needsStickiness(id, title, calculatedTotal);
      return { ...entry, movie: { ...entry.movie, runtime: 12 } };
    };
    const feature = (id, title, calculatedTotal) => {
      const entry = needsStickiness(id, title, calculatedTotal);
      return { ...entry, movie: { ...entry.movie, runtime: 120 } };
    };

    it('does not call a tie made only of shorts a tie', () => {
      const library = [feature(1, 'Feature', 9), short(2, 'Short A', 7), short(3, 'Short B', 7)];
      expect(mountHome({ library }).vm.shouldShowTieBreakModal).toBe(false);
    });

    it('still finds the tie when shorts are on', () => {
      const library = [feature(1, 'Feature', 9), short(2, 'Short A', 7), short(3, 'Short B', 7)];
      expect(mountHome({ library, settings: { includeShorts: true } }).vm.shouldShowTieBreakModal).toBe(true);
    });

    it('does not let a tournament holding a short pin the screen', () => {
      const library = [short(1, 'Short A', 8), feature(2, 'Feature B', 8), feature(3, 'Feature C', 6)];
      const wrapper = mountHome({
        library,
        settings: {
          tieBreakTournament: {
            contestantIds: ['k-1', 'k-2'],
            schedule: [{ a: 'k-1', b: 'k-2' }],
            nextIndex: 0,
            wins: { 'k-1': 0, 'k-2': 0 },
            matchResults: [],
            finalRanking: null,
            completedAt: null
          }
        }
      });
      expect(wrapper.vm.activeModalType).toBe('stickiness');
    });
  });
});
