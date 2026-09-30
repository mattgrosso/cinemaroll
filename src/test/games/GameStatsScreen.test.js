import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import GameStatsScreen from '@/components/games/GameStatsScreen.vue';

// Mid-month local dates — see .claude/rules/games.md on UTC drift.
const daysAgo = (days, hour = 19) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.getTime() - days * 24 * 60 * 60 * 1000;
};

function factory (games = {}, { back = null, movieLog = {} } = {}) {
  const pushSpy = vi.fn();
  const backSpy = vi.fn();
  const wrapper = mount(GameStatsScreen, {
    global: {
      mocks: {
        $store: { state: { settings: { games }, movieLog }, dispatch: vi.fn(), commit: vi.fn() },
        $router: {
          push: pushSpy,
          back: backSpy,
          options: { history: { state: { back } } },
          resolve: (path) => ({ meta: { title: path === '/insights' ? 'Insights' : 'Games' } })
        },
        $route: { path: '/games/stats', fullPath: '/games/stats', meta: { parent: '/games' } }
      }
    }
  });
  return { wrapper, pushSpy, backSpy };
}

// Feature request: "add a history for each game with some good statistics
// on how they've gone."
describe('GameStatsScreen', () => {
  it('shows an empty state before any round has been recorded', () => {
    const { wrapper } = factory({});
    expect(wrapper.find('.no-stats').exists()).toBe(true);
    expect(wrapper.findAll('.game-card')).toHaveLength(0);
    expect(wrapper.find('.scoreboard').exists()).toBe(false);
  });

  it('renders a card per game with data — stats lines plus a newest-first recent-rounds strip', () => {
    const { wrapper } = factory({
      plays: { 'clue-budget': 6 },
      history: {
        'clue-budget': [
          { at: 1, won: false, saved: 0 },
          { at: 2, won: true, saved: 40 }
        ]
      }
    });

    const card = wrapper.find('.game-card');
    expect(card.text()).toContain('Clue Budget');
    expect(card.text()).toContain('6 sessions');
    expect(card.text()).toContain('Win rate');
    expect(card.text()).toContain('50%');

    const chips = card.findAll('.round-chip').map((chip) => chip.text());
    expect(chips).toEqual(['won · $40 left', 'broke']); // newest first
  });

  it('a game with sessions but no recorded rounds yet explains itself instead of showing nothing', () => {
    const { wrapper } = factory({ plays: { wordle: 3 } });

    const card = wrapper.find('.game-card');
    expect(card.text()).toContain('Reel Wordle');
    expect(card.find('.game-pending').exists()).toBe(true);
  });

  it('orders cards most-played first and hides untouched games entirely', () => {
    const { wrapper } = factory({
      plays: { stamp: 2, timeline: 9 },
      history: {}
    });

    const names = wrapper.findAll('.game-name').map((el) => el.text());
    expect(names).toEqual(['Timeline', 'Stamp']);
  });

  it('falls back to the games hub when there is no history', async () => {
    const { wrapper, pushSpy } = factory({});
    await wrapper.find('.back-link').trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/games');
  });

  // This screen is linked from Insights as well as from Games, and the link
  // used to say "Games" and go there either way (Matt, 2026-08-16).
  it('returns to Insights when that is where you came from', async () => {
    const { wrapper, backSpy, pushSpy } = factory({}, { back: '/insights' });

    expect(wrapper.find('.back-link').text()).toBe('Insights');
    await wrapper.find('.back-link').trigger('click');
    expect(backSpy).toHaveBeenCalled();
    expect(pushSpy).not.toHaveBeenCalled();
  });
});

// Bug report -P0r4mFHYUfHFEpfwcpQ (Matt, 2026-09-06): "more fun stats...
// more in-depth numbers of the different games and make the whole page
// just look more fun."
describe('GameStatsScreen — the fun round', () => {
  const streakHistory = {
    plays: { timeline: 4, wordle: 2 },
    history: {
      timeline: [
        { at: daysAgo(3), streak: 4 },
        { at: daysAgo(2), streak: 11 },
        { at: daysAgo(1), streak: 6 },
        { at: daysAgo(0), streak: 6 }
      ],
      wordle: [{ at: daysAgo(0), guesses: 3 }]
    },
    wins: { timeline: new Date().toDateString() }
  };

  it('opens with a scoreboard whose numbers land in full (jsdom has no matchMedia, so no count-up)', () => {
    const { wrapper } = factory(streakHistory);
    const board = wrapper.find('.scoreboard');
    const tiles = board.findAll('.ds-strip-item').map((tile) => `${tile.find('.ds-strip-value').text()} ${tile.find('.ds-strip-label').text()}`);
    expect(tiles).toEqual(['5 rounds', '6 sessions', '4 days played', '4 day streak']);
    expect(board.text()).toContain('On a hot streak — 4 days in a row');
    expect(board.text()).toContain('Favourite game: Timeline, 4 sessions.');
    expect(board.text()).toContain('Won today: 1 of 12 games.');
  });

  it('no streak tile or callout on a single day of play', () => {
    const { wrapper } = factory({ plays: { wordle: 1 }, history: { wordle: [{ at: daysAgo(0), guesses: 3 }] } });
    const board = wrapper.find('.scoreboard');
    expect(board.findAll('.ds-strip-item')).toHaveLength(3);
    expect(board.text()).not.toContain('hot streak');
  });

  it('each card wears its banner, leads with a headline, and shows the personal best with its date — once', () => {
    const { wrapper } = factory(streakHistory);
    const card = wrapper.findAll('.game-card')[0];
    expect(card.find('.game-banner-image').attributes('src')).toBeTruthy();
    expect(card.find('.game-headline').text()).toMatch(/^Your best run is 11 in a row, set on /);

    const record = card.find('.ds-strip-item.record');
    expect(record.find('.ds-strip-value').text()).toBe('11 in a row');
    expect(record.find('.ds-strip-label').text()).toMatch(/^personal best · /);
    // The summary's own "Best streak" line would say the same thing again.
    expect(card.text()).not.toContain('Best streak');
    expect(card.text()).toContain('Average streak');
  });

  it('draws a form bar per round with the record highlighted and losses hollow', () => {
    const { wrapper } = factory({
      plays: { trivia: 1, timeline: 1 },
      history: {
        trivia: [{ at: 1, won: true, facts: 4 }, { at: 2, won: false, facts: 6 }, { at: 3, won: true, facts: 2 }],
        timeline: [{ at: 1, streak: 2 }]
      }
    });
    const trivia = wrapper.findAll('.game-card').find((card) => card.text().includes('Trivia'));
    const bars = trivia.findAll('.form-bar');
    expect(bars).toHaveLength(3);
    expect(bars.map((bar) => bar.classes('best'))).toEqual([false, false, true]);
    expect(bars.map((bar) => bar.classes('lost'))).toEqual([false, true, false]);

    // One round is not a form line.
    const timeline = wrapper.findAll('.game-card').find((card) => card.text().includes('Timeline'));
    expect(timeline.find('.form').exists()).toBe(false);
  });

  it('shows the win streak tiles for win/loss games', () => {
    const { wrapper } = factory({
      plays: { 'poster-zoom': 1 },
      history: { 'poster-zoom': [{ won: false, zoomOuts: 5 }, { won: true, zoomOuts: 3 }, { won: true, zoomOuts: 1 }] }
    });
    const tiles = wrapper.find('.game-card').findAll('.ds-strip-item')
      .map((tile) => `${tile.find('.ds-strip-value').text()} ${tile.find('.ds-strip-label').text()}`);
    expect(tiles).toContain('2 best win streak');
    expect(tiles).toContain('2 wins running');
    expect(wrapper.find('.ds-strip-item.hot').exists()).toBe(true);
  });

  it('turns timestamps into a habits line', () => {
    const history = Array.from({ length: 5 }, (_, i) => ({ at: daysAgo(i * 7, 20), streak: 3 })); // same weekday, evenings
    const { wrapper } = factory({ plays: { tagline: 5 }, history: { tagline: history } });
    const habitsLine = wrapper.find('.habits').text();
    expect(habitsLine).toMatch(/^Mostly \w+day evenings\. First played /);
    expect(habitsLine).toContain('5 days.');
  });

  it('resolves recorded movie keys against the library into tappable posters, dropping ones that are gone', async () => {
    const movieLog = {
      k1: { movie: { id: 101, title: 'Alien', poster_path: '/alien.jpg' } },
      k2: { movie: { id: 102, title: 'Brazil', poster_path: '/brazil.jpg' } }
    };
    const { wrapper, pushSpy } = factory({
      plays: { trivia: 3 },
      history: {
        trivia: [
          { at: 1, won: false, facts: 5, movie: 'k1' },
          { at: 2, won: false, facts: 5, movie: 'k1' },
          { at: 3, won: true, facts: 2, movie: 'k2' },
          { at: 4, won: false, facts: 5, movie: 'gone' }
        ]
      }
    }, { movieLog });

    const card = wrapper.find('.game-card');
    expect(card.text()).toContain('The ones that got away');
    expect(card.text()).toContain('Nailed it');
    const posters = card.findAll('.ds-poster-card');
    expect(posters).toHaveLength(2);
    expect(posters[0].find('img').attributes('src')).toBe('https://image.tmdb.org/t/p/w342/alien.jpg');
    expect(posters[0].text()).toBe('beat you 2 times');
    expect(posters[1].text()).toBe('2 facts');

    await posters[0].trigger('click');
    expect(pushSpy).toHaveBeenCalledWith('/movie/101');
  });

  it('rounds recorded before movie keys existed show no poster rows at all', () => {
    const { wrapper } = factory({ plays: { trivia: 1 }, history: { trivia: [{ at: 1, won: false, facts: 5 }] } });
    expect(wrapper.find('.ds-poster-row').exists()).toBe(false);
  });

  it('a tap anywhere settles the theatre', async () => {
    const { wrapper } = factory(streakHistory);
    expect(wrapper.classes('settled')).toBe(false);
    expect(wrapper.find('.game-card').attributes('style')).toContain('--stage: 1');
    await wrapper.trigger('click');
    expect(wrapper.classes('settled')).toBe(true);
  });
});
