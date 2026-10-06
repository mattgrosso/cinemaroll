import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// Bug report 2026-10-06, movie page: "when a movie has more than four stars,
// they don't fit into the box ... make the stars a little bit smaller so that
// 4 1/2 and five stars will fit horizontally." The score tile is a third of
// the facts strip (~110px inside on a 402px phone) and the stars inherited the
// big number's size, ~24px each — five of them need ~121px. jsdom loads no
// CSS, so this reads the stylesheet.

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const css = read('../components/MovieDetail.vue').split('<style')[1];

describe('score tile stars', () => {
  const rule = css.match(/:deep\(\.toggleable-rating \.has-stars\)[^{]*\{([^}]*)\}/);

  it('shrinks the stars in the score tile so five fit on one line', () => {
    expect(rule).not.toBeNull();
    const size = Number(rule[1].match(/font-size:\s*([\d.]+)em/)[1]);
    // 5 stars at 1.35rem × 1.12 × size must fit ~110px.
    expect(5 * 1.35 * 16 * 1.12 * size).toBeLessThan(105);
    expect(rule[1]).toMatch(/white-space:\s*nowrap/);
  });

  it('keeps the row as tall as the number, so tapping through the views does not jump', () => {
    const size = Number(rule[1].match(/font-size:\s*([\d.]+)em/)[1]);
    const lineHeight = Number(rule[1].match(/line-height:\s*([\d.]+)/)[1]);
    expect(size * lineHeight).toBeCloseTo(1.1, 3); // the number's line-height
  });
});
