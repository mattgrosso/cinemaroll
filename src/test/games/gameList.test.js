import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GAMES, gameForPath, howToSeen, markHowToSeen, HOW_TO_SEEN_PREFIX } from '@/assets/javascript/games/gameList.js';
import { GAME_NAMES, GAME_ICONS } from '@/mixins/gameData.js';

// Every game route in the router, read from source so a new game can't be
// routed without joining the list (and so getting a how-to card).
const routerSource = readFileSync(resolve(__dirname, '../../router/index.js'), 'utf8');
const gameRoutes = [...routerSource.matchAll(/path:\s*'(\/games\/[^']+)'/g)]
  .map((match) => match[1])
  .filter((path) => path !== '/games/stats');

describe('gameList', () => {
  it('has every routed game, and nothing that is not routed', () => {
    expect(gameRoutes.length).toBeGreaterThan(0);
    expect(GAMES.map((game) => game.path).sort()).toEqual([...gameRoutes].sort());
  });

  it('agrees with the names and icons gameData keeps', () => {
    for (const game of GAMES) {
      expect(GAME_NAMES[game.path]).toBe(game.name);
      expect(GAME_ICONS[game.path]).toBeTruthy();
    }
  });

  it('gives every game a short how-to: three or four lines, each with an icon', () => {
    for (const game of GAMES) {
      expect(game.howTo.length, game.name).toBeGreaterThanOrEqual(3);
      expect(game.howTo.length, game.name).toBeLessThanOrEqual(4);
      for (const line of game.howTo) {
        expect(line.icon, game.name).toMatch(/^bi-[a-z0-9-]+$/);
        expect(line.text.length, `${game.name}: ${line.text}`).toBeLessThanOrEqual(110);
      }
    }
  });

  it('tells Stamp players which swipe means yes', () => {
    const text = gameForPath('/games/stamp').howTo.map((line) => line.text).join(' ');
    expect(text).toMatch(/Swipe right[^.]*Yes/);
    expect(text).toMatch(/Swipe left[^.]*No/);
  });

  it('finds a game by path, and nothing for the hub or stats', () => {
    expect(gameForPath('/games/connections').name).toBe('Connections');
    expect(gameForPath('/games')).toBeNull();
    expect(gameForPath('/games/stats')).toBeNull();
    expect(gameForPath(undefined)).toBeNull();
  });

  it('remembers a seen card per game', () => {
    const store = new Map();
    const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
    expect(howToSeen('/games/stamp', storage)).toBe(false);
    markHowToSeen('/games/stamp', storage);
    expect(howToSeen('/games/stamp', storage)).toBe(true);
    expect(howToSeen('/games/trivia', storage)).toBe(false);
    expect(store.has(`${HOW_TO_SEEN_PREFIX}/games/stamp`)).toBe(true);
  });

  it('treats unreadable storage as seen, so it never nags', () => {
    const broken = { getItem: () => { throw new Error('nope'); } };
    expect(howToSeen('/games/stamp', broken)).toBe(true);
  });
});
