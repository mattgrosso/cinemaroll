import {
  describe, it, expect, vi
} from 'vitest';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';

// Bug report, 2026-10-06: "When cinema roll has a badge icon on it ... there's
// nothing on the home screen that guides me to where I need to go ... mostly
// it's showtimes that seems to cause the trouble." Home now carries a
// Showtimes card whenever the icon badge is counting Showtimes films, with
// the badge's own number (store getter showtimesBadgeCount, pinned to the
// badge in showtimesBadgeStore.test.js).
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('lodash/debounce', () => ({ default: vi.fn((fn) => fn) }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 8, normalizedRating: 8 })),
  getAllRatings: vi.fn(() => [])
}));

const ME = 'mattgrosso-gmail-com';
const library = [{
  dbKey: 'k-1',
  movie: { id: 1, title: 'A Film', release_date: '1999-05-05', genres: [], cast: [], crew: [], production_companies: [], keywords: [] },
  ratings: [{ calculatedTotal: 8, date: '2023-01-01' }]
}];

function mountHome (showtimesBadgeCount) {
  const push = vi.fn();
  const store = {
    state: {
      dbLoaded: true,
      databaseTopKey: ME,
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: 'rating',
      academyAwardWinners: { bestPicture: [] },
      settings: { normalizationTweak: 0.25, tieBreakTweak: 1, includeShorts: false, tags: { 'viewing-tags': {} } },
      filteredResults: [],
      socialRequests: {},
      socialEdges: {},
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
      allMediaAsArray: library,
      allMoviesAsArray: library,
      allMediaSortedByRating: library,
      socialUserKey: ME,
      showtimesBadgeCount
    },
    commit: vi.fn(),
    dispatch: vi.fn()
  };
  const wrapper = mount(Home, {
    global: {
      mocks: { $store: store, $route: { query: {} }, $router: { push } },
      stubs: { DBGridLayoutSearchResult: true, NoResults: true, StickinessModal: true, TweakModal: true, InsetBrowserModal: true }
    }
  });
  return { wrapper, push };
}

const card = (wrapper) => wrapper.find('.showtimes-prompt');

describe('the Showtimes card on Home', () => {
  it('says how many films the badge is counting, and taps through to Showtimes', async () => {
    const { wrapper, push } = mountHome(3);
    expect(card(wrapper).exists()).toBe(true);
    expect(card(wrapper).text()).toContain('3 films at your theaters');
    await card(wrapper).trigger('click');
    expect(push).toHaveBeenCalledWith('/showtimes');
  });

  it('says "1 film" for one', () => {
    const { wrapper } = mountHome(1);
    expect(card(wrapper).text()).toContain('1 film at your theaters is waiting');
  });

  it('stays away when the badge counts no Showtimes films', () => {
    const { wrapper } = mountHome(0);
    expect(card(wrapper).exists()).toBe(false);
  });
});
