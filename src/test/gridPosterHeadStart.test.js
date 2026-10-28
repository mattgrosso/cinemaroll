import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Report 2026-10-28: "The tiles are loading really slowly on the main page."
// Posters lazy-load with a 1200px head start (main.js). In WebKit, a card with
// `content-visibility: auto` hides its off-screen contents from
// IntersectionObserver, so the head start never fired and each poster only
// began downloading once it was on screen (measured in Playwright WebKit:
// 3 cards seen with it, 8 without). jsdom has no layout, so this reads the
// card's rule from the source.
describe('Home grid card', () => {
  it('does not skip its off-screen contents, so posters load ahead of the scroll', () => {
    const src = readFileSync(resolve(process.cwd(), 'src/components/DBGridLayoutSearchResult.vue'), 'utf8');
    const style = src.slice(src.indexOf('<style'));
    expect(style).not.toMatch(/^\s*content-visibility\s*:/m);
  });

  it('keeps the lazy-load head start', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.js'), 'utf8');
    expect(main).toMatch(/rootMargin:\s*'1200px 0px'/);
  });
});
