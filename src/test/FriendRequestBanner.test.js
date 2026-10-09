import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';
import { QA_ACCOUNT_KEYS } from '@/assets/javascript/databaseKey.js';

// Bug report, 2026-08-19: "I need a more prominent notification when somebody
// wants to be my friend either via movie log or from cinnamon roll directly
// because I see them when I go look for them at the bottom of my film club,
// but not more prominently. I decided unless I think to look there I won't
// ever know that they're pending."
//
// The banner already existed on Home — but nested three levels inside
// `results-exist`, so it only rendered while a results list happened to be on
// screen. These cover the states where it used to vanish.
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('lodash/debounce', () => ({ default: vi.fn((fn) => fn) }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 8, normalizedRating: 8 })),
  getAllRatings: vi.fn(() => [])
}));

const ME = 'mattgrosso-gmail-com';

const movie = (id, title) => ({
  dbKey: `k-${id}`,
  movie: {
    id,
    title,
    release_date: '1999-05-05',
    genres: [],
    cast: [],
    crew: [],
    production_companies: [],
    keywords: []
  },
  ratings: [{ calculatedTotal: 8, date: '2023-01-01' }]
});

function mountHome ({ library = [movie(1, 'A Film')], socialRequests = {}, socialEdges = {}, userEmail = null } = {}) {
  const store = {
    state: {
      dbLoaded: true,
      databaseTopKey: ME,
      userEmail,
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: 'rating',
      academyAwardWinners: { bestPicture: [] },
      settings: {
        normalizationTweak: 0.25, tieBreakTweak: 1, includeShorts: false, tags: { 'viewing-tags': {} }
      },
      filteredResults: [],
      socialRequests,
      socialEdges,
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
      socialUserKey: ME
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

const banner = (wrapper) => wrapper.find('.prompt-badge-friends');

beforeEach(() => localStorage.clear());

describe('the friend request banner', () => {
  it('shows when someone has asked to be a friend', () => {
    const wrapper = mountHome({ socialRequests: { 'brian-gmail-com': { name: 'Brian' } } });

    expect(banner(wrapper).exists()).toBe(true);
    expect(wrapper.text()).toContain('Brian sent you a friend request.');
  });

  it('still shows when a search has no results at all', () => {
    // This is the case that used to hide it: no results list, so the whole
    // subtree it lived in never rendered.
    const wrapper = mountHome({ library: [], socialRequests: { 'brian-gmail-com': { name: 'Brian' } } });

    expect(wrapper.vm.paginatedSortedResults).toHaveLength(0);
    expect(banner(wrapper).exists()).toBe(true);
  });

  it('counts more than one request rather than naming just the first', () => {
    const wrapper = mountHome({
      socialRequests: { 'brian-gmail-com': { name: 'Brian' }, 'carrie-gmail-com': { name: 'Carrie' } }
    });

    expect(wrapper.text()).toContain('You have 2 friend requests.');
  });

  it('stays hidden when nobody is waiting', () => {
    const wrapper = mountHome({ socialRequests: {} });

    expect(banner(wrapper).exists()).toBe(false);
  });

  it('ignores a request from someone already befriended', () => {
    const wrapper = mountHome({
      socialRequests: { 'brian-gmail-com': { name: 'Brian' } },
      socialEdges: { [ME]: { 'brian-gmail-com': true }, 'brian-gmail-com': { [ME]: true } }
    });

    expect(banner(wrapper).exists()).toBe(false);
  });

  it('ignores the QA tester, the same as the Film Club inbox does', () => {
    // Otherwise the banner announces a request that the screen it sends you
    // to then refuses to show.
    // Read from the source list rather than hardcoded, so renaming the QA
    // account can't quietly turn this test green against nothing.
    const wrapper = mountHome({ socialRequests: { [QA_ACCOUNT_KEYS[0]]: { name: 'QA' } } });

    expect(banner(wrapper).exists()).toBe(false);
  });
});

// Bug report, 2026-10-09: "I have a few friends on Cinema Roll that have
// joined recently, and I have requested the friendship... and they haven't
// reacted to that." The card only linked to Film Club, and on a brand-new
// account it sat under two paragraphs of welcome.
describe('answering a friend request from Home', () => {
  const brian = { 'brian-gmail-com': { name: 'Brian' } };

  it('accepts right on the card, without a trip to Film Club', async () => {
    const wrapper = mountHome({ socialRequests: brian });

    await wrapper.find('.friend-request-accept').trigger('click');

    expect(wrapper.vm.$store.dispatch).toHaveBeenCalledWith('acceptFriendRequest', 'brian-gmail-com');
    expect(wrapper.vm.$router.push).not.toHaveBeenCalled();
  });

  it('"Not now" hides the card on this device without declining', async () => {
    const wrapper = mountHome({ socialRequests: brian });

    await wrapper.find('.friend-request-later').trigger('click');

    expect(banner(wrapper).exists()).toBe(false);
    expect(wrapper.vm.$store.dispatch).not.toHaveBeenCalledWith('declineFriendRequest', expect.anything());
    // Remembered across launches.
    expect(banner(mountHome({ socialRequests: brian })).exists()).toBe(false);
  });

  it('gives each of several requests its own name and buttons', () => {
    const wrapper = mountHome({
      socialRequests: { ...brian, 'carrie-gmail-com': { name: 'Carrie' } }
    });

    const rows = wrapper.findAll('.friend-request-row');
    expect(rows).toHaveLength(2);
    expect(rows[1].text()).toContain('Carrie');
    expect(rows[1].find('.friend-request-accept').exists()).toBe(true);
  });

  it('comes before the welcome text on a brand-new account', () => {
    const wrapper = mountHome({ library: [], socialRequests: brian, userEmail: 'new@example.com' });
    const html = wrapper.html();

    expect(html).toContain('welcome-new-user');
    expect(html.indexOf('prompt-badge-friends')).toBeLessThan(html.indexOf('welcome-new-user'));
  });

  it('counts on the Film Club button in the rainbow bar', () => {
    const wrapper = mountHome({ socialRequests: brian });

    expect(wrapper.find('.film-club-badge-count').text()).toBe('1');
  });
});
