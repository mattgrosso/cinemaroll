import { describe, it, expect, vi } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import DrawFromHat from '@/components/DrawFromHat.vue';

vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }));

const HATS = [{ title: 'Just Matt', dbKey: 'k1' }, { title: 'Whole family', dbKey: 'k2' }];

function factory ({ hats = HATS, result = null, summaries = [], accessError = null, connect = null } = {}) {
  const push = vi.fn();
  const dispatch = vi.fn((action) => {
    if (action === 'loadMovieHatSummaries') return Promise.resolve(summaries);
    if (action === 'ensureMovieHatContents') return Promise.resolve();
    if (action === 'connectMovieHat') {
      return connect instanceof Error ? Promise.reject(connect) : Promise.resolve(connect);
    }
    return result instanceof Error ? Promise.reject(result) : Promise.resolve(result);
  });
  const wrapper = mount(DrawFromHat, {
    global: {
      mocks: {
        $store: {
          state: { movieHatSummaries: summaries, movieHatAccessError: accessError },
          getters: { linkedMovieHats: hats },
          dispatch
        },
        $router: { push }
      }
    }
  });
  return { wrapper, dispatch, push };
}

async function drawFrom (wrapper, index = 0) {
  await wrapper.findAll('.hat-draw')[index].trigger('click');
  await wrapper.vm.$nextTick();
  await wrapper.vm.$nextTick();
}

describe('DrawFromHat', () => {
  it('stays out of the way until a hat is linked', () => {
    const { wrapper } = factory({ hats: [] });

    expect(wrapper.find('.draw-from-hat').exists()).toBe(false);
  });

  it('shows a card per linked hat and draws from the one pressed', async () => {
    const { wrapper, dispatch } = factory({
      result: { movie: { id: 550, title: 'Fight Club' }, hat: 'Whole family', remaining: 12 }
    });

    expect(wrapper.findAll('.hat-name').map((title) => title.text()))
      .toEqual(['Just Matt', 'Whole family']);

    await drawFrom(wrapper, 1);
    expect(dispatch).toHaveBeenCalledWith('drawFromMovieHat', { title: 'Whole family', dbKey: 'k2' });
  });

  // "A section lower down that shows each hat with the most recently drawn
  // movie, the total number of movies in the hat, and a button to draw."
  // The card used to carry a "Last drew" poster + title above the history
  // strip. Removed 2026-08-18 (bug report): the strip is newest-first, so its
  // first card was always that same movie — "the most recently drawn is just
  // the most recent one in the history we don't need both". What the card
  // still owes you at a glance is the waiting count; the newest draw is now
  // read off the front of the strip.
  it('shows how many are waiting, and does not restate the newest draw', () => {
    const drawn = { title: 'Heat', id: 1, poster_path: '/h.jpg', dateDrawn: Date.now() - 3 * 60 * 60 * 1000 };
    const { wrapper } = factory({
      summaries: [{
        title: 'Just Matt',
        dbKey: 'k1',
        waiting: 128,
        lastDrawn: drawn,
        history: [drawn]
      }]
    });
    const card = wrapper.findAll('.hat-card')[0];

    expect(card.find('.hat-waiting').text()).toBe('128 waiting');
    // Exactly one Heat on the card, in the strip — not one here and one there.
    expect(card.findAll('.hat-history-card')).toHaveLength(1);
    expect(card.find('.hat-history-poster').attributes('alt')).toBe('Heat');
    // A hat with history has no empty-state label.
    expect(card.find('.hat-empty-label').exists()).toBe(false);
  });

  it('asks for the hat summaries when it appears', () => {
    const { dispatch } = factory({});
    expect(dispatch).toHaveBeenCalledWith('loadMovieHatSummaries');
  });

  // Settings arrive after mount. Loading in mounted() fetched an empty list
  // once and never retried, so every card sat on "…" forever.
  it('waits for the linked hats to arrive before loading them', async () => {
    const { wrapper, dispatch } = factory({ hats: [] });
    expect(dispatch).not.toHaveBeenCalledWith('loadMovieHatSummaries');

    wrapper.vm.$options.watch.hats.handler.call(wrapper.vm, HATS);
    expect(dispatch).toHaveBeenCalledWith('loadMovieHatSummaries');
  });

  it('refreshes the cards after a draw, since the count just changed', async () => {
    const { wrapper, dispatch } = factory({
      result: { movie: { id: 1, title: 'Heat' }, hat: 'Just Matt', remaining: 5 }
    });
    dispatch.mockClear();

    await drawFrom(wrapper);

    expect(dispatch).toHaveBeenCalledWith('loadMovieHatSummaries');
  });

  it('says so when a hat could not be loaded, rather than showing a wrong count', () => {
    const { wrapper } = factory({ summaries: [{ title: 'Just Matt', dbKey: 'k1', error: true }] });

    expect(wrapper.findAll('.hat-waiting')[0].text()).toBe("couldn't load");
  });

  it('shows what was drawn, who put it in, and what is left', async () => {
    const { wrapper } = factory({
      result: {
        movie: { id: 550, title: 'Fight Club', poster_path: '/f.jpg', addedBy: 'Natalie', note: 'For Friday' },
        hat: 'Just Matt',
        remaining: 127
      }
    });

    await drawFrom(wrapper);

    expect(wrapper.find('.drawn-title').text()).toBe('Fight Club');
    expect(wrapper.text()).toContain('Added by Natalie');
    expect(wrapper.find('.drawn-note').text()).toBe('For Friday');
    expect(wrapper.text()).toContain('127 left in Just Matt');
  });

  // "I don't want drawing from inside cinema roll to take me straight into
  // rating the movie because... I'll have to watch the movie first."
  it('does not push you into rating the movie', async () => {
    const { wrapper, push } = factory({
      result: { movie: { id: 550, title: 'Fight Club' }, hat: 'Just Matt', remaining: 3 }
    });

    await drawFrom(wrapper);

    expect(push).not.toHaveBeenCalled();
    expect(wrapper.text()).not.toMatch(/rate/i);
  });

  it('looks the film up only when asked', async () => {
    const { wrapper, push } = factory({
      result: { movie: { id: 550, title: 'Fight Club' }, hat: 'Just Matt', remaining: 3 }
    });

    await drawFrom(wrapper);
    await wrapper.find('.drawn-link').trigger('click');

    expect(push).toHaveBeenCalledWith('/movie/550');
  });

  it('says so when the hat is empty', async () => {
    const { wrapper } = factory({ result: { movie: null, hat: 'Just Matt', remaining: 0 } });

    await drawFrom(wrapper);

    expect(wrapper.find('.draw-message').text()).toBe('Just Matt is empty. Which is sad.');
    expect(wrapper.find('.drawn').exists()).toBe(false);
  });

  it('reports a failure rather than showing a phantom draw', async () => {
    const { wrapper } = factory({ result: new Error('offline') });

    await drawFrom(wrapper);

    expect(wrapper.find('.draw-message').text()).toBe("Couldn't reach Just Matt.");
    expect(wrapper.find('.draw-message').classes()).toContain('draw-message-error');
    expect(wrapper.find('.drawn').exists()).toBe(false);
  });
});

// "I'd rather just see the whole history from that hat because that's all
// available... let's make it another scrollable list [and] maintain the draw
// button somewhere." (2026-08-17)
//
// The first cut appended the strip to a card that was a flex ROW of poster +
// body, so it landed as a squeezed third column — "the layout on the hat
// displays where you're showing the history is all busted". The card is a
// vertical block now, and the strip is a full-width sibling of the last-drawn
// row rather than a third item beside it.
// Bug report (2026-09-13): "The list of hats on my watchlist page should be
// sorted by most recently drawn from so whichever one has a movie that was
// most recently drawn it should be at the top."
describe('DrawFromHat card order', () => {
  const HOUR = 60 * 60 * 1000;
  const hats = [
    { title: 'Quiet hat', dbKey: 'q' },
    { title: 'Busy hat', dbKey: 'b' },
    { title: 'Never drawn', dbKey: 'n' }
  ];

  it('puts the hat drawn from most recently first, and never-drawn hats last', () => {
    const summaries = [
      // History is newest-first from the store, but the order shouldn't be
      // trusted: the oldest draw is listed first here on purpose.
      { title: 'Quiet hat', dbKey: 'q', waiting: 3, history: [
        { id: 1, title: 'Old', dateDrawn: Date.now() - 500 * HOUR }
      ] },
      { title: 'Busy hat', dbKey: 'b', waiting: 9, history: [
        { id: 2, title: 'Older', dateDrawn: Date.now() - 40 * HOUR },
        { id: 3, title: 'Newest', dateDrawn: Date.now() - HOUR }
      ] },
      { title: 'Never drawn', dbKey: 'n', waiting: 4, history: [] }
    ];
    const { wrapper } = factory({ hats, summaries });

    expect(wrapper.findAll('.hat-name').map((name) => name.text()))
      .toEqual(['Busy hat', 'Quiet hat', 'Never drawn']);
  });

  it('keeps the linked order until the summaries arrive, so the cards do not shuffle twice', () => {
    const { wrapper } = factory({ hats, summaries: [] });

    expect(wrapper.findAll('.hat-name').map((name) => name.text()))
      .toEqual(['Quiet hat', 'Busy hat', 'Never drawn']);
  });

  it('treats a hat that could not load like one never drawn from', () => {
    const summaries = [
      { title: 'Quiet hat', dbKey: 'q', error: true },
      { title: 'Busy hat', dbKey: 'b', waiting: 9, history: [{ id: 3, title: 'Newest', dateDrawn: Date.now() - HOUR }] },
      { title: 'Never drawn', dbKey: 'n', waiting: 4, history: [] }
    ];
    const { wrapper } = factory({ hats, summaries });

    expect(wrapper.findAll('.hat-name').map((name) => name.text()))
      .toEqual(['Busy hat', 'Quiet hat', 'Never drawn']);
  });
});

describe('DrawFromHat history strip', () => {
  const HOUR = 60 * 60 * 1000;

  const withHistory = [{
    title: 'Dev Hat',
    dbKey: 'k1',
    waiting: 12,
    lastDrawn: { title: 'Newest', poster_path: '/n.jpg', dateDrawn: Date.now() - HOUR },
    history: [
      { id: 1, title: 'Newest', poster_path: '/n.jpg', dateDrawn: Date.now() - HOUR },
      { id: 2, title: 'Older', poster_path: '/o.jpg', dateDrawn: Date.now() - 50 * HOUR },
      { id: 3, title: 'Oldest', poster_path: null, dateDrawn: Date.now() - 900 * HOUR }
    ]
  }];

  it('shows every drawn movie, and says how many', async () => {
    const { wrapper } = factory({ hats: [{ title: 'Dev Hat', dbKey: 'k1' }], summaries: withHistory });
    await flushPromises();

    expect(wrapper.findAll('.hat-history-card')).toHaveLength(3);
    expect(wrapper.find('.hat-history-title').text()).toContain('3');
  });

  // Bug report (2026-08-21): "combine the title the button and the number of
  // movies in the hat all into one row" — the header IS that one row, and
  // the history strip stays a full-width sibling below it.
  it('puts name, count and the Draw button in one header row', async () => {
    const { wrapper } = factory({ hats: [{ title: 'Dev Hat', dbKey: 'k1' }], summaries: withHistory });
    await flushPromises();

    const head = wrapper.find('.hat-head');
    expect(head.find('.hat-name').exists()).toBe(true);
    expect(head.find('.hat-waiting').exists()).toBe(true);
    expect(head.find('.hat-draw').exists()).toBe(true);
    expect(wrapper.find('.hat-card > .hat-history').exists()).toBe(true);
    expect(wrapper.find('.hat-head .hat-history').exists()).toBe(false);
  });

  it('still offers the draw button alongside the history', async () => {
    const { wrapper } = factory({ hats: [{ title: 'Dev Hat', dbKey: 'k1' }], summaries: withHistory });
    await flushPromises();

    expect(wrapper.find('.hat-draw').exists()).toBe(true);
  });

  // It used to need more than one entry, because a lone entry would have
  // restated the "Last drew" block standing above it. That block is gone, so
  // a single-draw hat has to show its one card here or show nothing at all.
  it('shows from the very first draw', async () => {
    const { wrapper } = factory({
      hats: [{ title: 'Dev Hat', dbKey: 'k1' }],
      summaries: [{ ...withHistory[0], history: [withHistory[0].history[0]] }]
    });
    await flushPromises();

    expect(wrapper.find('.hat-history').exists()).toBe(true);
    expect(wrapper.findAll('.hat-history-card')).toHaveLength(1);
  });

  it('says so when a hat has never been drawn from', async () => {
    const { wrapper } = factory({
      hats: [{ title: 'Dev Hat', dbKey: 'k1' }],
      summaries: [{ title: 'Dev Hat', dbKey: 'k1', waiting: 4, lastDrawn: null, history: [] }]
    });
    await flushPromises();

    expect(wrapper.find('.hat-history').exists()).toBe(false);
    expect(wrapper.find('.hat-empty-label').text()).toContain('Nothing drawn yet.');
    expect(wrapper.find('.hat-draw').exists()).toBe(true);
  });

  // "I could click on a poster in one of those lists and it would pop up a
  // list of where I can watch that movie" (bug report, 2026-08-18).
  describe('where to watch', () => {
    it('opens the sheet on the movie whose poster was tapped', async () => {
      const { wrapper } = factory({ hats: [{ title: 'Dev Hat', dbKey: 'k1' }], summaries: withHistory });
      await flushPromises();

      expect(wrapper.findComponent({ name: 'WhereToWatch' }).props('movie')).toBe(null);

      await wrapper.findAll('.hat-history-card')[1].trigger('click');

      // The SECOND poster, not simply the first or the newest.
      expect(wrapper.findComponent({ name: 'WhereToWatch' }).props('movie'))
        .toEqual({ id: 2, title: 'Older' });
    });

    it('closes again, and can then open on a different poster', async () => {
      const { wrapper } = factory({ hats: [{ title: 'Dev Hat', dbKey: 'k1' }], summaries: withHistory });
      await flushPromises();
      const sheet = () => wrapper.findComponent({ name: 'WhereToWatch' });

      await wrapper.findAll('.hat-history-card')[0].trigger('click');
      sheet().vm.$emit('close');
      await wrapper.vm.$nextTick();
      expect(sheet().props('movie')).toBe(null);

      await wrapper.findAll('.hat-history-card')[2].trigger('click');
      expect(sheet().props('movie')).toEqual({ id: 3, title: 'Oldest' });
    });

    it('offers the poster as a real button, not a bare div', async () => {
      const { wrapper } = factory({ hats: [{ title: 'Dev Hat', dbKey: 'k1' }], summaries: withHistory });
      await flushPromises();

      const card = wrapper.findAll('.hat-history-card')[0];
      expect(card.element.tagName).toBe('BUTTON');
      expect(card.attributes('aria-label')).toBe('Where to watch Newest');
    });

    it('does not draw from the hat when a history poster is tapped', async () => {
      const { wrapper, dispatch } = factory({ hats: [{ title: 'Dev Hat', dbKey: 'k1' }], summaries: withHistory });
      await flushPromises();
      dispatch.mockClear();

      await wrapper.findAll('.hat-history-card')[0].trigger('click');

      expect(dispatch).not.toHaveBeenCalledWith('drawFromMovieHat', expect.anything());
    });
  });
});

// Bug report: the Movie Hat integration answered 401 and the section just
// showed "couldn't load" on every card — no statement of what was wrong and
// nothing to press. Movie Hat is a separate Firebase project whose rules
// refuse anonymous reads, so a lapsed session takes the whole section out.
describe('when Movie Hat refuses the hats', () => {
  it('says nothing is wrong when the reads worked', () => {
    const { wrapper } = factory();

    expect(wrapper.find('.hat-access').exists()).toBe(false);
  });

  it('explains a missing session and offers to connect', () => {
    const { wrapper } = factory({ accessError: { reason: 'not-connected', email: null } });

    const banner = wrapper.find('.hat-access');
    expect(banner.exists()).toBe(true);
    expect(banner.text()).toContain("isn't signed in to Movie Hat");
    expect(banner.find('.hat-access-btn').text()).toBe('Connect Movie Hat');
  });

  it('says a session expired rather than claiming you were never signed in', () => {
    const { wrapper } = factory({ accessError: { reason: 'token-failed', email: 'matt@example.com' } });

    const banner = wrapper.find('.hat-access');
    expect(banner.text()).toContain('expired');
    expect(banner.text()).toContain('matt@example.com');
    expect(banner.find('.hat-access-btn').text()).toBe('Reconnect');
  });

  // The failure that actually happened: a perfectly good session belonging to
  // an account that isn't a member of these hats. Naming it is the whole
  // difference between "it's broken" and "oh, wrong Google account".
  it('names the connected account when the rules refused it', () => {
    const { wrapper } = factory({
      accessError: { reason: 'denied', email: 'movie-hat-tester@example.com' }
    });

    const banner = wrapper.find('.hat-access');
    expect(banner.text()).toContain('movie-hat-tester@example.com');
    expect(banner.text()).toContain("isn't a member of these hats");
  });

  it('reconnects and refetches both caches from the banner itself', async () => {
    const { wrapper, dispatch } = factory({ accessError: { reason: 'denied', email: 'wrong@example.com' } });
    await flushPromises();
    dispatch.mockClear();

    await wrapper.find('.hat-access-btn').trigger('click');
    await flushPromises();

    expect(dispatch).toHaveBeenCalledWith('connectMovieHat');
    expect(dispatch).toHaveBeenCalledWith('loadMovieHatSummaries');
    // Forced: the ten-minute cache would otherwise hold the old, failed read.
    expect(dispatch).toHaveBeenCalledWith('ensureMovieHatContents', { force: true });
  });

  it('stays quiet when the Google chooser is simply dismissed', async () => {
    const dismissed = Object.assign(new Error('closed'), { code: 'auth/popup-closed-by-user' });
    const { wrapper } = factory({ accessError: { reason: 'not-connected' }, connect: dismissed });
    await flushPromises();

    await wrapper.find('.hat-access-btn').trigger('click');
    await flushPromises();

    expect(wrapper.find('.hat-access-failed').exists()).toBe(false);
  });

  it('reports a sign-in that actually failed', async () => {
    const { wrapper } = factory({ accessError: { reason: 'not-connected' }, connect: new Error('nope') });
    await flushPromises();

    await wrapper.find('.hat-access-btn').trigger('click');
    await flushPromises();

    expect(wrapper.find('.hat-access-failed').text()).toContain("Couldn't sign in");
  });
});
