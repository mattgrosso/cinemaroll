import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';
import Home from '@/components/Home.vue';
import PersonalAwardsModal from '@/components/PersonalAwardsModal.vue';

// Report 2026-10-11 (Matt): "Sometimes when I load the app, I see a flash of a
// message about an awards year being ready, but then it goes away very
// quickly." Since 2026-10-06 the personal awards load on their own, after the
// settings. In that gap every year looks untouched, so Home offered one, and
// the awards modal saved that wrong year as today's pick — then the awards
// landed, every year was complete, and the notice vanished.
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('lodash/debounce', () => ({ default: vi.fn((fn) => fn) }));
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn(), getLogs: vi.fn(() => []) } }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => {
    const rating = (media?.ratings && media.ratings[0]) || {};
    return { ...rating, calculatedTotal: rating.calculatedTotal ?? 8, normalizedRating: 8 };
  }),
  getAllRatings: vi.fn(() => [])
}));

const DAY = 24 * 60 * 60 * 1000;
const LONG_AGO = Date.now() - 60 * DAY;

const film = (id) => ({
  dbKey: `k-${id}`,
  movie: {
    id,
    title: `Film ${id}`,
    release_date: '1997-06-15',
    runtime: 110,
    genres: [{ name: 'Drama' }],
    cast: [],
    crew: [],
    production_companies: [],
    keywords: [],
    flatKeywords: []
  },
  ratings: [{ calculatedTotal: 8, date: new Date(LONG_AGO).toISOString() }]
});
const LIBRARY = [film(1), film(2), film(3)];

// 1997 done, and done after every film in it was rated.
const COMPLETED_1997 = { 1997: { completed: true, lastUpdated: Date.now() - DAY, categories: {} } };

// What the settings node looks like the moment it lands: everything except
// the awards, which now live apart.
const SETTINGS = {
  awardsYearThreshold: 3,
  normalizationTweak: 0.25,
  tieBreakTweak: 1,
  includeShorts: false,
  tags: { 'viewing-tags': {} },
  lastTweak: 1,
  lastAwardsPromptAt: Date.now() - 2 * DAY
};

function mountHome ({ personalAwardsPending, personalAwards } = {}) {
  const store = reactive({
    state: {
      dbLoaded: true,
      databaseTopKey: 'test-user',
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: 'rating',
      academyAwardWinners: { bestPicture: [] },
      personalAwardsPending,
      settings: { ...SETTINGS, ...(personalAwards ? { personalAwards } : {}) },
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
  });

  const wrapper = mount(Home, {
    global: {
      mocks: { $store: store, $route: { query: {} }, $router: { push: vi.fn() } },
      stubs: {
        DBGridLayoutSearchResult: true,
        NoResults: true,
        StickinessModal: true,
        TweakModal: true,
        InsetBrowserModal: true,
        PersonalAwardsModal: true
      }
    }
  });
  return { wrapper, store };
}

describe('the awards prompt waits for the awards', () => {
  it('stays hidden while the awards are still loading, and stays hidden once every year turns out complete', async () => {
    const { wrapper, store } = mountHome({ personalAwardsPending: true });
    expect(wrapper.vm.shouldShowAwardsModal).toBe(false);

    store.state.settings = { ...store.state.settings, personalAwards: COMPLETED_1997 };
    store.state.personalAwardsPending = false;
    await nextTick();
    expect(wrapper.vm.shouldShowAwardsModal).toBe(false);
  });

  it('still offers a year that really does need work once the awards are in', () => {
    const { wrapper } = mountHome({ personalAwardsPending: false, personalAwards: {} });
    expect(wrapper.vm.shouldShowAwardsModal).toBe(true);
  });
});

describe('the awards notice does not save a pick made before the awards loaded', () => {
  function mountModal () {
    const store = reactive({
      state: {
        settings: { ...SETTINGS },
        settingsLoaded: true,
        personalAwardsPending: true,
        databaseTopKey: 'mattgrosso-gmail-com',
        weights: []
      },
      dispatch: vi.fn(),
      commit: vi.fn()
    });
    const wrapper = mount(PersonalAwardsModal, {
      props: { allEntriesWithFlatKeywordsAdded: LIBRARY, navigateOnOpen: true },
      global: { mocks: { $store: store, $router: { push: vi.fn() } }, stubs: { Modal: true, Teleport: true } }
    });
    return { wrapper, store };
  }

  const dailyWrites = (store) => store.dispatch.mock.calls
    .filter(([action, payload]) => action === 'writeDurably' && payload.path === 'settings/dailyAwardsYear');

  it('writes nothing while loading, and nothing once the year turns out complete', async () => {
    const { wrapper, store } = mountModal();
    expect(dailyWrites(store)).toEqual([]);

    store.state.settings = { ...store.state.settings, personalAwards: COMPLETED_1997 };
    store.state.personalAwardsPending = false;
    await nextTick();
    expect(dailyWrites(store)).toEqual([]);
    expect(wrapper.find('.prompt-card').exists()).toBe(false);
  });

  it('saves the pick once the awards land, when the year really is open', async () => {
    const { store } = mountModal();
    store.state.settings = { ...store.state.settings, personalAwards: {} };
    store.state.personalAwardsPending = false;
    await nextTick();
    expect(dailyWrites(store).map(([, payload]) => payload.value)).toEqual([1997]);
  });
});
