import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import GamesHub from '@/components/games/GamesHub.vue';
import { LAST_PLAYED_KEY, todayStamp } from '@/mixins/gameData.js';

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 5 }))
}));

// The "not enough movies" gate now renders NewRatingSearch (suggestionsMode),
// which fetches TMDB popular movies in its own mounted() hook.
vi.mock('axios', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { results: [] } })) }
}));

function entry (id) {
  return {
    dbKey: `key-${id}`,
    ratings: [{ calculatedTotal: 5 }],
    movie: { id, title: `Movie ${id}`, poster_path: '/p.jpg', release_date: '2010-01-01' }
  };
}

function factory (movieCount, settings = {}) {
  const pushSpy = vi.fn();
  const wrapper = mount(GamesHub, {
    global: {
      mocks: {
        $store: {
          state: { settings },
          getters: { allMediaAsArray: Array.from({ length: movieCount }, (_, i) => entry(i)) }
        },
        $router: { push: pushSpy }
      }
    }
  });
  return { wrapper, pushSpy };
}

describe('GamesHub', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('clears the "last played game" record on mount (bug report: backing out to the hub should reset it)', () => {
    window.localStorage.setItem(LAST_PLAYED_KEY, '/games/wordle');
    factory(10);
    expect(window.localStorage.getItem(LAST_PLAYED_KEY)).toBeNull();
  });

  describe('play-count ordering (bug report: "the ones you played the most go to the top")', () => {
    it('orders tiles by recorded play sessions, most-played first', () => {
      const { wrapper } = factory(10, { games: { plays: { stamp: 5, wordle: 2 } } });
      const alts = wrapper.findAll('.game-tile-image').map((img) => img.attributes('alt'));
      expect(alts[0]).toBe('Stamp');
      expect(alts[1]).toBe('Reel Wordle');
      expect(alts).toHaveLength(12);
    });

    it('keeps the hand-curated order for ties, including the no-plays default', () => {
      const { wrapper } = factory(10);
      const alts = wrapper.findAll('.game-tile-image').map((img) => img.attributes('alt'));
      expect(alts[0]).toBe('Higher or Lower');
      expect(alts[alts.length - 1]).toBe('Cineplexity');
    });
  });

  it('shows a gate message when the library is too small', () => {
    const { wrapper } = factory(2);
    expect(wrapper.find('.not-enough-movies').exists()).toBe(true);
    expect(wrapper.findAll('.game-tile').length).toBe(0);
  });

  it('offers "help me get started" quick-pick suggestions on the gate (bug report: no way forward for a new user)', () => {
    const { wrapper } = factory(2);
    // NewRatingSearch renders its own loading spinner synchronously before
    // the (mocked) TMDB fetch resolves - just confirm the component mounted
    // inside the gate rather than asserting on its post-fetch content.
    expect(wrapper.find('.not-enough-movies .new-rating-search').exists()).toBe(true);
  });

  it('lists all games once there is enough data', () => {
    const { wrapper } = factory(10);
    expect(wrapper.findAll('.game-tile').length).toBe(12);
  });

  it('navigates to the chosen game route on tap', async () => {
    const { wrapper, pushSpy } = factory(10);
    await wrapper.findAll('.game-tile')[0].trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/games/higher-lower');
  });

  // Scroll-to-top on entering a game moved to the router's scrollBehavior
  // (see scrollBehavior.test.js) - this component must NOT also do it, or
  // there'd be two competing mechanisms for the same thing.
  it('leaves scroll-to-top to the router rather than doing it itself', async () => {
    const { wrapper, pushSpy } = factory(10);
    await wrapper.findAll('.game-tile')[0].trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/games/higher-lower');
    expect(window.scrollTo).not.toHaveBeenCalled();
  });

  // Feature request: "it would be nice to have a checkmark on the game if
  // I've won a game of that today. Then I'll be able to play each one each
  // day and feel satisfied." Explicitly NOT a play limit.
  describe('won-today checkmarks', () => {
    it('shows no checkmarks when nothing has been won today', () => {
      const { wrapper } = factory(10);
      expect(wrapper.findAll('.won-today')).toHaveLength(0);
    });

    it('marks only the games whose stored stamp is today', () => {
      const { wrapper } = factory(10, {
        games: { wins: { wordle: todayStamp(), connections: todayStamp() } }
      });

      expect(wrapper.findAll('.won-today')).toHaveLength(2);
      const markedTiles = wrapper.findAll('.game-tile').filter((t) => t.find('.won-today').exists());
      // Tiles are identified by their artwork's alt text now — the game name
      // lives in the banner image rather than a separate label.
      expect(markedTiles.map((t) => t.find('img').attributes('alt'))).toEqual(['Reel Wordle', 'Connections']);
    });

    it('ignores a stamp from a previous day (nothing to expire or clear)', () => {
      const { wrapper } = factory(10, {
        games: { wins: { wordle: new Date('2020-05-05T12:00:00').toDateString() } }
      });
      expect(wrapper.findAll('.won-today')).toHaveLength(0);
    });

    it('never gates play - a won game is still tappable', async () => {
      const { wrapper, pushSpy } = factory(10, { games: { wins: { 'higher-lower': todayStamp() } } });
      await wrapper.findAll('.game-tile')[0].trigger('click');
      expect(pushSpy).toHaveBeenCalledWith('/games/higher-lower');
    });
  });
});
