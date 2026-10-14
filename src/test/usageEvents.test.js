import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

vi.mock('../utils/usage.js', () => ({ trackEvent: vi.fn() }));

import { trackEvent } from '../utils/usage.js';
import {
  eventName,
  screenEvent,
  trackScreen,
  trackWhenOnline,
  flushPendingEvents
} from '../assets/javascript/usageEvents.js';

const source = (path) => readFileSync(resolve(__dirname, '..', path), 'utf8');

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => value });
};

describe('usage event names', () => {
  it('turns any chip type or tab key into a name the server accepts', () => {
    expect(eventName('chip', 'yearRange')).toBe('chip-year-range');
    expect(eventName('quick-link', 'notOnLetterboxd')).toBe('quick-link-not-on-letterboxd');
    expect(eventName('insights', 'places')).toBe('insights-places');
    expect(eventName('chip', 'Odd type!')).toBe('chip-odd-type');
    expect(eventName('screen', 'x'.repeat(60))).toMatch(/^[a-z0-9-]{1,40}$/);
    expect(eventName('', null)).toBeNull();
  });
});

describe('screen views', () => {
  // The open ping's path is always '/', because the screen sits after the '#'.
  it('names each screen from the route path', () => {
    expect(screenEvent('/')).toBe('screen-home');
    expect(screenEvent('/insights')).toBe('screen-insights');
    expect(screenEvent('/web')).toBe('screen-web');
    expect(screenEvent('/watchlist')).toBe('screen-watchlist');
    expect(screenEvent('/awards')).toBe('screen-awards');
    expect(screenEvent('/film-club')).toBe('screen-film-club');
    expect(screenEvent('/showtimes')).toBe('screen-showtimes');
    expect(screenEvent('/showtimes/theaters')).toBe('screen-showtimes-theaters');
  });

  it('counts each game on its own', () => {
    expect(screenEvent('/games')).toBe('screen-games');
    expect(screenEvent('/games/wordle')).toBe('screen-games-wordle');
    expect(screenEvent('/games/six-degrees')).toBe('screen-games-six-degrees');
  });

  it('never sends a movie id or a friend key', () => {
    expect(screenEvent('/movie/603')).toBe('screen-movie');
    expect(screenEvent('/film-club/someone-at-example-com')).toBe('screen-film-club-friend');
    expect(screenEvent('/share/abc/def')).toBe('screen-share');
  });

  describe('trackScreen', () => {
    beforeEach(() => trackEvent.mockClear());

    it('counts the first screen of an open', () => {
      trackScreen({ path: '/' }, { path: '/', matched: [] });
      expect(trackEvent).toHaveBeenCalledWith('screen-home');
    });

    it('counts a move to another screen', () => {
      trackScreen({ path: '/movie/603' }, { path: '/', matched: [{}] });
      expect(trackEvent).toHaveBeenCalledWith('screen-movie');
    });

    it('does not count a query change on the same screen', () => {
      trackScreen({ path: '/insights' }, { path: '/insights', matched: [{}] });
      expect(trackEvent).not.toHaveBeenCalled();
    });
  });

  it('is wired into every navigation', () => {
    expect(source('router/index.js')).toMatch(/router\.afterEach\(\(to, from\) => \{[^}]*trackScreen\(to, from\)/);
  });
});

describe('actions taken offline', () => {
  beforeEach(() => {
    trackEvent.mockClear();
    localStorage.clear();
  });
  afterEach(() => setOnline(true));

  it('sends straight away when online', () => {
    setOnline(true);
    trackWhenOnline('rating-logged-offline');
    expect(trackEvent).toHaveBeenCalledWith('rating-logged-offline');
  });

  // sendBeacon with no connection drops the count, so it waits on the device.
  it('holds the count offline and sends it once the connection is back', () => {
    setOnline(false);
    trackWhenOnline('rating-logged-offline');
    trackWhenOnline('tiebreak-finished');
    flushPendingEvents();
    expect(trackEvent).not.toHaveBeenCalled();

    setOnline(true);
    flushPendingEvents();
    expect(trackEvent.mock.calls.map(([name]) => name)).toEqual(['rating-logged-offline', 'tiebreak-finished']);

    trackEvent.mockClear();
    flushPendingEvents();
    expect(trackEvent).not.toHaveBeenCalled();
  });
});

describe('the actions Cinema Roll counts', () => {
  const hooks = [
    ['components/Home.vue', "eventName('chip', searchType.type)"],
    ['components/Home.vue', "eventName('quick-link'"],
    ['components/Insights.vue', "eventName('insights', key)"],
    ['mixins/gameData.js', "eventName('game-round', key)"],
    ['components/DrawFromHat.vue', "trackEvent('hat-draw')"],
    ['components/SendToHat.vue', "trackEvent('hat-send')"],
    ['components/RateMovie.vue', "trackWhenOnline('rating-logged-offline')"],
    ['components/TweakInline.vue', "trackWhenOnline('tiebreak-finished')"],
    ['components/MovieDetail.vue', "trackEvent('letterboxd-open')"],
    ['components/WhereToWatch.vue', "trackEvent('where-to-watch')"],
    ['components/UpdateAvailableBanner.vue', "trackEvent('update-tapped')"]
  ];
  it.each(hooks)('%s counts %s', (file, call) => {
    expect(source(file)).toContain(call);
  });
});
