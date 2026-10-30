import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';
import {
  NOTICE_ORDER, pickNotice, dismissNotice, isNoticeDismissed, clearChoreDismissals, NOTICE_DISMISSALS_KEY,
  holdNotice, noticeSourcesSettled, NOTICE_SETTLE_MS, resetNoticeLaunch, markNoticesSettled
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

// Report 2026-10-27: "When I load the app now the content in the activity
// banner often shows one thing and then switches to another." The sources
// answer at different moments after launch, and re-ranking on every answer
// swapped the card. Settle first (a blank card holds the space), then hold.
describe('settle, then hold', () => {
  it('keeps the card on screen when a higher-ranked one arrives later', () => {
    // The reported swap: a chore up, then the bug fixes come back.
    expect(holdNotice('stickiness', { stickiness: 'stickiness', bugFix: 'fix-1' }, {}, NOON)).toBe('stickiness');
    expect(holdNotice('showtimes', { showtimes: 3, friendRequest: 'a' }, {}, NOON)).toBe('showtimes');
  });

  it('hands the slot on once the card is put away or stops being due', () => {
    const signatures = { stickiness: 'stickiness', bugFix: 'fix-1' };
    const dismissed = dismissNotice({}, 'stickiness', 'stickiness', NOON);
    expect(holdNotice('stickiness', signatures, dismissed, NOON)).toBe('bugFix');
    expect(holdNotice('stickiness', { stickiness: null, bugFix: 'fix-1' }, {}, NOON)).toBe('bugFix');
    expect(holdNotice(null, signatures, {}, NOON)).toBe('bugFix');
    expect(holdNotice('stickiness', {}, {}, NOON)).toBeNull();
  });

  it('is settled only when every source has answered', () => {
    expect(noticeSourcesSettled({ library: true, bugFix: false })).toBe(false);
    expect(noticeSourcesSettled({ library: true, bugFix: true })).toBe(true);
  });
});

// The bug-fix card's check, answered whenever the test says so.
let answerBugFixes;
vi.mock('@/utils/bugResolutions', () => ({
  fetchUnseenResolutions: vi.fn(() => new Promise((resolve) => { answerBugFixes = resolve; })),
  markResolutionsSeen: vi.fn()
}));

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

function mountHome ({ pendingReconciliations = [{ dbEntry: { path: `${ME}/movieLog/offline-1` } }], showtimes = 2, chores = 'normal' } = {}) {
  const store = {
    state: {
      dbLoaded: true,
      settingsLoaded: true,
      newsletterLoaded: true,
      socialRequestsLoaded: true,
      databaseTopKey: ME,
      isOnline: true,
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: 'rating',
      academyAwardWinners: { bestPicture: [] },
      settings: {
        normalizationTweak: 0.25,
        tieBreakTweak: 1,
        includeShorts: false,
        tags: { 'viewing-tags': {} },
        stickinessPromptState: chores,
        tieBreakPromptState: chores,
        awardsPromptState: chores
      },
      filteredResults: [],
      pendingReconciliations,
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
      databaseTopKey: ME,
      showtimesBadgeCount: showtimes
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

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('Home shows one notice at a time', () => {
  beforeEach(() => {
    localStorage.clear();
    resetNoticeLaunch();
    markNoticesSettled();
  });

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

  it('lets a card that arrives later wait its turn instead of replacing the one on screen', async () => {
    const wrapper = mountHome({ pendingReconciliations: [] });
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.showtimes-prompt').exists()).toBe(true);

    wrapper.vm.reportNotice('bugFix', 'fix-1');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.currentNotice).toBe('showtimes');
    expect(wrapper.find('.showtimes-prompt').exists()).toBe(true);

    // Its turn comes when the card on screen is put away.
    await wrapper.find('.showtimes-prompt').element.parentElement.querySelector('.notice-dismiss').click();
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.currentNotice).toBe('bugFix');
  });
});

describe('putting a chore away with its X (report 2026-10-30)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetNoticeLaunch();
    markNoticesSettled();
  });

  it('pauses the chore on the account until midnight and recounts the badge', async () => {
    const wrapper = mountHome({ pendingReconciliations: [], showtimes: 0 });
    wrapper.vm.reportNotice('stickiness', 'stickiness');
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.currentNotice).toBe('stickiness');

    wrapper.vm.dismissCurrentNotice();
    const dispatch = wrapper.vm.$store.dispatch;
    const write = dispatch.mock.calls.find(([name, entry]) => name === 'writeDurably' && entry.path === 'settings/choresPausedUntil/stickiness');
    expect(write).toBeTruthy();
    expect(write[1].value).toBeGreaterThan(Date.now());
    expect(dispatch.mock.calls.some(([name]) => name === 'refreshAppBadge')).toBe(true);
  });

  it('leaves the account alone for a card that is not a chore', async () => {
    const wrapper = mountHome({ pendingReconciliations: [] });
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.currentNotice).toBe('showtimes');
    wrapper.vm.dismissCurrentNotice();
    expect(wrapper.vm.$store.dispatch.mock.calls.some(([, entry]) => entry?.path?.startsWith('settings/choresPausedUntil'))).toBe(false);
  });
});

describe('Home at launch, before every source has answered', () => {
  beforeEach(() => {
    localStorage.clear();
    resetNoticeLaunch();
  });

  it('holds a blank card in place, then reveals the top card once everything is in', async () => {
    const wrapper = mountHome({ pendingReconciliations: [] });
    await wrapper.vm.$nextTick();
    // Showtimes is known already, but the bug fixes aren't back yet.
    const placeholder = wrapper.find('.notice-placeholder');
    expect(placeholder.exists()).toBe(true);
    // Report 2026-10-27: a bare box "looks kind of broken" — it says what's up,
    // and says it to a screen reader too.
    expect(placeholder.text()).toContain("Checking what's new");
    expect(placeholder.attributes('role')).toBe('status');
    expect(placeholder.attributes('aria-hidden')).toBeUndefined();
    expect(wrapper.find('.showtimes-prompt').exists()).toBe(false);

    answerBugFixes([{ id: 'fix-1', text: 'Fixed.' }]);
    await flush();
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.notice-placeholder').exists()).toBe(false);
    expect(wrapper.text()).not.toContain("Checking what's new");
    // The bug fix outranks Showtimes, and it was never preceded by it.
    expect(wrapper.vm.currentNotice).toBe('bugFix');
    expect(wrapper.find('.showtimes-prompt').exists()).toBe(false);
  });

  it('holds no space when nothing is due', async () => {
    const wrapper = mountHome({ pendingReconciliations: [], showtimes: 0, chores: 'disabled' });
    await wrapper.vm.$nextTick();
    expect(wrapper.vm.noticesSettled).toBe(false);
    expect(wrapper.find('.notice-placeholder').exists()).toBe(false);
  });

  it('stops waiting a short while after the library lands', async () => {
    vi.useFakeTimers();
    try {
      const wrapper = mountHome({ pendingReconciliations: [] });
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.currentNotice).toBeNull();
      vi.advanceTimersByTime(NOTICE_SETTLE_MS);
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.currentNotice).toBe('showtimes');
      expect(wrapper.find('.notice-placeholder').exists()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
