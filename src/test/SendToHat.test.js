import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import SendToHat from '@/components/SendToHat.vue';

import ErrorLogService from '@/services/ErrorLogService.js';
import { MovieHatAccessError } from '@/assets/javascript/movieHat.js';

vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn(), warn: vi.fn() } }));

const HATS = [
  { title: 'Just Matt', dbKey: 'k1' },
  { title: 'Whole family', dbKey: 'k2' }
];

function factory ({ movies, hats = HATS, note, result = { added: [], skipped: [] } } = {}) {
  const dispatch = vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)));
  const wrapper = mount(SendToHat, {
    props: note === undefined ? { movies } : { movies, note },
    global: {
      // The picker and the result are teleported to <body> so they escape the
      // horizontal scroller a poster icon lives in. Stubbing teleport renders
      // them in place, which keeps these assertions about behaviour rather
      // than about where in the document the node ended up.
      stubs: { teleport: true },
      mocks: { $store: { getters: { linkedMovieHats: hats }, dispatch } }
    }
  });
  return { wrapper, dispatch };
}

const movie = (id, title) => ({ movie: { id, title } });

describe('SendToHat', () => {
  it('renders nothing at all until a hat has been linked', () => {
    const { wrapper } = factory({ movies: [movie(1, 'Heat')], hats: [] });

    expect(wrapper.find('.hat-button').exists()).toBe(false);
  });

  it('survives a store that has never heard of the getter', () => {
    const wrapper = mount(SendToHat, {
      props: { movies: [movie(1, 'Heat')] },
      global: { mocks: { $store: { getters: {}, dispatch: vi.fn() } } }
    });

    expect(wrapper.find('.hat-button').exists()).toBe(false);
  });

  it('counts the list in its label, which is the whole "fill a hat" feature', () => {
    const { wrapper } = factory({ movies: [movie(1, 'A'), movie(2, 'B'), movie(3, 'C')] });

    expect(wrapper.find('.hat-button').text()).toBe('Add 3 to a hat');
  });

  it('says "Add to hat" for a single movie', () => {
    const { wrapper } = factory({ movies: movie(1, 'Heat') });

    expect(wrapper.find('.hat-button').text()).toBe('Add to hat');
  });

  it('offers every linked hat and sends to the one picked', async () => {
    const { wrapper, dispatch } = factory({
      movies: [movie(1, 'Heat')],
      result: { added: [{ id: 1, title: 'Heat' }], skipped: [] }
    });

    await wrapper.find('.hat-button').trigger('click');
    expect(wrapper.findAll('.hat-sheet-choice').map((choice) => choice.text()))
      .toEqual(['Just Matt', 'Whole family']);

    await wrapper.findAll('.hat-sheet-choice')[1].trigger('click');
    expect(dispatch).toHaveBeenCalledWith('addToMovieHat', {
      title: 'Whole family',
      dbKey: 'k2',
      note: null,
      entries: [movie(1, 'Heat')]
    });
  });

  describe('what it reports back', () => {
    async function sendAnd (result) {
      const { wrapper } = factory({ movies: [movie(1, 'Heat')], result });
      await wrapper.find('.hat-button').trigger('click');
      await wrapper.findAll('.hat-sheet-choice')[0].trigger('click');
      await wrapper.vm.$nextTick();
      return wrapper;
    }

    it('names the movie when one goes in', async () => {
      const wrapper = await sendAnd({ added: [{ id: 1, title: 'Heat' }], skipped: [] });

      // "is in X" read as a status rather than as something that just
      // happened, and sat too close to "is already in X" (2026-08-17).
      expect(wrapper.find('.hat-toast').text()).toBe('Heat was added to Just Matt.');
    });

    // "If you try to add something to a hat, it should just notify you back
    // that it's already in there." (Matt, 2026-08-16)
    it('says so when the movie was already in there', async () => {
      const wrapper = await sendAnd({ added: [], skipped: [{ id: 1, title: 'Heat' }] });

      expect(wrapper.find('.hat-toast').text()).toBe('Heat is already in Just Matt.');
    });

    it('splits the count when a batch is part new, part already there', async () => {
      const wrapper = await sendAnd({
        added: [{ id: 1 }, { id: 2 }, { id: 3 }],
        skipped: [{ id: 4 }, { id: 5 }]
      });

      expect(wrapper.find('.hat-toast').text()).toBe('Added 3 movies to Just Matt; 2 already there.');
    });

    it('handles a whole batch that was already in the hat', async () => {
      const wrapper = await sendAnd({ added: [], skipped: [{ id: 1 }, { id: 2 }] });

      expect(wrapper.find('.hat-toast').text()).toBe('All 2 movies were already in Just Matt.');
    });

    it('reports a failure instead of claiming success', async () => {
      const wrapper = await sendAnd(new Error('network'));

      expect(wrapper.find('.hat-toast').text()).toBe("Couldn't reach Just Matt.");
      expect(wrapper.find('.hat-toast').classes()).toContain('hat-toast-error');
    });
  });
});

// "We should include a note on that hat movie that explains where it came
// from so it could be a friendly recommendation... use plain language to
// label why that movie went into the hat." (2026-08-17)
describe('SendToHat provenance note', () => {
  it('passes the note through to the hat', async () => {
    const { wrapper, dispatch } = factory({
      movies: [movie(1, 'Heat')],
      hats: [HATS[0]],
      note: 'Worth a rewatch'
    });

    await wrapper.find('.hat-button').trigger('click');

    expect(dispatch).toHaveBeenCalledWith(
      'addToMovieHat',
      expect.objectContaining({ note: 'Worth a rewatch' })
    );
  });

  it('sends null when there is nothing to say, rather than an empty string', async () => {
    const { wrapper, dispatch } = factory({ movies: [movie(1, 'Heat')], hats: [HATS[0]] });

    await wrapper.find('.hat-button').trigger('click');

    expect(dispatch).toHaveBeenCalledWith(
      'addToMovieHat',
      expect.objectContaining({ note: null })
    );
  });
})

// "When I add a movie to a hat from my watchlist, it should be removed from
// the watchlist because I have essentially decided OK, I will watch that."
// (2026-08-17) The list needs telling what actually went in.
describe('SendToHat announcing what it added', () => {
  it('emits the movies that went in, and the sources they came from', async () => {
    const sources = [movie(1, 'Heat'), movie(2, 'Cats')];
    const { wrapper } = factory({
      movies: sources,
      hats: [HATS[0]],
      result: { added: [{ id: 1, title: 'Heat' }], skipped: [{ id: 2, title: 'Cats' }] }
    });

    await wrapper.find('.hat-button').trigger('click');
    await wrapper.vm.$nextTick();

    const [added, list] = wrapper.emitted('added')[0];
    expect(added.map((m) => m.id)).toEqual([1]);
    expect(list).toEqual(sources);
  });

  // A skip means it was already in the hat — the list already knew, and
  // taking it off on a no-op would be a surprise.
  it('stays quiet when everything was already in the hat', async () => {
    const { wrapper } = factory({
      movies: [movie(1, 'Heat')],
      hats: [HATS[0]],
      result: { added: [], skipped: [{ id: 1, title: 'Heat' }] }
    });

    await wrapper.find('.hat-button').trigger('click');
    await wrapper.vm.$nextTick();

    expect(wrapper.emitted('added')).toBeUndefined();
  });
})

// Sentry, 2026-10-22: a phone that had never signed in to Movie Hat still
// showed the hat button (linked hats follow the account; the Movie Hat
// sign-in is per device). The send failed with "Couldn't reach Just Matt."
// and the expected state was logged as an error, which is what reached Sentry.
describe('when Movie Hat refuses the send for a sign-in reason', () => {
  function refusedThenWorks (reason = 'not-connected', email = null) {
    let refused = false;
    const commit = vi.fn();
    const dispatch = vi.fn((action) => {
      if (action === 'addToMovieHat' && !refused) {
        refused = true;
        return Promise.reject(new MovieHatAccessError(reason, { email }));
      }
      if (action === 'addToMovieHat') return Promise.resolve({ added: [{ id: 1, title: 'Heat' }], skipped: [] });
      return Promise.resolve();
    });
    const wrapper = mount(SendToHat, {
      props: { movies: [movie(1, 'Heat')] },
      global: {
        stubs: { teleport: true },
        mocks: { $store: { state: {}, getters: { linkedMovieHats: [HATS[0]] }, dispatch, commit } }
      }
    });
    return { wrapper, dispatch, commit };
  }

  it('explains the sign-in and offers to connect, instead of "couldn\'t reach"', async () => {
    ErrorLogService.error.mockClear();
    const { wrapper, commit } = refusedThenWorks();

    await wrapper.find('.hat-button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.hat-toast').exists()).toBe(false);
    expect(wrapper.find('.hat-access').text()).toContain("isn't signed in to Movie Hat");
    expect(wrapper.find('.hat-access-btn').text()).toBe('Connect Movie Hat');
    // The hats section reads the same refusal from the store.
    expect(commit).toHaveBeenCalledWith('setMovieHatAccessError', { reason: 'not-connected', email: null });
    // A warning, so it stays out of Sentry.
    expect(ErrorLogService.error).not.toHaveBeenCalled();
    expect(ErrorLogService.warn).toHaveBeenCalled();
  });

  it('names the wrong account when the rules refused it', async () => {
    const { wrapper } = refusedThenWorks('denied', 'someone@example.com');

    await wrapper.find('.hat-button').trigger('click');
    await flushPromises();

    expect(wrapper.find('.hat-access').text()).toContain('someone@example.com');
    expect(wrapper.find('.hat-access-btn').text()).toBe('Reconnect');
  });

  it('finishes the send once connected', async () => {
    const { wrapper, dispatch } = refusedThenWorks();

    await wrapper.find('.hat-button').trigger('click');
    await flushPromises();
    await wrapper.find('.hat-access-btn').trigger('click');
    await flushPromises();

    expect(dispatch).toHaveBeenCalledWith('connectMovieHat');
    expect(dispatch.mock.calls.filter(([action]) => action === 'addToMovieHat')).toHaveLength(2);
    expect(wrapper.find('.hat-access').exists()).toBe(false);
    expect(wrapper.find('.hat-toast').text()).toBe('Heat was added to Just Matt.');
  });
});
