import { describe, it, expect, vi, afterEach } from 'vitest';
import { mount } from '@vue/test-utils';
import YouOrCrowdGame from '@/components/games/YouOrCrowdGame.vue';

vi.mock('@/assets/javascript/GetRating.js', () => ({
  // Score equals the id (0–19 on a 0–10 scale is fine: stars are just id / 2).
  getRating: vi.fn((entry) => ({ normalizedRating: entry.movie.id }))
}));

function entry (id) {
  return {
    dbKey: `key-${id}`,
    ratings: [{ calculatedTotal: id }],
    movie: { id, title: `Movie ${id}`, poster_path: '/p.jpg', release_date: '2010-01-01' }
  };
}

// The crowd gives every film 4.8 stars: my stars (id / 2) beat that from
// id 11 up, and the crowd wins ids 0–8 — 9 of each, so the balanced deck
// holds 18 films (9 and 10 are near-ties and sit out).
function flatCrowd (count) {
  const films = {};
  for (let i = 0; i < count; i += 1) films[i] = { rating: 4.8, ratingCount: 1000 };
  return films;
}

function factory (movieCount, films) {
  const dispatch = vi.fn();
  const wrapper = mount(YouOrCrowdGame, {
    global: {
      mocks: {
        $store: { state: { settings: {}, letterboxdFilms: films }, getters: { allMediaAsArray: Array.from({ length: movieCount }, (_, i) => entry(i)) }, dispatch, commit: vi.fn() },
        $router: { push: vi.fn() },
        $route: { path: '/games/you-or-crowd' }
      }
    }
  });
  return { wrapper, dispatch };
}

const rightSide = (vm) => (vm.current.gap > 0 ? 0 : 1);

describe('YouOrCrowdGame', () => {
  afterEach(() => vi.useRealTimers());

  it('asks the store for the film cache and waits for ten answerable films before Start', () => {
    const { wrapper, dispatch } = factory(12, null);
    expect(dispatch).toHaveBeenCalledWith('ensureLetterboxdData');
    const start = wrapper.find('.setup button');
    expect(start.attributes('disabled')).toBeDefined();
    expect(start.text()).toContain('still loading');
  });

  it('hides both scores behind a ? until you guess, with no title under the poster', async () => {
    const { wrapper } = factory(20, flatCrowd(20));
    await wrapper.find('.setup button').trigger('click');
    expect(wrapper.findAll('.yc-score').map((el) => el.text())).toEqual(['?', '?']);
    expect(wrapper.text()).not.toContain(wrapper.vm.current.entry.movie.title);
    expect(wrapper.find('.yc-guess-badge').exists()).toBe(false);
  });

  it('a right answer reveals both scores, badges the poster and moves on by itself', async () => {
    vi.useFakeTimers();
    const { wrapper, dispatch } = factory(20, flatCrowd(20));
    await wrapper.find('.setup button').trigger('click');
    const first = wrapper.vm.current;

    await wrapper.findAll('.yc-choice')[rightSide(wrapper.vm)].trigger('click');
    expect(wrapper.vm.streak).toBe(1);
    expect(dispatch).toHaveBeenCalledWith('writeDurably', { path: 'settings/games/youOrCrowdBestStreak', value: 1 });
    const mine = (first.entry.movie.id / 2).toFixed(1);
    expect(wrapper.findAll('.yc-score').map((el) => el.text())).toEqual([`★ ${mine}`, '★ 4.80']);
    expect(wrapper.find('.yc-guess-badge.correct').exists()).toBe(true);
    expect(wrapper.find('.next-btn').exists()).toBe(false);

    await vi.advanceTimersByTimeAsync(900);
    expect(wrapper.vm.guessed).toBe(false);
    expect(wrapper.vm.current).not.toBe(first);
    expect(wrapper.vm.queue.length + 2).toBe(18);
  });

  it('a wrong answer ends the run with the X badge, the reveal and the end-of-round row', async () => {
    const { wrapper, dispatch } = factory(20, flatCrowd(20));
    await wrapper.find('.setup button').trigger('click');
    await wrapper.findAll('.yc-choice')[1 - rightSide(wrapper.vm)].trigger('click');
    expect(wrapper.vm.gameOver).toBe(true);
    expect(wrapper.find('.yc-guess-badge.incorrect').exists()).toBe(true);
    expect(wrapper.text()).toContain('Streak over at 0');
    expect(wrapper.find('.end-actions').exists()).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('writeDurably', expect.objectContaining({ path: 'settings/games/history/you-or-crowd' }));
  });

  it('leaving mid-reveal cancels the pending advance', async () => {
    vi.useFakeTimers();
    const { wrapper } = factory(20, flatCrowd(20));
    await wrapper.find('.setup button').trigger('click');
    await wrapper.findAll('.yc-choice')[rightSide(wrapper.vm)].trigger('click');
    const vm = wrapper.vm;
    const queued = vm.queue.length;
    wrapper.unmount();
    await vi.advanceTimersByTimeAsync(900);
    expect(vm.queue.length).toBe(queued);
  });
});
