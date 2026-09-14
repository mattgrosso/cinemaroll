import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import WatchlistScreen from '@/components/WatchlistScreen.vue';
import axios from 'axios';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((entry) => ({ calculatedTotal: entry.ratings[0]?.calculatedTotal }))
}));

const YEARS = 365.25 * 24 * 3600 * 1000;
const yearsAgo = (y) => Date.now() - y * YEARS;

function entry (id, title, { rating = 8.5, watched = yearsAgo(6), crew = [], cast = [] } = {}) {
  return {
    dbKey: `key-${id}`,
    movie: { id, title, poster_path: '/p.jpg', crew, cast },
    ratings: [{ calculatedTotal: rating, date: watched }]
  };
}

// Two loved movies each from two directors and two actors, so all four
// clear favoritePeople's minMovies threshold — and each people row clears
// MIN_PEOPLE_PER_SECTION (a row built on one name doesn't render).
function library () {
  const dir = [{ job: 'Director', name: 'Fave Director' }, { job: 'Director', name: 'Second Director' }];
  const cast = [{ name: 'Fave Actor' }, { name: 'Second Actor' }];
  return [
    entry(1, 'Old Favorite A', { crew: dir, cast }),
    entry(2, 'Old Favorite B', { crew: dir, cast }),
    entry(3, 'Recent One', { watched: yearsAgo(0.1) })
  ];
}

function tmdbImpl (url) {
  if (url.includes('/recommendations')) {
    return Promise.resolve({
      data: {
        results: [
          { id: 95, title: 'Similar Pick', release_date: '2021-06-15', vote_count: 8000, vote_average: 8.0 },
          { id: 1, title: 'Already Rated', release_date: '2010-06-15', vote_count: 9000, vote_average: 8.4 }
        ]
      }
    });
  }
  if (url.includes('/search/person')) {
    // TMDB always returns a gender (1 female, 2 male, 0 unspecified), and the
    // performer rows are split on it — a mock without one made every gendered
    // row come back empty.
    return Promise.resolve({ data: { results: [{ id: 777, gender: 2 }] } });
  }
  if (url.includes('/person/777/movie_credits')) {
    return Promise.resolve({
      data: {
        crew: [
          { id: 90, title: 'Unseen Gem', job: 'Director', release_date: '2018-06-15', vote_count: 5000, vote_average: 8.1 },
          { id: 1, title: 'Already Rated', job: 'Director', release_date: '2010-06-15', vote_count: 9000, vote_average: 8.4 }
        ],
        cast: [
          { id: 91, title: 'Unseen Performance', order: 1, release_date: '2019-06-15', vote_count: 4000, vote_average: 7.9 },
          { id: 92, title: 'Deep Cameo', order: 40, release_date: '2019-06-15', vote_count: 4000, vote_average: 7.9 }
        ]
      }
    });
  }
  return Promise.reject(new Error(`unexpected url ${url}`));
}

function factory ({ isOnline = true, movies = library(), dispatch = vi.fn(), movieHatMovieIds = {} } = {}) {
  const pushSpy = vi.fn();
  const commitSpy = vi.fn();
  const wrapper = mount(WatchlistScreen, {
    global: {
      mocks: {
        $store: {
          state: { isOnline, movieHatMovieIds },
          getters: { allMoviesAsArray: movies },
          commit: commitSpy,
          dispatch
        },
        $router: { push: pushSpy }
      }
    }
  });
  return { wrapper, pushSpy, commitSpy, dispatch };
}

// Cards are poster-only now, so a card's accessible name is where the title
// lives (Matt, 2026-08-16: "posters are better than text").
const cardNames = (wrapper) => wrapper.findAll('.watchlist-card').map((card) => card.attributes('aria-label'));

describe('WatchlistScreen (request: watchlists from my ratings + movies to consider rewatching)', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.get.mockImplementation(tmdbImpl);
  });

  it('shows loved-but-long-unwatched movies in the rewatch row, and not recent ones', async () => {
    const { wrapper } = factory();
    await flushPromises();

    // Posters carry the identity now, so the title is the image's alt text
    // rather than a caption under it (Matt, 2026-08-16: "posters are better
    // than text").
    const names = cardNames(wrapper);
    expect(names).toContain('Old Favorite A');
    expect(names).not.toContain('Recent One');
  });

  it('tapping a rewatch card opens that movie', async () => {
    const { wrapper, pushSpy } = factory();
    await flushPromises();

    await wrapper.find('.watchlist-card').trigger('click');
    expect(pushSpy).toHaveBeenCalledWith(expect.stringMatching(/^\/movie\//));
  });

  it('builds the director and actor sections from TMDB, excluding rated movies and deep cameos', async () => {
    const { wrapper } = factory();
    await flushPromises();

    const text = wrapper.text();
    expect(text).toContain('From directors you love');
    expect(text).toContain('Based on Fave Director');

    const names = cardNames(wrapper);
    expect(names).toContain('Unseen Gem');
    expect(names).toContain('Unseen Performance');
    expect(names).not.toContain('Already Rated');
    expect(names).not.toContain('Deep Cameo');
  });

  it('pools TMDB recommendations from your top-rated movies into "More like your favorites"', async () => {
    const { wrapper } = factory();
    await flushPromises();

    expect(wrapper.text()).toContain('More like your favorites');

    const names = cardNames(wrapper);
    expect(names).toContain('Similar Pick');
    expect(names).not.toContain('Already Rated');
  });

  // Bug report, 2026-08-20: "If a movie is presented in a watchlist or in film
  // club and it's one that I have not yet rated then... just clicking the
  // poster should pull up some kind of a summary of the movie so that I can
  // investigate further." These rows suggest films you HAVEN'T seen, so
  // dropping straight into the rating flow only made sense if you had.
  it('opens a summary for an unrated suggestion instead of jumping into rating', async () => {
    const { wrapper, pushSpy, commitSpy } = factory();
    await flushPromises();

    const card = wrapper.findAll('.watchlist-card')
      .find((candidate) => candidate.attributes('aria-label') === 'Unseen Gem');
    await card.trigger('click');

    expect(wrapper.vm.previewing).toMatchObject({ id: 90, title: 'Unseen Gem' });
    expect(commitSpy).not.toHaveBeenCalledWith('setMovieToRate', expect.anything());
    expect(pushSpy).not.toHaveBeenCalledWith('/rate-movie');
  });

  it('still hands off to the rating flow from inside the summary', async () => {
    const { wrapper, pushSpy, commitSpy } = factory();
    await flushPromises();

    const card = wrapper.findAll('.watchlist-card')
      .find((candidate) => candidate.attributes('aria-label') === 'Unseen Gem');
    await card.trigger('click');
    // What MoviePreview emits when "I've seen it — rate it" is pressed.
    wrapper.vm.rateFromPreview(wrapper.vm.previewing.source);

    expect(commitSpy).toHaveBeenCalledWith('setMovieToRate', expect.objectContaining({ id: 90 }));
    expect(pushSpy).toHaveBeenCalledWith('/rate-movie');
    // And the sheet closes on the way out, rather than sitting over the
    // rating screen it just navigated to.
    expect(wrapper.vm.previewing).toBeNull();
  });

  // The rewatch and "another shot" rows are films you HAVE rated, so their
  // posters still go where they always did: your own detail page, which is
  // richer than anything a summary sheet could show.
  it('leaves an already-rated row going straight to its detail page', async () => {
    const { wrapper, pushSpy } = factory();
    await flushPromises();

    const card = wrapper.findAll('.watchlist-card')
      .find((candidate) => candidate.attributes('aria-label') === 'Old Favorite A');
    await card.trigger('click');

    expect(pushSpy).toHaveBeenCalledWith(expect.stringMatching(/^\/movie\//));
    expect(wrapper.vm.previewing).toBeNull();
  });

  it('offline: keeps the rewatch list, hides the TMDB sections, says why, and fetches nothing', async () => {
    const { wrapper } = factory({ isOnline: false });
    await flushPromises();

    expect(wrapper.findAll('.watchlist-card').length).toBeGreaterThan(0);
    expect(wrapper.text()).not.toContain('From directors you love');
    expect(wrapper.find('.watchlist-offline-note').exists()).toBe(true);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('a failed person lookup degrades to the other people instead of erroring the screen', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/search/person') && url.includes('Fave%20Director')) {
        return Promise.reject(new Error('network'));
      }
      return tmdbImpl(url);
    });
    const { wrapper } = factory();
    await flushPromises();

    expect(wrapper.text()).toContain('Unseen Perfor'); // actor section still built (grid truncates)
  });
});

// The learning loop is best-effort bookkeeping that runs after the lists are
// already on screen. It used to be two bare awaits in a row, so when
// reconciling threw — it was handed a Set where it expected an array, on
// every visit after the first — recording never ran again either, and the
// whole loop silently froze.
describe('WatchlistScreen learning loop', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.get.mockImplementation(tmdbImpl);
  });

  it('hands reconcile the rated ids and then records what it showed', async () => {
    const { dispatch } = factory();
    await flushPromises();

    const actions = dispatch.mock.calls.map(([action]) => action);
    expect(actions).toContain('reconcileWatchlistLearning');
    expect(actions).toContain('recordWatchlistSuggestions');

    // Whatever shape it is, reconcile has to be able to iterate it.
    const [, rated] = dispatch.mock.calls.find(([a]) => a === 'reconcileWatchlistLearning');
    expect(() => Array.from(rated)).not.toThrow();
  });

  it('still records suggestions when reconciling blows up', async () => {
    const dispatch = vi.fn((action) => {
      if (action === 'reconcileWatchlistLearning') return Promise.reject(new Error('boom'));
      return Promise.resolve();
    });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    factory({ dispatch });
    await flushPromises();

    expect(dispatch.mock.calls.map(([action]) => action)).toContain('recordWatchlistSuggestions');
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it('does not fail the page when recording blows up', async () => {
    const dispatch = vi.fn((action) => (
      action === 'recordWatchlistSuggestions'
        ? Promise.reject(new Error('boom'))
        : Promise.resolve()
    ));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { wrapper } = factory({ dispatch });
    await flushPromises();

    // The lists are assigned before the learning loop runs, so they survive.
    expect(wrapper.findAll('.watchlist-card').length).toBeGreaterThan(0);
    errors.mockRestore();
  });
});

// "There should be a separate one for actors and actresses, and a third one
// for actors and actresses combined who I like more than most people."
// (2026-08-17) The library doesn't store gender — storedEntry.js trims it —
// so it comes from the same /search/person call the credits lookup already
// makes, and the id is reused rather than searched for twice.
describe('WatchlistScreen performer sections', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.get.mockImplementation(tmdbImpl);
  });

  it('splits performers by the gender TMDB reports', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/search/person')) {
        const female = url.includes('Fave%20Actor');
        return Promise.resolve({ data: { results: [{ id: 777, gender: female ? 1 : 2 }] } });
      }
      return tmdbImpl(url);
    });

    const { wrapper } = factory();
    await flushPromises();

    // Non-empty first: `every` on an empty array passes vacuously and would
    // have let a broken split through.
    expect(wrapper.vm.actressNames.map((p) => p.name)).toEqual(['Fave Actor']);
    expect(wrapper.vm.actressNames.every((p) => p.gender === 1)).toBe(true);
    expect(wrapper.vm.actorNames.map((p) => p.name)).toEqual(['Second Actor']);
  });

  // Bug report (2026-09-13): "the actresses you loved one is just based
  // entirely on [Julianne] Moore. That's not enough information to build a
  // whole list out of." One name is a filmography, not a watchlist.
  it('does not show a people row built on a single name', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/search/person')) {
        const female = url.includes('Fave%20Actor');
        return Promise.resolve({ data: { results: [{ id: 777, gender: female ? 1 : 2 }] } });
      }
      return tmdbImpl(url);
    });

    const { wrapper } = factory();
    await flushPromises();

    expect(wrapper.vm.actressNames).toHaveLength(1);
    expect(wrapper.text()).not.toContain('From actresses you love');
    expect(wrapper.text()).not.toContain('From actors you love');
  });

  // "...let's rethink these so they are more broadly applicable or derived
  // from a broader base of information." The top of the performer list was
  // twelve names, split by gender — a library whose top twelve held one
  // woman got a one-woman row. Now the list is walked, in rank order, until
  // both rows are full.
  it('keeps walking down the performer list until both rows have five names', async () => {
    // Twelve actors ranked above the first actress, all with enough films.
    const cast = Array.from({ length: 12 }, (_, i) => ({ name: `Man ${i}` }))
      .concat(Array.from({ length: 5 }, (_, i) => ({ name: `Woman ${i}` })));
    // castDepth is 5 per film, so spread the names over several films.
    const films = [];
    for (let i = 0; i < cast.length; i += 5) {
      const slice = cast.slice(i, i + 5);
      films.push(entry(100 + i, `Film ${i} A`, { cast: slice }));
      films.push(entry(200 + i, `Film ${i} B`, { cast: slice }));
    }
    axios.get.mockImplementation((url) => {
      if (url.includes('/search/person')) {
        const female = url.includes('Woman');
        return Promise.resolve({ data: { results: [{ id: 777, gender: female ? 1 : 2 }] } });
      }
      return tmdbImpl(url);
    });

    const { wrapper } = factory({ movies: films });
    await flushPromises();

    expect(wrapper.vm.actorNames).toHaveLength(5);
    expect(wrapper.vm.actressNames).toHaveLength(5);
    expect(wrapper.vm.actressNames.every((p) => p.name.startsWith('Woman'))).toBe(true);
    expect(wrapper.text()).toContain('From actresses you love');
  });

  it('stops looking people up once both rows are full', async () => {
    // Twenty performers, alternating, so the first batch of eight already
    // holds four of each — the second batch fills both rows and the rest
    // are never looked up.
    const cast = Array.from({ length: 20 }, (_, i) => ({ name: i % 2 ? `Woman ${i}` : `Man ${i}` }));
    const films = [];
    for (let i = 0; i < cast.length; i += 5) {
      const slice = cast.slice(i, i + 5);
      films.push(entry(100 + i, `Film ${i} A`, { cast: slice }));
      films.push(entry(200 + i, `Film ${i} B`, { cast: slice }));
    }
    axios.get.mockImplementation((url) => {
      if (url.includes('/search/person')) {
        return Promise.resolve({ data: { results: [{ id: 777, gender: url.includes('Woman') ? 1 : 2 }] } });
      }
      return tmdbImpl(url);
    });

    factory({ movies: films });
    await flushPromises();

    const lookedUp = axios.get.mock.calls
      .map(([url]) => url)
      .filter((url) => url.includes('/search/person') && (url.includes('Man') || url.includes('Woman')));
    // Two batches of eight, not all twenty.
    expect(lookedUp).toHaveLength(16);
  });

  // TMDB reports 0 for "not specified", and such a person belongs in neither
  // row. The row simply doesn't render rather than showing them wrongly.
  it('leaves ungendered people out of both gendered rows', async () => {
    axios.get.mockImplementation((url) => {
      if (url.includes('/search/person')) {
        return Promise.resolve({ data: { results: [{ id: 777, gender: 0 }] } });
      }
      return tmdbImpl(url);
    });

    const { wrapper } = factory();
    await flushPromises();

    expect(wrapper.vm.actressNames).toEqual([]);
    expect(wrapper.vm.actorNames).toEqual([]);
    expect(wrapper.text()).not.toContain('From actresses you love');
  });

  it('reuses the id it resolved instead of searching for the same name twice', async () => {
    const { wrapper } = factory();
    await flushPromises();

    const searches = axios.get.mock.calls
      .map(([url]) => url)
      .filter((url) => url.includes('/search/person') && url.includes('Fave%20Actor'));

    // One in the gender pass; the credits lookup takes the id from it.
    expect(searches).toHaveLength(1);
    expect(wrapper.vm.actorNames.every((p) => p.id === 777)).toBe(true);
  });
});


// Bug report, 2026-08-19: "In any watchlist, if a movie is already present in
// one of my hats, it should not appear as a suggestion so that includes the
// rewatch watchlist. That includes any recommendations we have who includes
// all the years anything where we have a watchlist if I've already put it in a
// hat I don't need to be suggested that movie anymore."
describe('films already in a hat are not suggested again', () => {
  beforeEach(() => {
    axios.get.mockReset();
    axios.get.mockImplementation(tmdbImpl);
  });

  it('drops a hatted film from the rewatch row', async () => {
    const before = factory({});
    await flushPromises();
    expect(cardNames(before.wrapper)).toContain('Old Favorite A');

    // Same library, but that film is now sitting in a hat.
    const after = factory({ movieHatMovieIds: { 1: true } });
    await flushPromises();

    expect(cardNames(after.wrapper)).not.toContain('Old Favorite A');
    // The rest of the row is untouched.
    expect(cardNames(after.wrapper)).toContain('Old Favorite B');
  });

  it('drops a hatted film from the TMDB-derived rows too', async () => {
    const before = factory({});
    await flushPromises();
    expect(cardNames(before.wrapper)).toContain('Similar Pick');

    // 95 is the recommendation's TMDB id, not a library dbKey — the rule has
    // to work on raw TMDB results as well as rated entries.
    const after = factory({ movieHatMovieIds: { 95: true } });
    await flushPromises();

    expect(cardNames(after.wrapper)).not.toContain('Similar Pick');
  });

  it('loads the hat contents itself rather than waiting for a button to mount', () => {
    const dispatch = vi.fn();
    factory({ dispatch });

    expect(dispatch).toHaveBeenCalledWith('ensureMovieHatContents');
  });

  it('suggests everything as normal when no hats hold anything', async () => {
    const { wrapper } = factory({ movieHatMovieIds: {} });
    await flushPromises();

    expect(cardNames(wrapper)).toContain('Old Favorite A');
  });
});

// Bug report, 2026-08-19: "How did you choose which years to include in the
// get it to 10 watchlist... it seems like an arbitrary number of lists. Maybe
// there's a way to combine those into a single list with like a year selector
// above it... and then, if you could see on each one of those selectors, how
// close we actually are so I can look at any given year."
describe('the "get a year to 10" picker', () => {
  // 1997 needs 1 more, 2003 needs 3, 1962 needs 9. Under the old rules 1962
  // was dropped outright (beyond a reach of 4).
  const yearMovie = (id, year) => ({
    dbKey: `y${id}`,
    movie: { id, title: `M${id}`, poster_path: '/p.jpg', release_date: `${year}-06-15`, runtime: 100, crew: [], cast: [] },
    ratings: [{ calculatedTotal: 7, date: yearsAgo(6) }]
  });

  const yearLibrary = () => [
    ...Array.from({ length: 9 }, (_, i) => yearMovie(i + 1, 1997)),
    ...Array.from({ length: 7 }, (_, i) => yearMovie(100 + i, 2003)),
    yearMovie(200, 1962)
  ];

  // Each year's discover call answers with a film named for the year asked
  // for, so which year is on screen is unambiguous.
  const discoverImpl = (url) => {
    const match = url.match(/primary_release_year=(\d{4})/);
    if (match) {
      return Promise.resolve({
        data: {
          results: [
            { id: Number(`9${match[1]}`), title: `Pick from ${match[1]}`, poster_path: '/p.jpg', release_date: `${match[1]}-03-10`, vote_count: 5000, vote_average: 8.2 }
          ]
        }
      });
    }
    return tmdbImpl(url);
  };

  const yearsAsked = () => axios.get.mock.calls
    .map(([url]) => url.match(/primary_release_year=(\d{4})/)?.[1])
    .filter(Boolean);

  beforeEach(() => {
    axios.get.mockReset();
    axios.get.mockImplementation(discoverImpl);
  });

  it('offers every unfinished year in one selector, each labelled with how far off it is', async () => {
    const { wrapper } = factory({ movies: yearLibrary() });
    await flushPromises();

    const tabs = wrapper.findAll('.year-tab');
    expect(tabs.map((tab) => tab.find('.year-tab-year').text())).toEqual(['1997', '2003', '1962']);
    expect(tabs.map((tab) => tab.find('.year-tab-gap').text())).toEqual(['1 to go', '3 to go', '9 to go']);

    // One section, not one per year — the whole point of the report.
    expect(wrapper.findAll('.year-picker')).toHaveLength(1);
    expect(wrapper.text()).toContain('Get a year to 10');
  });

  it('opens on the closest-to-done year and fetches only that one', async () => {
    const { wrapper } = factory({ movies: yearLibrary() });
    await flushPromises();

    expect(wrapper.find('.year-tab.active .year-tab-year').text()).toBe('1997');
    expect(yearsAsked()).toEqual(['1997']);
    expect(cardNames(wrapper)).toContain('Pick from 1997');
    expect(cardNames(wrapper)).not.toContain('Pick from 2003');
  });

  it('tapping another year swaps the list to that year, fetching it on demand', async () => {
    const { wrapper } = factory({ movies: yearLibrary() });
    await flushPromises();

    await wrapper.findAll('.year-tab')[2].trigger('click');
    await flushPromises();

    expect(wrapper.find('.year-tab.active .year-tab-year').text()).toBe('1962');
    expect(yearsAsked()).toEqual(['1997', '1962']);
    expect(cardNames(wrapper)).toContain('Pick from 1962');
    expect(cardNames(wrapper)).not.toContain('Pick from 1997');
    expect(wrapper.text()).toContain('9 to go for awards');
  });

  it('going back to a year already looked at costs no second request', async () => {
    const { wrapper } = factory({ movies: yearLibrary() });
    await flushPromises();

    await wrapper.findAll('.year-tab')[1].trigger('click');
    await flushPromises();
    await wrapper.findAll('.year-tab')[0].trigger('click');
    await flushPromises();

    expect(yearsAsked()).toEqual(['1997', '2003']);
    expect(cardNames(wrapper)).toContain('Pick from 1997');
  });

  it('shows no picker at all when every year is either finished or untouched', async () => {
    const { wrapper } = factory();
    await flushPromises();

    expect(wrapper.find('.year-picker').exists()).toBe(false);
    expect(yearsAsked()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Bug report, 2026-09-01: "It'll be nice if on watchlist I could type into the
// input a person like a director or an actor and get the full list their
// entire filmography that would be really great cause then I could go through
// and add them all to hat easily."
describe('WatchlistScreen — someone\'s filmography', () => {
  const GRETA = {
    id: 500, name: 'Greta Gerwig', known_for_department: 'Directing',
    profile_path: '/gg.jpg', known_for: [{ title: 'Lady Bird' }]
  };
  const OTHER_GRETA = { id: 501, name: 'Greta Garbo', known_for_department: 'Acting', known_for: [{ title: 'Ninotchka' }] };

  const CREDITS = {
    cast: [
      { id: 800, title: 'Frances Ha', release_date: '2012-05-17', poster_path: '/fh.jpg' },
      // Already in the library below — kept and marked, not dropped.
      { id: 1, title: 'Old Favorite A', release_date: '2005-01-01' },
      // No release date: an announced film that can't be watched.
      { id: 801, title: 'Untitled Next Project' }
    ],
    crew: [
      { id: 802, title: 'Barbie', release_date: '2023-07-21', job: 'Director', poster_path: '/b.jpg' },
      { id: 803, title: 'Money Job', release_date: '2020-01-01', job: 'Executive Producer' }
    ]
  };

  // Only the person endpoints matter here; everything the page fetches on
  // mount is allowed to come back empty.
  function personImpl (people) {
    return (url) => {
      if (url.includes('/search/person') && url.includes('query=Greta')) {
        return Promise.resolve({ data: { results: people } });
      }
      if (url.includes('/person/500/movie_credits')) return Promise.resolve({ data: CREDITS });
      if (url.includes('/search/person')) return Promise.resolve({ data: { results: [] } });
      return Promise.resolve({ data: { results: [], cast: [], crew: [] } });
    };
  }

  async function search (people) {
    axios.get.mockReset();
    axios.get.mockImplementation(personImpl(people));
    const { wrapper } = factory();
    await flushPromises();

    const form = wrapper.find('.person-section form');
    await wrapper.find('.person-section .prompt-input').setValue('Greta');
    await form.trigger('submit');
    await flushPromises();
    return wrapper;
  }

  it('shows the entire filmography, newest first', async () => {
    const wrapper = await search([GRETA]);
    // A rated film's accessible name carries the "already rated" suffix — see
    // the greying test below — so compare on the title half.
    const names = wrapper.findAll('.person-section .watchlist-card')
      .map((c) => c.attributes('aria-label').split(' — ')[0]);

    expect(names).toEqual(['Barbie', 'Frances Ha', 'Old Favorite A']);
  });

  // The whole point of the request — this is a filmography, not a
  // recommendation list, so seen films stay put and say so.
  it('keeps films already rated, marked with your score', async () => {
    const wrapper = await search([GRETA]);
    expect(wrapper.find('.person-section').text()).toContain('You: 8.50');
    expect(wrapper.find('.person-section').text()).toContain('3 films, 1 of them already rated');
  });

  // Follow-up report the same night, against the row that had just shipped:
  // "should filter out movies that I've already seen or at least should mark
  // them... maybe gray them out or put a message that says already rated."
  it('greys and flags the films already rated, without removing them', async () => {
    const wrapper = await search([GRETA]);
    const cards = wrapper.findAll('.person-section .watchlist-card');
    const seen = cards.filter((c) => c.classes('watchlist-card-seen'));

    expect(seen).toHaveLength(1);
    expect(seen[0].attributes('aria-label')).toBe('Old Favorite A — already rated');
    expect(seen[0].find('.watchlist-seen-flag').text()).toBe('Rated');
    // Still there, still hattable — greying, not filtering. He asked for that
    // explicitly: "don't filter them out just maybe gray them out".
    expect(cards).toHaveLength(3);
  });

  it('leaves the unseen films undimmed and unflagged', async () => {
    const wrapper = await search([GRETA]);
    const unseen = wrapper.findAll('.person-section .watchlist-card')
      .filter((c) => !c.classes('watchlist-card-seen'));

    expect(unseen).toHaveLength(2);
    expect(unseen[0].find('.watchlist-seen-flag').exists()).toBe(false);
  });

  it('leaves out announced films and producer-only credits', async () => {
    const wrapper = await search([GRETA]);
    const names = wrapper.findAll('.person-section .watchlist-card').map((c) => c.attributes('aria-label'));

    expect(names).not.toContain('Untitled Next Project');
    expect(names).not.toContain('Money Job');
  });

  it('one match goes straight to the films, with no chooser to tap through', async () => {
    const wrapper = await search([GRETA]);
    expect(wrapper.find('.person-choice').exists()).toBe(false);
  });

  // Names collide, and guessing gets it wrong — TMDB's first hit for
  // "Michael Jordan" is not Michael B. Jordan.
  it('asks which person you meant when the name is ambiguous', async () => {
    const wrapper = await search([GRETA, OTHER_GRETA]);
    const choices = wrapper.findAll('.person-choice');

    expect(choices.map((c) => c.find('.person-choice-name').text())).toEqual(['Greta Gerwig', 'Greta Garbo']);
    // The films are what tell two same-named people apart.
    expect(choices[0].text()).toContain('Lady Bird');
    expect(wrapper.findAll('.person-section .watchlist-card')).toHaveLength(0);

    await choices[0].trigger('click');
    await flushPromises();

    expect(wrapper.find('.person-choice').exists()).toBe(false);
    expect(wrapper.findAll('.person-section .watchlist-card').length).toBe(3);
  });

  it('says so plainly when nobody matches', async () => {
    const wrapper = await search([]);
    expect(wrapper.find('.person-section').text()).toContain('No films found');
  });

  it('reports a failed lookup instead of silently showing nothing', async () => {
    axios.get.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('query=Greta')) return Promise.reject(new Error('network'));
      return Promise.resolve({ data: { results: [], cast: [], crew: [] } });
    });
    const { wrapper } = factory();
    await flushPromises();

    await wrapper.find('.person-section .prompt-input').setValue('Greta');
    await wrapper.find('.person-section form').trigger('submit');
    await flushPromises();

    expect(wrapper.find('.person-section .prompt-error').text()).toContain("Couldn't look that name up");
  });
});

// Bug report (Matt, 2026-09-01, on the watchlist): "It would be nice if the
// filmography search could auto complete for me sort of like we do in the
// other search fields." The search bar's typeahead, narrowed to the people
// in your library; a tap fills the name and runs the lookup in one go.
describe('WatchlistScreen — the filmography box autocompletes people from your library', () => {
  async function typing (text) {
    axios.get.mockReset();
    axios.get.mockImplementation((url) => {
      if (url.includes('/search/person')) return Promise.resolve({ data: { results: [{ id: 900, name: 'Fave Director', gender: 2 }] } });
      if (url.includes('/person/900/movie_credits')) return Promise.resolve({ data: { cast: [], crew: [] } });
      return Promise.resolve({ data: { results: [], cast: [], crew: [] } });
    });
    const { wrapper } = factory();
    await flushPromises();
    axios.get.mockClear();
    const input = wrapper.find('.person-section .prompt-input');
    await input.trigger('focus');
    await input.setValue(text);
    return { wrapper, input };
  }

  it('offers the directors and cast you have rated, described like the search bar does', async () => {
    const { wrapper } = await typing('fav');
    const rows = wrapper.findAll('.person-section .typeahead-row');
    // Same ranking as the search bar: within a tier, alphabetical.
    expect(rows.map((r) => r.find('.typeahead-term').text())).toEqual(['Fave Actor', 'Fave Director']);
    expect(rows).toHaveLength(2);
    expect(rows[0].find('.typeahead-meta').text()).toBe('cast · 2 films');
    expect(rows[1].find('.typeahead-meta').text()).toBe('director · 2 films');
  });

  it('offers nothing for a name that is not in the library, so Find still does the work', async () => {
    const { wrapper } = await typing('greta');
    expect(wrapper.find('.person-section .typeahead-panel').exists()).toBe(false);
  });

  it('a tap fills the name and runs the lookup', async () => {
    const { wrapper, input } = await typing('fav');
    const director = wrapper.findAll('.person-section .typeahead-row').find((r) => r.text().includes('Fave Director'));
    await director.trigger('click');
    await flushPromises();
    expect(input.element.value).toBe('Fave Director');
    expect(axios.get.mock.calls.some(([url]) => url.includes('/search/person') && url.includes('query=Fave%20Director'))).toBe(true);
    expect(wrapper.find('.person-section .typeahead-panel').exists()).toBe(false);
  });

  it('escape closes it until the next keystroke, and blur closes it too', async () => {
    const { wrapper, input } = await typing('fav');
    expect(wrapper.find('.person-section .typeahead-panel').exists()).toBe(true);
    await input.trigger('keydown', { key: 'Escape' });
    expect(wrapper.find('.person-section .typeahead-panel').exists()).toBe(false);
    await input.setValue('fave');
    expect(wrapper.find('.person-section .typeahead-panel').exists()).toBe(true);
    await input.trigger('blur');
    expect(wrapper.find('.person-section .typeahead-panel').exists()).toBe(false);
  });
});
