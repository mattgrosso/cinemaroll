import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Bug report 2026-11-12 (iPhone, installed app): on a movie page scrolled to
// the very top, the back button sat behind the clock and the Dynamic Island.
// viewport-fit=cover draws the page under the status bar, so anything pinned
// to the top of a screen must add --safe-top (App.vue). jsdom loads no CSS,
// so this reads the stylesheets.

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const ruleBody = (src, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = src.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
};

// [file, selector, property]
const PINNED_TOP = [
  ['../components/MovieDetail.vue', '.home-link', 'top'],
  ['../components/RateMovie.vue', '.home-link', 'top'],
  ['../components/games/BackLink.vue', '.back-link', 'top'],
  ['../components/WebScreen.vue', '.web-head', 'padding'],
];

describe('things pinned to the top clear the status bar', () => {
  it('App.vue defines --safe-top from the safe-area inset', () => {
    expect(read('../App.vue')).toMatch(/--safe-top:\s*env\(safe-area-inset-top,\s*0px\)/);
  });

  it('index.html still draws under the status bar (what makes the inset real)', () => {
    expect(read('../../index.html')).toMatch(/viewport-fit=cover/);
  });

  it.each(PINNED_TOP)('%s %s adds --safe-top to its %s', (file, selector, prop) => {
    const body = ruleBody(read(file), selector);
    expect(body).not.toBeNull();
    const line = body.split('\n').find((l) => new RegExp(`^\\s*${prop}\\s*:`).test(l));
    expect(line).toMatch(/var\(--safe-top, 0px\)/);
  });
});
