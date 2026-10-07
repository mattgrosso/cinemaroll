import { describe, it, expect, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import PersonalAwardsScreen from '@/components/PersonalAwardsScreen.vue';
import PersonalAwardsModal from '@/components/PersonalAwardsModal.vue';

const DEFAULT_LIBRARY = [{ dbKey: 'k', movie: { id: 1, title: 'M', keywords: [{ name: 'kw' }] }, ratings: [] }];

function libraryForYears (yearCounts) {
  return Object.entries(yearCounts).flatMap(([year, count]) =>
    Array.from({ length: count }, (_, i) => ({
      dbKey: `${year}-${i}`,
      movie: { id: `${year}-${i}`, title: `M${i}`, release_date: `${year}-06-15`, runtime: 100, keywords: [] },
      ratings: []
    }))
  );
}

function factory (query = {}, settings = {}, library = DEFAULT_LIBRARY) {
  const pushSpy = vi.fn();
  const replaceSpy = vi.fn();
  const backSpy = vi.fn();
  const wrapper = shallowMount(PersonalAwardsScreen, {
    global: {
      mocks: {
        $store: {
          state: { settings },
          getters: { allMoviesAsArray: library }
        },
        $router: { push: pushSpy, back: backSpy, replace: replaceSpy },
        $route: { query }
      }
    }
  });
  return { wrapper, pushSpy, backSpy, replaceSpy };
}

// Feedback: the awards modal "always feels a little bit janky... maybe it
// would feel better if it was just a full page." /awards is that page.
describe('PersonalAwardsScreen', () => {
  it('renders the awards component in page mode, auto-opened, with the year from the URL', () => {
    const { wrapper } = factory({ year: '1997' }, { personalAwardName: 'Grosker' });
    const modal = wrapper.findComponent(PersonalAwardsModal);

    expect(modal.props('pageMode')).toBe(true);
    expect(modal.props('autoOpen')).toBe(true);
    expect(modal.props('selectedYear')).toBe(1997);
    expect(modal.props('personalAwardName')).toBe('Grosker');
    expect(modal.props('allEntriesWithFlatKeywordsAdded')[0].movie.flatKeywords).toEqual(['kw']);
  });

  it('tolerates a missing year before the library has arrived to default from', () => {
    const { wrapper, replaceSpy } = factory({});
    expect(wrapper.findComponent(PersonalAwardsModal).props('selectedYear')).toBeNull();
    expect(replaceSpy).not.toHaveBeenCalled();
  });

  // The Awards card on Insights links to a bare /awards. The modal's own
  // picker answers "which year needs work" and returns null once every year is
  // finished, which rendered a page with nothing in it (Matt, 2026-08-16).
  describe('landing without a year', () => {
    const library = libraryForYears({ 1994: 12, 1997: 12, 2001: 12 });

    it('defaults to the most recent year', () => {
      const { replaceSpy } = factory({}, {}, library);

      expect(replaceSpy).toHaveBeenCalledWith({ path: '/awards', query: { year: 2001 } });
    });

    it('defaults even when every year is already complete — the case that broke', () => {
      const settings = {
        personalAwards: { 1994: { completed: true }, 1997: { completed: true }, 2001: { completed: true } }
      };
      const { replaceSpy } = factory({}, settings, library);

      expect(replaceSpy).toHaveBeenCalledWith({ path: '/awards', query: { year: 2001 } });
    });

    it('leaves an explicit year in the URL alone', () => {
      const { replaceSpy } = factory({ year: '1997' }, {}, library);

      expect(replaceSpy).not.toHaveBeenCalled();
    });
  });

  it('closing leaves the page (Home fallback when there is no history to go back to)', () => {
    const { wrapper, pushSpy, backSpy } = factory({ year: '1997' });
    wrapper.findComponent(PersonalAwardsModal).vm.$emit('closed');
    // jsdom starts with history.length === 1, so this exercises the fallback.
    expect(backSpy.mock.calls.length + pushSpy.mock.calls.length).toBeGreaterThan(0);
    if (pushSpy.mock.calls.length) expect(pushSpy).toHaveBeenCalledWith('/');
  });
  // "I'm not sure how to get to my awards view. If I wanna just look at a
  // single year's awards... a similar kind of side to side scrollable list of
  // years at the top of the awards page." (2026-08-16)
  describe('year strip', () => {
    const library = libraryForYears({ 1994: 12, 1997: 12, 2001: 12 });

    it('lists every eligible year, oldest first', () => {
      const { wrapper } = factory({ year: '1997' }, {}, library);

      expect(wrapper.findAll('.awards-year-pill').map((pill) => pill.text()))
        .toEqual(['1994', '1997', '2001']);
    });

    it('marks the year being viewed', async () => {
      const { wrapper } = factory({ year: '1997' }, {}, library);
      wrapper.findComponent(PersonalAwardsModal).vm.$emit('yearChanged', 1997);
      await wrapper.vm.$nextTick();

      const selected = wrapper.findAll('.awards-year-pill').filter((pill) => pill.classes('selected'));
      expect(selected).toHaveLength(1);
      expect(selected[0].text()).toBe('1997');
    });

    // The modal, not the URL, decides the year on a bare /awards.
    it('follows the year the modal reports even with no year in the URL', async () => {
      const { wrapper } = factory({}, {}, library);
      wrapper.findComponent(PersonalAwardsModal).vm.$emit('yearChanged', 2001);
      await wrapper.vm.$nextTick();

      const selected = wrapper.findAll('.awards-year-pill').filter((pill) => pill.classes('selected'));
      expect(selected[0].text()).toBe('2001');
    });

    it('replaces the route rather than stacking history when you pick a year', async () => {
      const { wrapper, replaceSpy } = factory({ year: '1997' }, {}, library);
      wrapper.findComponent(PersonalAwardsModal).vm.$emit('yearChanged', 1997);
      await wrapper.vm.$nextTick();

      await wrapper.findAll('.awards-year-pill')[2].trigger('click');
      expect(replaceSpy).toHaveBeenCalledWith({ path: '/awards', query: { year: 2001 } });

      // Tapping the year you're already on is a no-op, not a redundant nav.
      replaceSpy.mockClear();
      await wrapper.findAll('.awards-year-pill')[1].trigger('click');
      expect(replaceSpy).not.toHaveBeenCalled();
    });
  });

  // Replaced by the page itself plus the year strip above it.
  it('no longer renders the old awards-results browser', () => {
    const { wrapper } = factory({ year: '1997' });
    expect(wrapper.find('.awards-results-panel').exists()).toBe(false);
  });
});

import AwardsBoard from '@/components/AwardsBoard.vue';

// Matt, 2026-10-07: tabs across the top for every ceremony we can see —
// yours, your friends', the Oscars and the rest.
describe('ceremony tabs', () => {
  const brian = {
    key: 'ext-1',
    name: 'Brian Goegan',
    profile: { ratings: { 11: { r: 9, t: 'Star Wars', p: '/sw.jpg', a: [{ year: 1977, category: 'i-1', label: 'Goegan Globes: Best Picture', result: 'won' }] }, 1891: { r: 9, t: 'Empire', a: [{ year: 1980, category: 'i-1', label: 'Goegan Globes: Best Picture', result: 'won' }] } } }
  };
  function tabbed (query, extra = {}) {
    const replaceSpy = vi.fn();
    const pushSpy = vi.fn();
    const wrapper = shallowMount(PersonalAwardsScreen, {
      global: {
        mocks: {
          $store: {
            state: { settings: { personalAwardName: 'Grosker' }, allAcademyAwards: [{ year: 1994, category: 'Best Picture', tmdb: '13', title: 'Forrest Gump', img: '/fg.jpg', isWinner: true, isActing: false, names: [] }], ...extra },
            getters: { allMoviesAsArray: DEFAULT_LIBRARY, filmClubFriends: [brian, { key: 'quiet', name: 'Luke', profile: { ratings: {} } }] },
            dispatch: vi.fn()
          },
          $router: { push: pushSpy, replace: replaceSpy, back: vi.fn() },
          $route: { query }
        }
      }
    });
    return { wrapper, replaceSpy, pushSpy };
  }

  it('shows mine, each friend with awards, and the real ceremonies; mine by default', () => {
    const { wrapper } = tabbed({ year: '1997' });
    const labels = wrapper.findAll('.ceremony-tab').map((b) => b.text());
    expect(labels).toEqual(['The Grosker', 'Goegan GlobesBrian Goegan', 'Oscars', 'Golden Globes', 'BAFTA', 'Cannes', 'Venice']);
    expect(wrapper.find('.ceremony-tab.on').text()).toBe('The Grosker');
    expect(wrapper.findComponent(PersonalAwardsModal).exists()).toBe(true);
    expect(wrapper.findComponent(AwardsBoard).exists()).toBe(false);
  });

  it('switching ceremony drops the year from the URL; picking a year keeps the ceremony', async () => {
    const { wrapper, replaceSpy } = tabbed({ year: '1997' });
    await wrapper.findAll('.ceremony-tab')[2].trigger('click');
    expect(replaceSpy).toHaveBeenCalledWith({ path: '/awards', query: { ceremony: 'oscars' } });
  });

  it('a friend\'s tab lands on their newest year with the board, and a pick opens the film', async () => {
    const { wrapper, replaceSpy, pushSpy } = tabbed({ ceremony: 'friend:ext-1' });
    expect(wrapper.findComponent(PersonalAwardsModal).exists()).toBe(false);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(wrapper.find('.board-header h2').text()).toBe('1980 Goegan Globes');
    expect(wrapper.findAll('.awards-year-pill').map((b) => b.text())).toEqual(['1977', '1980']);
    const board = wrapper.findComponent(AwardsBoard);
    expect(board.props('categories')[0]).toMatchObject({ label: 'Best Picture', winners: [{ movieId: 1891, title: 'Empire' }] });
    board.vm.$emit('pick', { movieId: 1891 });
    expect(pushSpy).toHaveBeenCalledWith('/movie/1891');
    await wrapper.findAll('.awards-year-pill')[0].trigger('click');
    expect(replaceSpy).toHaveBeenCalledWith({ path: '/awards', query: { ceremony: 'friend:ext-1', year: 1977 } });
  });

  it('the Oscars tab reads the bundled dataset', () => {
    const { wrapper } = tabbed({ ceremony: 'oscars', year: '1994' });
    expect(wrapper.find('.board-header h2').text()).toBe('1994 Oscars');
    expect(wrapper.findComponent(AwardsBoard).props('categories')[0].winners[0]).toEqual({ movieId: 13, title: 'Forrest Gump', poster: '/fg.jpg' });
  });

  it('an unknown ceremony falls back to mine', () => {
    const { wrapper } = tabbed({ ceremony: 'friend:nobody', year: '1997' });
    expect(wrapper.findComponent(PersonalAwardsModal).exists()).toBe(true);
  });
});
