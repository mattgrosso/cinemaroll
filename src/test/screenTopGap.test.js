import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';

// One gap between the header and the first thing on every screen
// (`_screen-top.scss`, report 2026-10-09: "the space between the header and
// the tabs is still much too large... make sure that we have that same
// consistent gap across all of the various pages"). The Watchlist was still
// carrying a 2.5rem "BackLink safety margin" plus 0.35rem on its tab row.
// jsdom loads no CSS, so these read the stylesheets. What they pin:
//
//  1. Each screen root takes its top padding from $screen-top-gap, not a
//     number of its own.
//  2. The first thing inside it has no top margin to stack on that.
//
// Game screens are out of scope: their own top padding sits under a custom
// banner (games.md).

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

// [component, root selector, first element's selector or null]
const SCREENS = [
  ['WatchlistScreen', '.watchlist-screen', '.wl-tabs'],
  ['FilmClubScreen', '.film-club-screen', '.fc-tabs'],
  ['ShowtimesScreen', '.showtimes', '.st-head'],
  ['ShowtimesSetup', '.setup', '.su-title'],
  ['PersonalAwardsScreen', '.personal-awards-screen', null],
  ['NewsletterScreen', '.newsletter-screen', null],
  ['FriendComparison', '.friend-comparison', '.fc-title'],
  ['TrophyCase', '.trophy-case', '.trophy-case-title'],
  ['LibraryPoster', '.library-poster-screen', '.poster-title'],
];

const ruleBody = (src, selector) => {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = src.match(new RegExp(`(?:^|\\n)\\s*${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : null;
};

describe('screen top gap', () => {
  it('is one shared value', () => {
    expect(read('../assets/scss/_screen-top.scss')).toMatch(/\$screen-top-gap:\s*0\.5rem;/);
  });

  it.each(SCREENS)('%s starts $screen-top-gap below the header', (name, root, first) => {
    const src = read(`../components/${name}.vue`);
    expect(src).toContain("@import '@/assets/scss/screen-top'");

    const rootBody = ruleBody(src, root);
    expect(rootBody).not.toBeNull();
    expect(rootBody).toMatch(/padding:\s*\$screen-top-gap\s/);

    if (first) {
      const firstBody = ruleBody(src, first);
      expect(firstBody).not.toBeNull();
      const margin = firstBody.match(/margin:\s*([^;]+);/);
      if (margin) expect(margin[1].trim().split(/\s+/)[0]).toBe('0');
      expect(firstBody).not.toMatch(/margin-top:\s*[1-9.]/);
    }
  });

  it('Insights (no root padding) puts the gap on its tab row', () => {
    const src = read('../components/Insights.vue');
    expect(ruleBody(src, '.insights-tabs')).toMatch(/margin:\s*\$screen-top-gap\s/);
  });
});
