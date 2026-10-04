import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// The Rate page and the movie detail page run a size dial
// (`_detail-scale.scss`, report 2026-10-04: "a little bit bigger"). jsdom loads
// no CSS, so these read the stylesheets. What they pin:
//
//  1. Every font size on those pages and the pieces they show goes through
//     ds(). A raw rem/px size would sit at the old scale while everything
//     around it grew. em sizes are fine — they inherit the dial. A line marked
//     "outside the dial" is exempt (the Cover Flow pin, which
//     neighborsPin.test.js wants as a plain px size).
//  2. Both page roots turn the dial on, and the Cover Flow strip turns it off.

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const FILES = [
  'MovieDetail', 'RateMovie', 'DetailSection', 'RatingSelect', 'ToggleableRating', 'FriendsWhoSaw',
];

const scssBlocks = (src) => [...src.matchAll(/<style lang="scss"[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]);

describe('detail scale dial', () => {
  it.each(FILES)('%s routes every rem/px font size through ds()', (name) => {
    const blocks = scssBlocks(read(`../components/${name}.vue`));
    expect(blocks.length).toBeGreaterThan(0);
    for (const css of blocks) {
      expect(css).toContain("@import '@/assets/scss/detail-scale'");
      const raw = css.split('\n')
        .filter(line => /font-size:\s*[\d.]+(rem|px)/.test(line) && !line.includes('outside the dial'));
      expect(raw).toEqual([]);
    }
  });

  it('turns the dial on at both page roots', () => {
    expect(read('../components/RateMovie.vue')).toMatch(/\.rate-movie \{\s*@include detail-scale-root;/);
    expect(read('../components/MovieDetail.vue')).toMatch(/\.movie-detail-page \{\s*@include detail-scale-root;/);
  });

  it('keeps the Cover Flow strip at its own size', () => {
    expect(read('../components/RateMovie.vue')).toMatch(/\.neighbors \{[^}]*--detail-scale: 1;/);
  });

  it('sets the dial a little above 1', () => {
    const scale = Number(read('../assets/scss/_detail-scale.scss').match(/\$detail-scale:\s*([\d.]+);/)[1]);
    expect(scale).toBeGreaterThan(1);
    expect(scale).toBeLessThan(1.3);
  });
});
