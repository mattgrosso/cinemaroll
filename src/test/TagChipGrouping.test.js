import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';

// Bug report from Natalie, 2026-08-19: "I just tried to click on a tag on a
// movie and it brought me back to the home screen, but it didn't actually
// filter correctly. It didn't show me other movies with that tag."
//
// Her diagnostics carried the tell: chips ["tag:DARK"], resultsMatched 5, and
// grouped: true. The FLAT filter was right — five movies genuinely carry that
// tag. What she was looking at was the GROUPED view, which throws the chip's
// type away (effectiveSearchTerm is just the chip's value) and re-searches the
// bare word "DARK" across Title / Director / Cast / Producer / Company /
// Keywords & Genres. There is no tag group in that list at all, so the grouped
// view cannot show a tag's movies except by coincidence of the word appearing
// in a title or keyword — which is exactly "it didn't show me other movies
// with that tag".
//
// The fixture below is built to make the two answers disagree: two movies
// carry the tag and don't have "dark" anywhere, and one movie has it in the
// title and isn't tagged.
vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('lodash/debounce', () => ({ default: vi.fn((fn) => fn) }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 8.25, normalizedRating: 8 })),
  getAllRatings: vi.fn(() => [])
}));

const movie = (id, title, { tags = [], keywords = [], genres = [] } = {}) => ({
  movie: {
    id,
    title,
    release_date: '1999-05-05',
    genres: genres.map((name) => ({ name })),
    cast: [{ name: 'Someone Else', character: 'Role' }],
    crew: [{ name: 'Some Director', job: 'Director' }],
    production_companies: [{ name: 'A Studio' }],
    flatKeywords: keywords
  },
  ratings: [{ calculatedTotal: 8.5, date: '2023-01-01', tags: tags.map((title) => ({ title })) }],
  dbKey: `movie-${id}`
});

// Tagged DARK, and the word appears nowhere in their text.
const TAGGED = [
  movie(1, 'Nightfall Over Kyoto', { tags: ['DARK'] }),
  movie(2, 'The Quiet Sun', { tags: ['dark'] })
];
// The word in the title, but never tagged.
const UNTAGGED_BUT_WORDY = movie(3, 'The Dark Knight', { keywords: ['dark', 'vigilante'] });

// The same trap one dimension over: a real Horror film with no "horror" text,
// and a Comedy whose title says Horror.
const REALLY_HORROR = movie(4, 'Midnight Mass', { genres: ['Horror'] });
const HORROR_IN_NAME_ONLY = movie(5, 'Horror Story Night', { genres: ['Comedy'] });

const mockMovies = [...TAGGED, UNTAGGED_BUT_WORDY, REALLY_HORROR, HORROR_IN_NAME_ONLY];

function mountHome () {
  const mockStore = {
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
        tags: { 'viewing-tags': {} }
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
      allMediaAsArray: mockMovies,
      allMoviesAsArray: mockMovies,
      allMediaSortedByRating: mockMovies
    },
    commit: vi.fn(),
    dispatch: vi.fn()
  };

  return mount(Home, {
    global: {
      mocks: { $store: mockStore, $route: { query: {} }, $router: { push: vi.fn() } },
      stubs: {
        DBGridLayoutSearchResult: {
          template: '<div data-testid="db-grid-result">{{ result.movie.title }}</div>',
          props: ['result', 'keywordCounts', 'allCounts', 'index', 'resultsAreFiltered', 'sortValue', 'activeQuickLinkList']
        },
        NoResults: true,
        StickinessModal: true,
        TweakModal: true,
        InsetBrowserModal: true
      }
    }
  });
}

describe('a tag chip', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mountHome();
    await wrapper.vm.$nextTick();
    wrapper.vm.activeFilters.push({
      id: 'tag-1', type: 'tag', value: 'DARK', display: 'DARK'
    });
    await wrapper.vm.$nextTick();
  });

  it('filters to the movies actually carrying it, whatever their case', () => {
    const titles = wrapper.vm.unifiedFilteredResults.map((r) => r.movie.title);

    expect(titles).toContain('Nightfall Over Kyoto');
    expect(titles).toContain('The Quiet Sun');
    expect(titles).not.toContain('The Dark Knight');
  });

  it('does not fall into the grouped view, which a chip has no need of', () => {
    // Grouping answers "where did this WORD match?" — a question a tag chip
    // has already answered. (Typed text gets a Tags section since 2026-09-16;
    // a chip still bypasses grouping like every other typed chip.)
    expect(wrapper.vm.groupedByAllCategories).toBe(null);
  });

  it('shows the tagged movies on screen, not the ones merely named "dark"', () => {
    // The whole point of the report, asserted the way she saw it.
    const rendered = wrapper.findAll('[data-testid="db-grid-result"]').map((n) => n.text());

    expect(rendered).toContain('Nightfall Over Kyoto');
    expect(rendered).toContain('The Quiet Sun');
    expect(rendered).not.toContain('The Dark Knight');
  });
});

// Tags were the reported case, but nothing about the bug was tag-specific:
// Title is always one of the groups being searched, so ANY typed chip can
// render movies it excludes. Found while checking whether the tag fix was
// complete — it wasn't.
describe('a genre chip', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mountHome();
    await wrapper.vm.$nextTick();
    wrapper.vm.activeFilters.push({
      id: 'genre-1', type: 'genre', value: 'Horror', display: 'Horror'
    });
    await wrapper.vm.$nextTick();
  });

  it('does not render a movie that merely has the genre word in its title', () => {
    const rendered = wrapper.findAll('[data-testid="db-grid-result"]').map((n) => n.text());

    // 'Horror Story Night' is a Comedy. Before the fix it was the ONLY thing
    // on screen, while the actual Horror film rendered nowhere.
    expect(rendered).not.toContain('Horror Story Night');
    expect(rendered).toContain('Midnight Mass');
  });
});

describe('a plain typed search', () => {
  it('still groups, since that is what grouping is for', async () => {
    const wrapper = mountHome();
    await wrapper.vm.$nextTick();
    wrapper.vm.activeFilters.push({
      id: 'general-1', type: 'general', value: 'dark', display: 'dark'
    });
    await wrapper.vm.$nextTick();

    // Guards against "fix it by turning grouping off" — a general chip is
    // exactly the case grouping exists to serve.
    expect(wrapper.vm.groupedByAllCategories).not.toBe(null);
  });
});
