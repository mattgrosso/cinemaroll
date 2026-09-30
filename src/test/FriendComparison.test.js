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
});
