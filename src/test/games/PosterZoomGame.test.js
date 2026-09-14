import { describe, it, expect, vi, beforeEach } from 'vitest';
import { reactive } from 'vue';
import { mount } from '@vue/test-utils';
import PosterZoomGame from '@/components/games/PosterZoomGame.vue';
import { ZOOM_LEVELS } from '@/assets/javascript/games/posterZoom.js';

function entry (id, posterPath = '/p.jpg') {
  return {
    dbKey: `key-${id}`,
    ratings: [{ calculatedTotal: 5 }],
    movie: { id, title: `Movie ${id}`, poster_path: posterPath, release_date: '1994-06-15' }
  };
}

const tenMovies = () => Array.from({ length: 10 }, (_, i) => entry(i));

function factory (movies, { dispatch = vi.fn(), settings = {} } = {}) {
  const commit = vi.fn();
  const push = vi.fn();
  const wrapper = mount(PosterZoomGame, {
    global: {
      mocks: {
        $store: {
          state: { settings, bannerUrl: 'previous-banner.jpg' },
          getters: { allMediaAsArray: movies },
          dispatch,
          commit
        },
        $router: { push },
        // recordGameWin derives its key from the route (see gameData.js).
        $route: { path: '/games/poster-zoom' }
      },
      stubs: { NewRatingSearch: true }
    }
  });
  return { wrapper, dispatch, commit, push };
}

// The target is random, so tests that need a specific outcome look up which
// entry was actually chosen rather than assuming one.
const targetOf = (wrapper) => wrapper.vm.target;
const somethingElse = (wrapper, movies) =>
  movies.find((m) => m.dbKey !== targetOf(wrapper).dbKey);

beforeEach(() => {
  window.localStorage.clear();
});

describe('PosterZoomGame', () => {
  describe('poster sizing has no JS measurement (Natalie: poster "smaller than my thumb")', () => {
    // This screen once measured its own height in JS — resize +
    // orientationchange + focusout + two ResizeObservers — because the
    // poster's height came from the image inside it, whose height was 100%
    // of the poster. That circle could collapse the poster to a thumbnail,
    // and each added listener was a patch on the last failure. The poster is
    // now pinned to the stage in CSS, so there is nothing to measure and
    // nothing to get wrong on rotation or when the keyboard opens.
    it('registers no resize, orientation or focus listeners', () => {
      const added = []
      const realAdd = window.addEventListener
      window.addEventListener = (type, ...rest) => { added.push(type); return realAdd.call(window, type, ...rest) }

      try {
        factory(tenMovies())
      } finally {
        window.addEventListener = realAdd
      }

      expect(added).not.toContain('resize')
      expect(added).not.toContain('orientationchange')
      expect(added).not.toContain('focusout')
    })

    it('puts no inline height on the poster box', () => {
      const { wrapper } = factory(tenMovies())
      const viewport = wrapper.find('.zoom-viewport')
      expect(viewport.exists()).toBe(true)
      expect(viewport.attributes('style') || '').not.toMatch(/height/)
    })
  })

  describe('gating', () => {
    it('asks for more movies when the library is too small', () => {
      const { wrapper } = factory([entry(1), entry(2)]);
      expect(wrapper.find('.not-enough-movies').exists()).toBe(true);
      expect(wrapper.find('.zoom-viewport').exists()).toBe(false);
    });

    it('ignores entries with no poster, since the poster IS the game', () => {
      // Six with posters, four without — only the six can be zoomed.
      const movies = [...Array.from({ length: 4 }, (_, i) => entry(i, null)), entry(10), entry(11)];
      const { wrapper } = factory(movies);
      expect(wrapper.vm.zoomablePool).toHaveLength(2);
      expect(wrapper.find('.not-enough-movies').exists()).toBe(true);
    });
  });

  describe('starting a round', () => {
    it('starts fully zoomed in on a movie that has a poster', () => {
      const { wrapper } = factory(tenMovies());
      expect(wrapper.vm.zoomIndex).toBe(0);
      expect(wrapper.vm.status).toBe('playing');
      expect(targetOf(wrapper).movie.poster_path).toBeTruthy();
      expect(wrapper.find('.zoom-image').attributes('style')).toContain(`scale(${ZOOM_LEVELS[0]})`);
    });

    it('requests the largest poster available, since it gets magnified 16x', () => {
      // The crop is upscaled from about a sixteenth of the image, so every
      // source pixel counts.
      const { wrapper } = factory(tenMovies());
      expect(wrapper.find('.zoom-image').attributes('src')).toContain('/original/');
    });

    it('does not name the movie in the alt text while it is still the answer', () => {
      const { wrapper } = factory(tenMovies());
      const alt = wrapper.find('.zoom-image').attributes('alt');
      expect(alt).not.toContain(targetOf(wrapper).movie.title);
    });

    it('zooms from an off-centre focal point', () => {
      const { wrapper } = factory(tenMovies());
      const style = wrapper.find('.zoom-image').attributes('style');
      // Without transform-origin every poster would zoom out from the middle
      // and the crop would carry no information.
      expect(style).toMatch(/transform-origin:\s*\d+% \d+%/);
    });
  });

  describe('zooming out', () => {
    it('steps out one level when the poster is tapped', async () => {
      // The poster is the control — it's the biggest target on screen and
      // the only action the round needs.
      const { wrapper } = factory(tenMovies());
      await wrapper.find('.zoom-viewport').trigger('click');

      expect(wrapper.vm.zoomIndex).toBe(1);
      expect(wrapper.vm.zoomOuts).toBe(1);
      expect(wrapper.find('.zoom-image').attributes('style')).toContain(`scale(${ZOOM_LEVELS[1]})`);
    });

    it('is reachable by keyboard, not only by tap', async () => {
      const { wrapper } = factory(tenMovies());
      const poster = wrapper.find('.zoom-viewport');

      expect(poster.attributes('role')).toBe('button');
      expect(poster.attributes('tabindex')).toBe('0');

      await poster.trigger('keydown.enter');
      expect(wrapper.vm.zoomIndex).toBe(1);
    });

    it('stops at the whole poster and stops being a control', async () => {
      const { wrapper } = factory(tenMovies());
      for (let i = 0; i < ZOOM_LEVELS.length + 3; i++) wrapper.vm.zoomOut();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.zoomIndex).toBe(ZOOM_LEVELS.length - 1);
      const poster = wrapper.find('.zoom-viewport');
      expect(poster.classes()).not.toContain('tappable');
      expect(poster.attributes('role')).toBeUndefined();
    });

    it('tells you the poster is tappable, since no button says so', () => {
      const { wrapper } = factory(tenMovies());
      expect(wrapper.find('.status-line').text()).toMatch(/tap the poster/i);
    });

    it('is not a control once the round is over', async () => {
      const { wrapper } = factory(tenMovies());
      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      const poster = wrapper.find('.zoom-viewport');
      expect(poster.classes()).not.toContain('tappable');
      await poster.trigger('click');
      expect(wrapper.vm.status).toBe('won');
    });
  });

  // Report -P1Px9lCmg (2026-09-13): typing "8" found nothing, so 8½ could
  // not be guessed at all. Driven through the input, the way the thumb did.
  describe('guess typeahead (report -P1Px9lCmg: "8" could not find 8½)', () => {
    it('offers 8½ after a single typed character', async () => {
      const movies = tenMovies();
      movies[3].movie.title = '8½';
      const { wrapper } = factory(movies);

      const input = wrapper.find('.game-input');
      await input.setValue('8');

      expect(wrapper.findAll('.suggestion-item').map((item) => item.text())).toContain('8½ (1994)');
    });

    it('offers 8½ typed as 8 1/2', async () => {
      const movies = tenMovies();
      movies[3].movie.title = '8½';
      const { wrapper } = factory(movies);

      await wrapper.find('.game-input').setValue('8 1/2');

      expect(wrapper.findAll('.suggestion-item').map((item) => item.text())).toEqual(['8½ (1994)']);
    });
  });

  describe('guessing', () => {
    it('wins on the right movie and records the score', async () => {
      const dispatch = vi.fn();
      const movies = tenMovies();
      const { wrapper } = factory(movies, { dispatch });
      wrapper.vm.zoomOut();

      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.status).toBe('won');
      const best = dispatch.mock.calls.find(([, p]) => p?.path === 'settings/games/posterZoomBestZoomOuts');
      expect(best[1].value).toBe(1);
    });

    it('costs a zoom-out on a wrong guess rather than ending the round', async () => {
      const movies = tenMovies();
      const { wrapper } = factory(movies);

      wrapper.vm.submitGuess(somethingElse(wrapper, movies));
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.status).toBe('playing');
      expect(wrapper.vm.zoomOuts).toBe(1);
      expect(wrapper.find('.status-line').text()).toMatch(/Not Movie \d+/);
    });

    it('never overwrites a better score with a worse one', async () => {
      const dispatch = vi.fn();
      const { wrapper } = factory(tenMovies(), {
        dispatch,
        settings: { games: { posterZoomBestZoomOuts: 0 } }
      });
      wrapper.vm.zoomOut();
      wrapper.vm.zoomOut();
      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      expect(dispatch.mock.calls.some(([, p]) => p?.path === 'settings/games/posterZoomBestZoomOuts')).toBe(false);
    });

    it('marks the game won today', async () => {
      const dispatch = vi.fn();
      const { wrapper } = factory(tenMovies(), { dispatch });
      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      expect(dispatch).toHaveBeenCalledWith('writeDurably',
        expect.objectContaining({ path: 'settings/games/wins/poster-zoom' }));
    });

    it('reveals the whole poster once the round is over', async () => {
      const { wrapper } = factory(tenMovies());
      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.zoom-image').attributes('style')).toContain('scale(1)');
      expect(wrapper.find('.reveal-title').text()).toContain(targetOf(wrapper).movie.title);
    });
  });

  describe('giving up', () => {
    it('ends the round with no score recorded', async () => {
      const dispatch = vi.fn();
      const { wrapper } = factory(tenMovies(), { dispatch });
      await wrapper.find('.give-up').trigger('click');

      expect(wrapper.vm.status).toBe('revealed');
      expect(dispatch.mock.calls.some(([, p]) => p?.path === 'settings/games/posterZoomBestZoomOuts')).toBe(false);
      expect(wrapper.find('.zoom-image').attributes('style')).toContain('scale(1)');
    });
  });

  describe('new round', () => {
    it('does not hand back the movie just finished', async () => {
      const movies = [entry(1), entry(2), entry(3), entry(4), entry(5)];
      const { wrapper } = factory(movies);
      const first = targetOf(wrapper).dbKey;

      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();
      await wrapper.find('.end-actions .btn-game-primary').trigger('click');

      expect(targetOf(wrapper).dbKey).not.toBe(first);
      expect(wrapper.vm.zoomIndex).toBe(0);
      expect(wrapper.vm.status).toBe('playing');
    });
  });

  describe('persistence', () => {
    it('resumes an in-progress round with the same crop', () => {
      const movies = tenMovies();
      const { wrapper } = factory(movies);
      wrapper.vm.zoomOut();
      wrapper.vm.zoomOut();
      const { dbKey } = targetOf(wrapper);
      const origin = { ...wrapper.vm.origin };

      const { wrapper: resumed } = factory(movies);

      expect(targetOf(resumed).dbKey).toBe(dbKey);
      expect(resumed.vm.zoomIndex).toBe(2);
      // The focal point is random, so it has to be stored — recomputing it
      // would quietly turn a resumed round into a different puzzle.
      expect(resumed.vm.origin).toEqual(origin);
    });

    it('does not resume a round that was already won', async () => {
      const movies = tenMovies();
      const { wrapper } = factory(movies);
      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      const { wrapper: fresh } = factory(movies);
      expect(fresh.vm.status).toBe('playing');
      expect(fresh.vm.zoomIndex).toBe(0);
    });

    it('starts fresh when the saved movie is no longer in the library', () => {
      window.localStorage.setItem('cinemaRoll.posterZoom.current', JSON.stringify({
        targetKey: 'key-does-not-exist', zoomIndex: 3, origin: { x: 30, y: 30 }
      }));

      const { wrapper } = factory(tenMovies());
      expect(wrapper.vm.status).toBe('playing');
      expect(wrapper.vm.zoomIndex).toBe(0);
      expect(targetOf(wrapper)).toBeTruthy();
    });

    it('survives a corrupt saved origin rather than rendering NaN', () => {
      const movies = tenMovies();
      window.localStorage.setItem('cinemaRoll.posterZoom.current', JSON.stringify({
        targetKey: movies[0].dbKey, zoomIndex: 1, origin: { x: 'nope' }
      }));

      const { wrapper } = factory(movies);
      expect(wrapper.vm.origin).toEqual({ x: 50, y: 50 });
      expect(wrapper.find('.zoom-image').attributes('style')).toContain('50% 50%');
    });
  });

  describe('empty library recovery', () => {
    it('picks a round once the library finally loads', async () => {
      // Same empty-then-populated race every other game guards against: a
      // direct/deep-link load can mount before Firebase data arrives, and
      // must not give up permanently. Getters are reactive() so the mock is
      // genuinely trackable.
      const getters = reactive({ allMediaAsArray: [] });
      const wrapper = mount(PosterZoomGame, {
        global: {
          mocks: {
            $store: { getters, state: { settings: {} }, dispatch: vi.fn(), commit: vi.fn() },
            $router: { push: vi.fn() },
            $route: { path: '/games/poster-zoom' }
          },
          stubs: { NewRatingSearch: true }
        }
      });

      expect(wrapper.vm.target).toBeNull();

      getters.allMediaAsArray = tenMovies();
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.target).toBeTruthy();
      expect(wrapper.vm.status).toBe('playing');
    });
  });

  describe('showing what you actually saw', () => {
    const reveal = async (wrapper) => {
      wrapper.vm.imageLoaded = true;
      wrapper.vm.originSettled = true;
      await wrapper.vm.$nextTick();
    };

    it('outlines the crop you guessed from, over the revealed poster', async () => {
      const { wrapper } = factory(tenMovies());
      await reveal(wrapper);
      wrapper.vm.zoomOut();
      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      const outline = wrapper.find('.crop-outline');
      expect(outline.exists()).toBe(true);
      // 1 zoom-out means level index 1, so the box is 100/ZOOM_LEVELS[1] wide.
      expect(outline.attributes('style')).toContain(`width: ${100 / ZOOM_LEVELS[1]}%`);
    });

    it('is not drawn when the round was lost or given up', async () => {
      const { wrapper } = factory(tenMovies());
      await reveal(wrapper);
      await wrapper.find('.give-up').trigger('click');

      expect(wrapper.find('.crop-outline').exists()).toBe(false);
    });

    it('is not drawn when the win came from the whole poster anyway', async () => {
      // Boxing the entire image says nothing.
      const { wrapper } = factory(tenMovies());
      await reveal(wrapper);
      for (let i = 0; i < ZOOM_LEVELS.length; i++) wrapper.vm.zoomOut();
      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.isFullyOut).toBe(true);
      expect(wrapper.find('.crop-outline').exists()).toBe(false);
    });

    it('waits for the poster before drawing over it', async () => {
      const { wrapper } = factory(tenMovies());
      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      expect(wrapper.vm.posterReady).toBe(false);
      expect(wrapper.find('.crop-outline').exists()).toBe(false);
    });

    it('says so in the status line', async () => {
      const { wrapper } = factory(tenMovies());
      await reveal(wrapper);
      wrapper.vm.zoomOut();
      wrapper.vm.submitGuess(targetOf(wrapper));
      await wrapper.vm.$nextTick();

      expect(wrapper.find('.status-line').text()).toContain('all you saw');
    });
  });

  describe('not spoiling the poster', () => {
    it('keeps the poster hidden until it has loaded AND settled on a crop', async () => {
      // Revealing early lets you watch it zoom in from the full poster, or
      // lets the crop jump when scoring resolves. Either shows more than the
      // round is meant to.
      const { wrapper } = factory(tenMovies());
      expect(wrapper.vm.posterReady).toBe(false);
      expect(wrapper.find('.zoom-image').classes()).not.toContain('ready');
      expect(wrapper.find('.zoom-loading').exists()).toBe(true);

      wrapper.vm.imageLoaded = true;
      await wrapper.vm.$nextTick();
      // Image is in, but the focal point hasn't settled — still hidden.
      expect(wrapper.vm.posterReady).toBe(false);

      wrapper.vm.originSettled = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.posterReady).toBe(true);
      expect(wrapper.find('.zoom-image').classes()).toContain('ready');
      expect(wrapper.find('.zoom-loading').exists()).toBe(false);
    });

    it('deals a different movie when the poster URL is dead', async () => {
      // Bug report: a broken URL rendered as a black square you were then
      // asked to identify.
      const { wrapper } = factory(tenMovies());
      const broken = targetOf(wrapper).dbKey;

      // First error retries the SAME poster at the likely-cached w500 size
      // (offline audit 2026-08-15); the second gives up on the movie.
      await wrapper.find('.zoom-image').trigger('error');
      expect(wrapper.vm.posterSizeFallback).toBe('w500');
      expect(targetOf(wrapper).dbKey).toBe(broken);
      await wrapper.find('.zoom-image').trigger('error');

      expect(wrapper.vm.failedPosterKeys).toContain(broken);
      expect(targetOf(wrapper).dbKey).not.toBe(broken);
      expect(wrapper.vm.zoomIndex).toBe(0);
    });

    it('never deals a known-broken poster again this session', async () => {
      const { wrapper } = factory(tenMovies());
      const broken = targetOf(wrapper).dbKey;
      await wrapper.find('.zoom-image').trigger('error'); // w500 retry
      await wrapper.find('.zoom-image').trigger('error');

      expect(wrapper.vm.zoomablePool.map((e) => e.dbKey)).not.toContain(broken);
      for (let i = 0; i < 20; i++) {
        wrapper.vm.startNewRound();
        expect(targetOf(wrapper).dbKey).not.toBe(broken);
      }
    });

    it('falls back to the gate rather than looping as posters run out', async () => {
      // Each failure removes exactly one entry from a finite pool, so this
      // terminates. Six movies, two broken, leaves four — below the gate.
      const { wrapper } = factory([entry(1), entry(2), entry(3), entry(4), entry(5), entry(6)]);

      for (let i = 0; i < 6; i++) {
        const img = wrapper.find('.zoom-image');
        if (!img.exists()) break;
        await img.trigger('error');
      }

      expect(wrapper.vm.zoomablePool.length).toBeLessThan(5);
      expect(wrapper.find('.not-enough-movies').exists()).toBe(true);
      expect(wrapper.find('.zoom-image').exists()).toBe(false);
    });

    it('does not hang on "Focusing…" if there is genuinely nothing left to deal', () => {
      // Defensive branch: the gate normally takes over first, but if the pool
      // is ever empty at the moment of failure the round must still resolve.
      const { wrapper } = factory(tenMovies());
      wrapper.vm.failedPosterKeys = wrapper.vm.zoomablePool.map((e) => e.dbKey);

      wrapper.vm.onPosterError(); // w500 retry first
      wrapper.vm.onPosterError();

      expect(wrapper.vm.imageLoaded).toBe(true);
    });

    it('hides the poster again when a new round starts', async () => {
      const { wrapper } = factory(tenMovies());
      wrapper.vm.imageLoaded = true;
      wrapper.vm.originSettled = true;
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.posterReady).toBe(true);

      wrapper.vm.startNewRound();
      await wrapper.vm.$nextTick();
      expect(wrapper.vm.posterReady).toBe(false);
    });

    it('does not wait on crop scoring for a resumed round, which already has one', () => {
      const movies = tenMovies();
      const { wrapper } = factory(movies);
      wrapper.vm.zoomOut();

      const { wrapper: resumed } = factory(movies);
      expect(resumed.vm.originSettled).toBe(true);
      expect(resumed.vm.imageLoaded).toBe(false);
    });
  });


  describe('banner', () => {
    it('swaps in its own artwork and hides the logo, then restores both', () => {
      const { wrapper, commit } = factory(tenMovies());

      expect(commit).toHaveBeenCalledWith('setBannerUrl', expect.stringContaining('poster-zoom-banner'));
      expect(commit).toHaveBeenCalledWith('setHideHeaderLogo', true);

      wrapper.unmount();
      expect(commit).toHaveBeenCalledWith('setBannerUrl', 'previous-banner.jpg');
      expect(commit).toHaveBeenCalledWith('setHideHeaderLogo', false);
    });
  });
});

// Game Stats' "ones that got away" / "nailed it" poster rows (bug report
// -P0r4mFHYUfHFEpfwcpQ) need to know WHICH movie each round was.
describe('PosterZoomGame - round records carry the target movie key', () => {
  const lastHistoryRecord = (dispatch) => dispatch.mock.calls
    .find(([, entry]) => entry?.path === 'settings/games/history/poster-zoom')[1].value.at(-1);

  it('on a win and on a give-up', async () => {
    let dispatch = vi.fn();
    let { wrapper } = factory(tenMovies(), { dispatch });
    const wonKey = targetOf(wrapper).dbKey;
    wrapper.vm.submitGuess(targetOf(wrapper));
    expect(lastHistoryRecord(dispatch)).toMatchObject({ won: true, movie: wonKey });

    dispatch = vi.fn();
    ({ wrapper } = factory(tenMovies(), { dispatch }));
    const lostKey = targetOf(wrapper).dbKey;
    wrapper.vm.giveUp();
    expect(lastHistoryRecord(dispatch)).toMatchObject({ won: false, movie: lostKey });
  });
});
