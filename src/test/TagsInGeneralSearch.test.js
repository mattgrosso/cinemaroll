import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import Home from '@/components/Home.vue';
import { applyFilter, buildSearchFields } from '@/assets/javascript/searchFiltering.js';

// Report -P1eOh1r2mx2H6QAwzS7 (Matt, 2026-09-16): "I have a tag that's
// called back focus, and when I search for it in the search bar, no films
// come up. I would like the tags to be searchable just like everything else."
//
// Tags live on the ratings, not the movie, and `buildSearchFields` only ever
// looked at the movie — so the general text search, and the grouped view
// built on the same precomputed fields, were blind to them. A tag CHIP found
// them (FILTER_KINDS.tag reads the ratings directly), but nothing typed did.

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('lodash/debounce', () => ({ default: vi.fn((fn) => fn) }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 8.25, normalizedRating: 8 })),
  getAllRatings: vi.fn(() => [])
}));

const movie = (id, title, { tags = [], keywords = [] } = {}) => ({
  movie: {
    id,
    title,
    release_date: '1999-05-05',
    genres: [{ name: 'Drama' }],
    cast: [{ name: 'Someone Else', character: 'Role' }],
    crew: [{ name: 'Some Director', job: 'Director' }],
    production_companies: [{ name: 'A Studio' }],
    flatKeywords: keywords
  },
  ratings: [{ calculatedTotal: 8.5, date: '2023-01-01', tags: tags.map((title) => ({ title })) }],
  dbKey: `movie-${id}`
});

// Tagged, and the words appear nowhere else in its text.
const TAGGED = movie(1, 'Nightfall Over Kyoto', { tags: ['Back Focus'] });
// A film actually CALLED Focus, never tagged: the two readings of "focus".
const TITLED = movie(2, 'Focus');
const NEITHER = movie(3, 'The Quiet Sun', { keywords: ['silence'] });

const mockMovies = [TAGGED, TITLED, NEITHER];

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

const typed = async (wrapper, value) => {
  wrapper.vm.activeFilters.push({ id: `general-${value}`, type: 'general', value, display: value });
  await wrapper.vm.$nextTick();
};

describe('applyFilter general reads viewing tags', () => {
  it('matches a movie by a tag on one of its ratings', () => {
    const entry = { ...TAGGED, _search: buildSearchFields(TAGGED.movie, TAGGED.ratings) };
    expect(applyFilter(entry, { type: 'general', value: 'back focus' })).toBe(true);
    // Case and a curly-apostrophe-free typo of spacing are display choices.
    expect(applyFilter(entry, { type: 'general', value: 'BACK FOCUS' })).toBe(true);
  });

  it('reaches a tag by part of it, the way a surname reaches a cast name', () => {
    const entry = { ...TAGGED, _search: buildSearchFields(TAGGED.movie, TAGGED.ratings) };
    expect(applyFilter(entry, { type: 'general', value: 'focus' })).toBe(true);
  });

  it('still says no when nothing carries the tag', () => {
    const entry = { ...NEITHER, _search: buildSearchFields(NEITHER.movie, NEITHER.ratings) };
    expect(applyFilter(entry, { type: 'general', value: 'back focus' })).toBe(false);
  });

  it('survives an entry with no ratings at all', () => {
    expect(buildSearchFields(NEITHER.movie).tags).toEqual([]);
    expect(applyFilter({ movie: NEITHER.movie }, { type: 'general', value: 'focus' })).toBe(false);
  });
});

describe('typing a tag into the search bar', () => {
  let wrapper;

  beforeEach(async () => {
    wrapper = mountHome();
    await wrapper.vm.$nextTick();
  });

  it('finds the film the tag is on — the report, as Matt saw it', async () => {
    await typed(wrapper, 'back focus');

    const rendered = wrapper.findAll('[data-testid="db-grid-result"]').map((n) => n.text());
    expect(rendered).toContain('Nightfall Over Kyoto');
    expect(rendered).not.toContain('The Quiet Sun');
  });

  it('gives tags their own section in the grouped view, beside Title', async () => {
    await typed(wrapper, 'focus');

    const grouped = wrapper.vm.groupedByAllCategories;
    expect(grouped).not.toBe(null);
    const byKey = Object.fromEntries(grouped.map((g) => [g.category, g]));

    expect(byKey.title.movies.map((m) => m.movie.title)).toEqual(['Focus']);
    expect(byKey.tag.categoryDisplay).toBe('Tags');
    expect(byKey.tag.movies.map((m) => m.movie.title)).toEqual(['Nightfall Over Kyoto']);
  });
});
