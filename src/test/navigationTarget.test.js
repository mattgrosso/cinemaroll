import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { navigationTarget, pathOf, goBackFrom, backOrFallback, BACK_FALLBACK_MS } from '@/utils/navigationTarget.js';

// Matt, 2026-08-16: "our navigation within the app is a bit scattershot...
// sometimes you land somewhere from a place, but then the button that you
// think might take you back actually takes you home instead of back."

const TITLES = {
  '/': 'Home',
  '/insights': 'Insights',
  '/games': 'Games',
  '/film-club': 'Film Club'
};
const titleFor = (path) => TITLES[path];

describe('pathOf', () => {
  it('discards query and hash so /awards?year=1997 matches /awards', () => {
    expect(pathOf('/awards?year=1997')).toBe('/awards');
    expect(pathOf('/movie/42#cast')).toBe('/movie/42');
    expect(pathOf('/insights')).toBe('/insights');
  });

  it('is null-safe', () => {
    expect(pathOf(null)).toBe('');
    expect(pathOf(undefined)).toBe('');
    expect(pathOf(42)).toBe('');
  });
});

describe('navigationTarget', () => {
  it('returns where you came from, named', () => {
    const target = navigationTarget({
      backPath: '/insights',
      currentPath: '/games/stats',
      parentPath: '/games',
      titleFor
    });

    expect(target).toEqual({ path: '/insights', label: 'Insights', useBack: true, fallback: '/games' });
  });

  // Deep link, cold PWA launch, hard refresh — history.state.back is null.
  it('falls back to the declared parent when there is no history', () => {
    const target = navigationTarget({
      backPath: null,
      currentPath: '/games/stats',
      parentPath: '/games',
      titleFor
    });

    expect(target).toEqual({ path: '/games', label: 'Games', useBack: false, fallback: '/games' });
  });

  // The awards year strip replaces the route as you step through years, so
  // "back" can end up pointing at the page you're already on.
  it('ignores a back entry that is the page you are already looking at', () => {
    const target = navigationTarget({
      backPath: '/awards?year=1997',
      currentPath: '/awards?year=2001',
      parentPath: '/insights',
      titleFor
    });

    expect(target.useBack).toBe(false);
    expect(target.path).toBe('/insights');
  });

  it('never sends you back through the login screen', () => {
    const target = navigationTarget({
      backPath: '/login',
      currentPath: '/',
      parentPath: '/',
      titleFor,
      avoid: ['/login']
    });

    expect(target.useBack).toBe(false);
    expect(target.label).toBe('Home');
  });

  it('says "Back" rather than nothing when a route has no title', () => {
    const target = navigationTarget({
      backPath: '/somewhere-unnamed',
      currentPath: '/games',
      titleFor: () => undefined
    });

    expect(target.label).toBe('Back');
  });

  it('defaults the parent to Home', () => {
    expect(navigationTarget({ backPath: null, currentPath: '/games' }).path).toBe('/');
  });
});

describe('goBackFrom', () => {
  function router (back) {
    return {
      back: vi.fn(),
      push: vi.fn(),
      options: { history: { state: { back } } },
      resolve: (path) => ({ meta: { title: TITLES[path] } })
    };
  }

  it('uses history when there is history', () => {
    const instance = router('/film-club');
    const route = { fullPath: '/film-club/brian', meta: { parent: '/film-club' } };

    const target = goBackFrom(instance, route);

    expect(instance.back).toHaveBeenCalled();
    expect(instance.push).not.toHaveBeenCalled();
    expect(target.label).toBe('Film Club');
  });

  it('pushes the parent when there is none', () => {
    const instance = router(null);
    const route = { fullPath: '/film-club/brian', meta: { parent: '/film-club' } };

    goBackFrom(instance, route);

    expect(instance.push).toHaveBeenCalledWith('/film-club');
    expect(instance.back).not.toHaveBeenCalled();
  });
});

// Report -P-HzO9KhUYIpmhe-uQ8: "The way you get stuck in six degrees is if
// you go from six degrees to the Home Screen and back again, you have no way
// to get back to the games screen." History said Home, so the hub was
// unreachable from inside the game.
describe('screens you exit upward from (preferParent)', () => {
  const gameTarget = (backPath) => navigationTarget({
    backPath,
    currentPath: '/games/six-degrees',
    parentPath: '/games',
    titleFor: (path) => ({ '/games': 'Games', '/': 'Home' })[path],
    preferParent: true
  })

  it('leaves a game for its hub even when history says somewhere else', () => {
    const target = gameTarget('/')

    expect(target.path).toBe('/games')
    expect(target.label).toBe('Games')
    // A push, because history's previous entry is Home, not the hub.
    expect(target.useBack).toBe(false)
  })

  it('still pops history when the previous entry IS the hub', () => {
    // The ordinary route in: hub → game → back. A real pop restores the
    // hub's scroll position, which a push would lose.
    const target = gameTarget('/games')

    expect(target.path).toBe('/games')
    expect(target.useBack).toBe(true)
  })

  it('goes to the hub on a cold start with no history at all', () => {
    expect(gameTarget(null).path).toBe('/games')
  })

  it('leaves ordinary screens following history, as before', () => {
    // Game Stats is a destination in its own right: arriving from Insights
    // and going back to Insights is a fix in its own right, not a bug.
    const target = navigationTarget({
      backPath: '/insights',
      currentPath: '/games/stats',
      parentPath: '/games',
      titleFor: (path) => ({ '/insights': 'Insights', '/games': 'Games' })[path]
    })

    expect(target.path).toBe('/insights')
    expect(target.useBack).toBe(true)
  })
})

// Report, 2026-10-06: a friend's-rating notification opened a movie page,
// and its back button then spun forever — history named a previous page the
// browser couldn't step back to. "If it doesn't know where to go, it should
// just take you home."
describe('backOrFallback', () => {
  function liveRouter (path, { popWorks }) {
    const current = { value: { fullPath: path } };
    return {
      currentRoute: current,
      back: vi.fn(() => { if (popWorks) current.value = { fullPath: '/film-club' }; }),
      push: vi.fn((to) => { current.value = { fullPath: to }; })
    };
  }

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('goes home when the step back leads nowhere', () => {
    const router = liveRouter('/movie/42', { popWorks: false });
    const beforeFallback = vi.fn();

    backOrFallback(router, '/', { beforeFallback });
    expect(router.back).toHaveBeenCalled();
    expect(router.push).not.toHaveBeenCalled();

    vi.advanceTimersByTime(BACK_FALLBACK_MS);
    expect(beforeFallback).toHaveBeenCalled();
    expect(router.push).toHaveBeenCalledWith('/');
  });

  it('leaves a step back that worked alone', () => {
    const router = liveRouter('/movie/42', { popWorks: true });

    backOrFallback(router, '/');
    vi.advanceTimersByTime(BACK_FALLBACK_MS * 2);

    expect(router.push).not.toHaveBeenCalled();
  });

  it('is what following a history target does, falling back to the parent', () => {
    const router = { ...liveRouter('/games/trivia', { popWorks: false }), options: { history: { state: { back: '/insights' } } }, resolve: () => ({ meta: {} }) };

    goBackFrom(router, { fullPath: '/games/trivia', meta: { parent: '/games' } });
    vi.advanceTimersByTime(BACK_FALLBACK_MS);

    expect(router.push).toHaveBeenCalledWith('/games');
  });
});
