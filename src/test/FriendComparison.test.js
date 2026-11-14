import { describe, it, expect, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import FriendComparison from '@/components/FriendComparison.vue';

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => ({ calculatedTotal: media?.ratings?.[0]?.calculatedTotal ?? 0 }))
}));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function movie (id, title, rating) {
  return {
    dbKey: `k${id}`,
    ratings: [{ calculatedTotal: rating, date: Date.now() - DAY }],
    movie: { id, title, poster_path: `/${id}.jpg`, release_date: '2001-06-15' }
  };
}

function factory ({ profile, myEntries = [] } = {}) {
  const wrapper = shallowMount(FriendComparison, {
    global: {
      mocks: {
        $store: {
          state: { settings: {} },
          getters: {
            allMoviesAsArray: myEntries,
            filmClubProfiles: { 'friend-key': profile }
          },
          dispatch: vi.fn(() => Promise.resolve())
        },
        $route: { params: { friendKey: 'friend-key' } },
        $router: { push: vi.fn() }
      }
    }
  });
  return { wrapper };
}

const PROFILE = {
  name: 'Brian',
  counts: { titles: 3 },
  ratings: {
    1: { r: 9 },
    2: { r: 4 }
  },
  recent: [
    { id: 1, t: 'Heat', p: '/1.jpg', r: 9, at: Date.now() - 3 * HOUR },
    { id: 2, t: 'Cats', p: '/2.jpg', r: 4, at: Date.now() - 5 * DAY },
    { id: 9, t: 'No Timestamp', p: '/9.jpg', r: 7, at: null }
  ]
};

describe('FriendComparison', () => {
  // "Somewhere on the individual person's page, I should see their most recent
  // views... And it should be higher up on their page." (Matt, 2026-08-16)
  it("shows the friend's recent viewings, newest first, skipping undated ones", () => {
    const { wrapper } = factory({ profile: PROFILE, myEntries: [movie(1, 'Heat', 8)] });

    expect(wrapper.vm.recentViews.map((item) => item.t)).toEqual(['Heat', 'Cats']);
  });

  it('labels each recent viewing with how long ago it was', () => {
    const { wrapper } = factory({ profile: PROFILE, myEntries: [movie(1, 'Heat', 8)] });

    expect(wrapper.vm.watchedAgo({ at: Date.now() - 3 * HOUR })).toBe('3 hours ago');
    expect(wrapper.vm.watchedAgo({ at: Date.now() - 5 * DAY })).toBe('5 days ago');
    expect(wrapper.vm.watchedAgo({ at: null })).toBeNull();
  });

  it('puts what to watch above the analysis of how you differ', () => {
    const { wrapper } = factory({ profile: PROFILE, myEntries: [movie(1, 'Heat', 9), movie(2, 'Cats', 8)] });
    const order = wrapper.findAll('.fc-section-title').map((title) => title.text());

    const recent = order.findIndex((text) => /recently watched/i.test(text));
    const differ = order.findIndex((text) => /tastes differ/i.test(text));
    const disagreements = order.findIndex((text) => /disagreements/i.test(text));

    expect(recent).toBeGreaterThanOrEqual(0);
    expect(recent).toBeLessThan(differ === -1 ? Infinity : differ);
    expect(recent).toBeLessThan(disagreements === -1 ? Infinity : disagreements);
  });

  // "I don't really know what alignment means... it's telling me two different
  // numbers, but I may be able to [use] some more context."
  it('explains alignment and the log scores in words', () => {
    const { wrapper } = factory({ profile: PROFILE, myEntries: [movie(1, 'Heat', 9), movie(2, 'Cats', 8)] });
    const notes = wrapper.findAll('.fc-strip-note').map((note) => note.text()).join(' ');

    expect(notes).toMatch(/Alignment.*10 minus/i);
    expect(notes).toMatch(/typically land/i);
  });

  it('drops the unexplained "log scores" pair from the headline strip', () => {
    const { wrapper } = factory({ profile: PROFILE, myEntries: [movie(1, 'Heat', 9), movie(2, 'Cats', 8)] });

    expect(wrapper.findAll('.fc-strip-label').map((label) => label.text()))
      .toEqual(['alignment', 'your average', 'their average']);
  });

  it('survives a friend with no recent list at all', () => {
    const { wrapper } = factory({ profile: { name: 'Quiet', counts: { titles: 0 } } });

    expect(wrapper.vm.recentViews).toEqual([]);
  });

  // Matt, 2026-11-13: "look through one of my friends … whole library and …
  // search by year or by genre or by whatever category I want".
  describe("their library", () => {
    const LIB = {
      name: 'Seth',
      counts: { titles: 3 },
      ratings: {
        949: { r: 9.1, t: 'Heat', at: Date.UTC(2024, 0, 5), y: 1995, g: [80], d: ['Michael Mann'] },
        603: { r: 8, t: 'The Matrix', at: Date.UTC(2023, 0, 5) },
        5: { r: 6, t: 'Tiny', at: Date.UTC(2023, 0, 5), y: 2010, sh: 1 }
      }
    };

    it('lists every film they share, best first, shorts left out', () => {
      const { wrapper } = factory({ profile: LIB });
      const titles = wrapper.findAll('.fc-library-row .fc-row-name').map((el) => el.text());
      expect(titles).toEqual(['Heat (1995)', 'The Matrix']);
    });

    it('narrows by a chip and by the search box', async () => {
      const { wrapper } = factory({ profile: LIB, myEntries: [{ movie: { id: 603, release_date: '1999-03-31', genres: [{ id: 878 }] }, ratings: [] }] });
      const genre = wrapper.findAll('.fc-facet').find((b) => b.text() === 'Genre');
      await genre.trigger('click');
      const scifi = wrapper.findAll('.fc-option').find((b) => b.text().startsWith('Science Fiction'));
      await scifi.trigger('click');
      expect(wrapper.findAll('.fc-library-row .fc-row-name').map((el) => el.text())).toEqual(['The Matrix (1999)']);

      await wrapper.find('.fc-chip').trigger('click');
      await wrapper.find('.fc-library-search').setValue('mann');
      expect(wrapper.findAll('.fc-library-row .fc-row-name').map((el) => el.text())).toEqual(['Heat (1995)']);
    });

    // Matt, 2026-11-13: "fit it into the same size vertical space and
    // internally scroll" — the rows live in the capped scroll box, and the
    // next page loads near its bottom instead of behind a Show more button.
    describe('the scrolling box', () => {
      const BIG = {
        name: 'Seth',
        counts: { titles: 95 },
        ratings: Object.fromEntries(Array.from({ length: 95 }, (_, i) => [1000 + i, { r: 9 - i / 100, t: `Film ${i}`, at: Date.UTC(2024, 0, 1) }]))
      };
      const scrollTo = async (box, { top, client = 300, height = 2000 }) => {
        Object.defineProperty(box.element, 'clientHeight', { value: client, configurable: true });
        Object.defineProperty(box.element, 'scrollHeight', { value: height, configurable: true });
        box.element.scrollTop = top;
        await box.trigger('scroll');
      };

      it('holds every row inside the capped scroll list, with no Show more button', () => {
        const { wrapper } = factory({ profile: BIG });
        const box = wrapper.find('.fc-library .fc-scroll-list');
        expect(box.exists()).toBe(true);
        expect(box.findAll('.fc-library-row')).toHaveLength(40);
        expect(wrapper.findAll('.fc-library-row')).toHaveLength(40);
        expect(wrapper.find('.fc-library').text()).not.toMatch(/Show more/);
      });

      it('loads the next forty near the bottom, and only there', async () => {
        const { wrapper } = factory({ profile: BIG });
        const box = wrapper.find('.fc-library-list');
        await scrollTo(box, { top: 100 });
        expect(wrapper.findAll('.fc-library-row')).toHaveLength(40);
        await scrollTo(box, { top: 1500 });
        expect(wrapper.findAll('.fc-library-row')).toHaveLength(80);
        await scrollTo(box, { top: 3500, height: 4000 });
        expect(wrapper.findAll('.fc-library-row')).toHaveLength(95);
      });

      it('starts over at the top when the search or sort changes', async () => {
        const { wrapper } = factory({ profile: BIG });
        const box = wrapper.find('.fc-library-list');
        await scrollTo(box, { top: 1500 });
        expect(wrapper.findAll('.fc-library-row')).toHaveLength(80);
        await wrapper.find('.fc-library-search').setValue('Film');
        expect(wrapper.findAll('.fc-library-row')).toHaveLength(40);
        expect(box.element.scrollTop).toBe(0);
        await scrollTo(box, { top: 1500 });
        await wrapper.find('.fc-sort select').setValue('title');
        expect(box.element.scrollTop).toBe(0);
        expect(wrapper.findAll('.fc-library-row')).toHaveLength(40);
      });
    });

    // Report, 2026-11-13: "I'm only seeing movies on Matt's list that I have
    // also seen." The rows are all theirs; say which I've rated, and say when
    // a chip couldn't place films rather than hiding them.
    it('marks the films I have rated with my score', () => {
      const { wrapper } = factory({ profile: LIB, myEntries: [movie(603, 'The Matrix', 7.85)] });
      const rows = wrapper.findAll('.fc-library-row');
      expect(rows[0].find('.fc-library-mine').exists()).toBe(false);
      expect(rows[1].find('.fc-library-mine').text()).toBe('You: 7.85');
    });

    it('says how many films a chip could not place yet', async () => {
      const { wrapper } = factory({ profile: LIB });
      expect(wrapper.find('.fc-library-unknown').exists()).toBe(false);
      await wrapper.findAll('.fc-facet').find((b) => b.text() === 'Genre').trigger('click');
      await wrapper.findAll('.fc-option').find((b) => b.text().startsWith('Crime')).trigger('click');
      expect(wrapper.findAll('.fc-library-row .fc-row-name').map((el) => el.text())).toEqual(['Heat (1995)']);
      expect(wrapper.find('.fc-library-unknown').text()).toMatch(/1 more film might fit.*Seth's\s+app hasn't sent its genre yet/s);
    });

    it('is absent for a friend who shares only their shelf', () => {
      const { wrapper } = factory({ profile: { ...PROFILE, ratings: undefined } });
      expect(wrapper.find('.fc-library').exists()).toBe(false);
    });
  });
});

// Report, 2026-11-14: tapping a film in a friend's library "just took me back
// to the friends list". MovieDetail only knows MY library and bounces any other
// film to /film-club, so a film I haven't rated must open the preview sheet.
describe("FriendComparison: tapping a friend's film", () => {
  const LIBRARY_PROFILE = {
    name: 'Matt',
    counts: { titles: 2 },
    ratings: {
      1: { r: 9, t: 'Heat', p: '/1.jpg', at: Date.now() - DAY },
      7: { r: 8, t: 'Sinners', p: '/7.jpg', at: Date.now() - 2 * DAY }
    }
  };

  function rowFor (wrapper, title) {
    return wrapper.findAll('.fc-library-row').find((row) => row.text().includes(title));
  }

  it('opens the preview sheet for a film I have not rated, not my movie page', async () => {
    const { wrapper } = factory({ profile: LIBRARY_PROFILE, myEntries: [movie(1, 'Heat', 8)] });

    await rowFor(wrapper, 'Sinners').trigger('click');

    expect(wrapper.vm.$router.push).not.toHaveBeenCalled();
    const preview = wrapper.findComponent({ name: 'MoviePreview' });
    expect(preview.props('movie')).toMatchObject({ id: 7, title: 'Sinners', poster_path: '/7.jpg' });
  });

  it('still opens my own movie page for a film I have rated', async () => {
    const { wrapper } = factory({ profile: LIBRARY_PROFILE, myEntries: [movie(1, 'Heat', 8)] });

    await rowFor(wrapper, 'Heat').trigger('click');

    expect(wrapper.vm.$router.push).toHaveBeenCalledWith('/movie/1');
    expect(wrapper.vm.previewing).toBeNull();
  });

  it('rating from the sheet goes to the rating page with that film', () => {
    const { wrapper } = factory({ profile: LIBRARY_PROFILE, myEntries: [] });
    wrapper.vm.$store.commit = vi.fn();

    wrapper.vm.openFilm(7, 'Sinners', '/7.jpg');
    wrapper.vm.rateFromPreview(wrapper.vm.previewing.source);

    expect(wrapper.vm.$store.commit).toHaveBeenCalledWith('setMovieToRate', expect.objectContaining({ id: 7, title: 'Sinners' }));
    expect(wrapper.vm.$router.push).toHaveBeenCalledWith('/rate-movie');
    expect(wrapper.vm.previewing).toBeNull();
  });
});
