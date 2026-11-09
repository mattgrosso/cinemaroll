import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { boardSections, nameList } from '../assets/javascript/showtimesBoard.js';

// Matt, 2026-11-09: the Showtimes screen drew every theater, even ones with
// nothing left to show. Only theaters with cards get a section; an empty
// screen says "All caught up"; an unreadable board is still named.
const t = (name, shown, ok = true) => ({ key: name, name, ok, listings: shown, shown });

describe('boardSections', () => {
  it('drops theaters with nothing shown and keeps the order of the rest', () => {
    const s = boardSections([t('A', [{}]), t('B', []), t('C', [{}, {}])]);
    expect(s.visible.map((x) => x.name)).toEqual(['A', 'C']);
    expect(s.caughtUp).toBe(false);
    expect(s.unreadable).toEqual([]);
  });

  it('is caught up when no theater has a card', () => {
    const s = boardSections([t('A', []), t('B', [])]);
    expect(s.visible).toEqual([]);
    expect(s.caughtUp).toBe(true);
  });

  it('names unreadable boards rather than hiding them silently', () => {
    const s = boardSections([t('A', []), t('B', [], false)]);
    expect(s.caughtUp).toBe(true);
    expect(s.unreadable).toEqual(['B']);
  });

  it('copes with no board', () => {
    expect(boardSections(undefined)).toEqual({ visible: [], unreadable: [], caughtUp: true });
  });
});

describe('nameList', () => {
  it('joins names the way a sentence would', () => {
    expect(nameList(['A'])).toBe('A');
    expect(nameList(['A', 'B'])).toBe('A and B');
    expect(nameList(['A', 'B', 'C'])).toBe('A, B and C');
  });
});

describe('Showtimes screen uses it', () => {
  const screen = readFileSync(resolve(process.cwd(), 'src/components/ShowtimesScreen.vue'), 'utf8');
  it('loops over the visible theaters only and shows the caught-up line', () => {
    expect(screen).toContain('v-for="theater in sections.visible"');
    expect(screen).not.toContain('v-for="theater in theaters"');
    expect(screen).toMatch(/v-if="sections\.caughtUp"[^>]*>[\s\S]*?All caught up/);
    expect(screen).toContain('sections.unreadable.length');
    expect(screen).not.toContain('Nothing listed.');
  });
});
