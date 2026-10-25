import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';
import {
  NOTICE_ORDER, pickNotice, dismissNotice, isNoticeDismissed, clearChoreDismissals, NOTICE_DISMISSALS_KEY
} from '@/assets/javascript/homeNotices.js';

// Report 2026-10-25: "I don't like having like three banners all stacked on
// top of each other." Home shows ONE notice, ranked by homeNotices.js; its X
// puts it away for today and the next one in line shows.

const NOON = new Date(2026, 9, 25, 12).getTime();
const TOMORROW = new Date(2026, 9, 26, 9).getTime();

describe('picking the one notice', () => {
  it('follows the agreed order', () => {
    expect(NOTICE_ORDER).toEqual(['friendRequest', 'reconcile', 'update', 'bugFix', 'showtimes', 'newsletter', 'stickiness', 'tieBreak', 'awards']);
    expect(pickNotice({ showtimes: 2, bugFix: 'a', stickiness: 'stickiness' }, {}, NOON)).toBe('bugFix');
    expect(pickNotice({ update: null, newsletter: '2026-W43' }, {}, NOON)).toBe('newsletter');
    expect(pickNotice({}, {}, NOON)).toBeNull();
  });

  it('skips a dismissed notice, and brings it back tomorrow', () => {
    const dismissed = dismissNotice({}, 'bugFix', 'a', NOON);
    expect(pickNotice({ bugFix: 'a', showtimes: 2 }, dismissed, NOON)).toBe('showtimes');
    expect(pickNotice({ bugFix: 'a', showtimes: 2 }, dismissed, TOMORROW)).toBe('bugFix');
  });

  it('brings it back the same day when there is something new to say', () => {
    const dismissed = dismissNotice({}, 'bugFix', 'a', NOON);
    expect(isNoticeDismissed(dismissed, 'bugFix', 'a,b', NOON)).toBe(false);
  });

  it('treats a count as news only when it grows', () => {
    const dismissed = dismissNotice({}, 'showtimes', 3, NOON);
    expect(isNoticeDismissed(dismissed, 'showtimes', 2, NOON)).toBe(true);
    expect(isNoticeDismissed(dismissed, 'showtimes', 3, NOON)).toBe(true);
    expect(isNoticeDismissed(dismissed, 'showtimes', 4, NOON)).toBe(false);
  });

  it('drops old days on the way and lets a chore notification clear the chores', () => {
    const yesterday = dismissNotice({}, 'newsletter', 'w', NOON - 24 * 3600 * 1000);
    const today = dismissNotice(dismissNotice(yesterday, 'tieBreak', 'tieBreak', NOON), 'update', 'v2', NOON);
    expect(Object.keys(today).sort()).toEqual(['tieBreak', 'update']);
    expect(Object.keys(clearChoreDismissals(today))).toEqual(['update']);
  });
});

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

function mountHome () {
  const store = {
    state: {
      dbLoaded: true,
      databaseTopKey: ME,
      isOnline: true,
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: 'rating',
      academyAwardWinners: { bestPicture: [] },
      settings: { normalizationTweak: 0.25, tieBreakTweak: 1, includeShorts: false, tags: { 'viewing-tags': {} } },
      filteredResults: [],
      pendingReconciliations: [{ dbEntry: { path: `${ME}/movieLog/offline-1` } }],
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
      showtimesBadgeCount: 2
    },
    commit: vi.fn(),
    dispatch: vi.fn()
  };
  return mount(Home, {
    global: {
      mocks: { $store: store, $route: { query: {} }, $router: { push: vi.fn(), replace: vi.fn() } },
      stubs: { DBGridLayoutSearchResult: true, NoResults: true, StickinessModal: true, TweakModal: true, InsetBrowserModal: true }
    }
  });
}

describe('Home shows one notice at a time', () => {
  beforeEach(() => localStorage.clear());

  it('shows only the top card, and its X hands the slot to the next one', async () => {
    const wrapper = mountHome();
    expect(wrapper.find('.reconcile-prompt').exists()).toBe(true);
    expect(wrapper.find('.showtimes-prompt').exists()).toBe(false);

    await wrapper.find('.reconcile-prompt').element.parentElement.querySelector('.notice-dismiss').click();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.reconcile-prompt').exists()).toBe(false);
    expect(wrapper.find('.showtimes-prompt').exists()).toBe(true);
    // Remembered on the device for the rest of the day.
    expect(JSON.parse(localStorage.getItem(NOTICE_DISMISSALS_KEY))).toHaveProperty('reconcile');
  });

  it('keeps a lower card hidden while a reported one outranks it', async () => {
    const wrapper = mountHome();
    await wrapper.find('.reconcile-prompt').element.parentElement.querySelector('.notice-dismiss').click();
    wrapper.vm.reportNotice('bugFix', 'fix-1');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.currentNotice).toBe('bugFix');
    expect(wrapper.find('.showtimes-prompt').exists()).toBe(false);
  });
});
