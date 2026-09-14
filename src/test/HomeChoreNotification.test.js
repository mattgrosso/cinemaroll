import {
  describe, it, expect, vi
} from 'vitest';
import { reactive, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';

// Bug report -P1VQRMN7zRJIvDzkn_X (2026-09-14): "I just tapped on a
// notification. I think it was a stickiness notification. It brought me to
// the app and then just show me the home screen. There's no indication that
// there actually is a stickiness rating I need to do."
//
// The chore-notification deep link (`?open=<chore>`, added 2026-09-13) was
// read in mounted() only. The push Lambda's navigate URL differs from the
// running app's by nothing but the hash — `.../#/?open=tiebreak` — so an
// installed PWA that is already in memory never reloads: iOS focuses it, the
// hash changes, vue-router routes it in place, and Home does not re-mount.
// Nothing expanded, and the query was never stripped, which is why he filed
// the report from a URL still carrying `?open=tiebreak`.
//
// The existing guards in homeNotices.test.js are source greps, and passed
// against exactly this bug. These mount the thing and move the route.
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

const needsStickiness = (id, title) => ({
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
  ratings: [{ calculatedTotal: 8, date: LONG_AGO }]
});

const LIBRARY = [needsStickiness(1, 'First Film'), needsStickiness(2, 'Second Film')];

function mountHome ({ query = {} } = {}) {
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
        lastTweak: 1
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

  // Reactive on purpose: a warm notification tap changes this object in
  // place, it does not re-create the component.
  const route = reactive({ query: { ...query } });
  const router = { push: vi.fn(), replace: vi.fn() };

  const wrapper = mount(Home, {
    global: {
      mocks: { $store: store, $route: route, $router: router },
      stubs: {
        DBGridLayoutSearchResult: true,
        NoResults: true,
        StickinessModal: true,
        TweakModal: true,
        InsetBrowserModal: true
      }
    }
  });

  return { wrapper, route, router };
}

describe('opening a chore from a notification', () => {
  it('expands the prompt on a cold launch', async () => {
    const { wrapper, router } = mountHome({ query: { open: 'tiebreak' } });
    await nextTick();

    expect(wrapper.vm.openChoreRequested).toBe(true);
    expect(router.replace).toHaveBeenCalledWith({ query: { open: undefined } });
  });

  it('expands the prompt when the app was ALREADY OPEN and only the hash moved', async () => {
    const { wrapper, route, router } = mountHome();
    await nextTick();
    expect(wrapper.vm.openChoreRequested).toBe(false);

    // What iOS actually does with an installed PWA that is already running:
    // focus it and change the hash. No reload, no re-mount.
    route.query = { open: 'tiebreak' };
    await nextTick();
    await nextTick();

    expect(wrapper.vm.openChoreRequested).toBe(true);
    expect(router.replace).toHaveBeenCalledWith({ query: { open: undefined } });
  });

  it('re-fires for a SECOND notification in the same session', async () => {
    const { wrapper, route } = mountHome();
    await nextTick();

    const seen = [];
    wrapper.vm.$watch('openChoreRequested', (value) => seen.push(value));

    route.query = { open: 'tiebreak' };
    await nextTick();
    await nextTick();
    route.query = { open: 'stickiness' };
    await nextTick();
    await nextTick();
    await nextTick();

    // The cards open off a watcher on `autoOpen`. Staying true through the
    // second arrival would hand them no change to react to, so a chore the
    // user had closed would never re-open.
    expect(seen).toEqual([true, false, true]);
    expect(wrapper.vm.openChoreRequested).toBe(true);
  });

  it('ignores a route change that carries no chore', async () => {
    const { wrapper, route, router } = mountHome();
    await nextTick();

    route.query = { revealMovie: 'k-1' };
    await nextTick();
    await nextTick();

    expect(wrapper.vm.openChoreRequested).toBe(false);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
