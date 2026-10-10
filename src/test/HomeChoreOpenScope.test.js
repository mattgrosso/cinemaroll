import {
  describe, it, expect, vi
} from 'vitest';
import { reactive, ref, nextTick } from 'vue';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';

// Report -P3bg_m1nXLcjC3DGPc5 (2026-10-10): "Sometimes when i follow a
// notification to a tiebreak. When i tap on the winner to break the tie i end
// up looking at an awards year."
//
// The notification's "open this" request was one flag, handed to all three
// chore cards and left on for as long as Home stayed mounted. Finishing the
// tournament let the next prompt take the screen; the awards card mounted
// with autoOpen already true and navigated to /awards, exactly as a tap
// would. These drive Home's prompt choice directly and watch what each card
// is told.
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('lodash/debounce', () => ({ default: vi.fn((fn) => fn) }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 8, normalizedRating: 8 })),
  getAllRatings: vi.fn(() => [])
}));

const entry = (id) => ({
  dbKey: `k-${id}`,
  movie: { id, title: `Film ${id}`, release_date: '1999-05-05', genres: [], cast: [], crew: [], production_companies: [], keywords: [] },
  ratings: [{ calculatedTotal: 8, date: new Date().toISOString() }]
});
const LIBRARY = [entry(1), entry(2)];

function mountHome ({ onScreen, library = LIBRARY }) {
  const store = {
    state: {
      dbLoaded: true,
      databaseTopKey: 'test-user',
      currentLog: 'movieLog',
      DBSearchValue: '',
      DBSortValue: 'rating',
      academyAwardWinners: { bestPicture: [] },
      settings: { normalizationTweak: 0.25, tieBreakTweak: 1, includeShorts: false, tags: { 'viewing-tags': {} }, lastTweak: 1 },
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
    getters: { allMediaAsArray: library, allMoviesAsArray: library, allMediaSortedByRating: library },
    commit: vi.fn(),
    dispatch: vi.fn()
  };
  const route = reactive({ query: {} });
  const router = { push: vi.fn(), replace: vi.fn() };

  // Which prompt Home's priority rules put on screen — the thing that
  // changes when a tournament ends.
  const HomeWithPrompt = {
    ...Home,
    computed: { ...Home.computed, activeModalType () { return onScreen.value; } }
  };

  const wrapper = mount(HomeWithPrompt, {
    global: {
      mocks: { $store: store, $route: route, $router: router },
      stubs: {
        DBGridLayoutSearchResult: true,
        NoResults: true,
        StickinessInline: true,
        TweakInline: true,
        PersonalAwardsModal: true,
        InsetBrowserModal: true
      }
    }
  });
  return { wrapper, route };
}

const settle = async () => { for (let i = 0; i < 4; i++) await nextTick(); };
const autoOpenOf = (wrapper, name) => {
  const card = wrapper.findComponent({ name });
  return card.exists() ? card.props('autoOpen') : undefined;
};

describe('a chore notification opens only the prompt it was about', () => {
  it('finishing the tiebreak does not open the awards year waiting behind it', async () => {
    const onScreen = ref('tieBreak');
    const { wrapper, route } = mountHome({ onScreen });
    await settle();

    route.query = { open: 'tiebreak' };
    await settle();
    expect(autoOpenOf(wrapper, 'TweakInline')).toBe(true);

    // The winner is tapped, the tournament ends, awards is next in line.
    onScreen.value = 'awards';
    await settle();

    expect(autoOpenOf(wrapper, 'PersonalAwardsModal')).toBe(false);
  });

  it('finishing the tiebreak does not pop open a stickiness form either', async () => {
    const onScreen = ref('tieBreak');
    const { wrapper, route } = mountHome({ onScreen });
    await settle();

    route.query = { open: 'tiebreak' };
    await settle();

    onScreen.value = 'stickiness';
    await settle();

    expect(autoOpenOf(wrapper, 'StickinessInline')).toBe(false);
  });

  it('only the card on screen is told to open', async () => {
    const onScreen = ref('tieBreak');
    const { wrapper, route } = mountHome({ onScreen });
    await settle();

    route.query = { open: 'tiebreak' };
    await settle();

    expect(autoOpenOf(wrapper, 'TweakInline')).toBe(true);
    expect(autoOpenOf(wrapper, 'StickinessInline')).toBe(false);
  });

  it('a cold launch still opens the first prompt to appear once the library lands', async () => {
    const onScreen = ref(null);
    const { wrapper, route } = mountHome({ onScreen, library: [] });
    await settle();

    route.query = { open: 'tiebreak' };
    await settle();

    onScreen.value = 'tieBreak';
    await settle();
    expect(autoOpenOf(wrapper, 'TweakInline')).toBe(true);

    onScreen.value = 'awards';
    await settle();
    expect(autoOpenOf(wrapper, 'PersonalAwardsModal')).toBe(false);
  });
});
