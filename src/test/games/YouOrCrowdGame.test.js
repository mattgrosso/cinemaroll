import { describe, it, expect, vi } from 'vitest';
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

describe('YouOrCrowdGame', () => {
  it('asks the store for the film cache and waits for ten answerable films before Start', () => {
    const { wrapper, dispatch } = factory(12, null);
    expect(dispatch).toHaveBeenCalledWith('ensureLetterboxdData');
    const start = wrapper.find('.setup button');
    expect(start.attributes('disabled')).toBeDefined();
    expect(start.text()).toContain('still loading');
  });

  it('a right answer grows the streak and records the best; a wrong one ends the run with the reveal', async () => {
    const { wrapper, dispatch } = factory(20, flatCrowd(20));
    await wrapper.find('.setup button').trigger('click');
    expect(wrapper.vm.current).not.toBeNull();
    expect(wrapper.findAll('.yc-choice')).toHaveLength(2);

    const right = wrapper.vm.current.gap > 0 ? 'you' : 'crowd';
    const buttons = wrapper.findAll('.yc-choice');
    await buttons[right === 'you' ? 0 : 1].trigger('click');
    expect(wrapper.vm.lastGuessCorrect).toBe(true);
    expect(wrapper.vm.streak).toBe(1);
    expect(dispatch).toHaveBeenCalledWith('writeDurably', { path: 'settings/games/youOrCrowdBestStreak', value: 1 });
    expect(wrapper.vm.queue.length + 1).toBe(18);
    const mine = (wrapper.vm.current.entry.movie.id / 2).toFixed(1);
    expect(wrapper.text()).toContain(`You ★ ${mine}`);
    expect(wrapper.text()).toContain('Crowd ★ 4.80');
    expect(wrapper.text()).not.toContain('top ');
    expect(wrapper.find('.next-btn').exists()).toBe(true);

    await wrapper.find('.next-btn').trigger('click');
    expect(wrapper.vm.guessed).toBe(false);
    const wrong = wrapper.vm.current.gap > 0 ? 'crowd' : 'you';
    await wrapper.findAll('.yc-choice')[wrong === 'you' ? 0 : 1].trigger('click');
    expect(wrapper.vm.gameOver).toBe(true);
    expect(wrapper.text()).toContain('Streak over at 1');
    expect(wrapper.find('.end-actions').exists()).toBe(true);
    expect(dispatch).toHaveBeenCalledWith('writeDurably', expect.objectContaining({ path: 'settings/games/history/you-or-crowd' }));
  });
});
