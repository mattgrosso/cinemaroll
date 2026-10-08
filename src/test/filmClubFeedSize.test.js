import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Bug report (2026-10-08): "the recently viewed scroll section on the activity
// tab of Film Club could still be larger. There's a good amount of dead space
// below the posters." The feed's posters now take their height from the
// screen's, between a floor (the old fixed 234px) and a cap, and the card width
// follows at 2:3. jsdom loads no CSS, so this reads the stylesheet itself,
// comments stripped first (they mention the old sizes).
const source = readFileSync(join(process.cwd(), 'src/components/FilmClubScreen.vue'), 'utf8');
const css = source.slice(source.indexOf('<style')).replace(/\/\*[\s\S]*?\*\//g, '');

function rule (selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`(?:^|\\n)${escaped}\\s*\\{([^}]*)\\}`));
  return match ? match[1] : '';
}

describe('Film Club Activity feed poster size', () => {
  // Follow-up report (2026-10-08): "now they overlap with the bug button a
  // little bit in the bottom left corner". The strip must stop above the fixed
  // bug button (bottom 1rem + home-bar inset, 2.75rem tall), not at the footer.
  const SHAPE = /--feed-poster-h:\s*clamp\((\d+)px,\s*calc\(100(d?vh) - (\d+)px - env\(safe-area-inset-bottom, 0px\)\),\s*(\d+)px\)/g;

  it('sizes the poster from the screen height, minus the home-bar inset, floored and capped', () => {
    const lines = [...rule('.cs-feed-row').matchAll(SHAPE)];
    // A browser without dvh keeps the vh line before it.
    expect(lines.map((m) => m[2])).toEqual(['vh', 'dvh']);
    for (const [, floor, , , cap] of lines) {
      expect(Number(cap)).toBeGreaterThan(Number(floor));
      expect(Number(cap)).toBeLessThanOrEqual(400);
    }
  });

  it('leaves the strip clear of the bug button on a 695px-tall phone', () => {
    // 462px was the rest of the tab down to the footer's bottom; the bug
    // button's top sits 60px up, the footer is ~26px, plus a small gap.
    for (const [, floor, , rest] of rule('.cs-feed-row').matchAll(SHAPE)) {
      expect(Number(rest)).toBeGreaterThanOrEqual(462 + 60 - 26);
      // The floor must not push the strip back under the button there.
      expect(Number(floor)).toBeLessThanOrEqual(695 - Number(rest));
    }
  });

  it('keeps the 2:3 poster shape: width follows the height', () => {
    expect(rule('.cs-feed-row')).toMatch(/--feed-poster-w:\s*calc\(var\(--feed-poster-h\) \* 2 \/ 3\)/);
    const poster = rule('.cs-feed-row .cs-poster');
    expect(poster).toMatch(/height:\s*var\(--feed-poster-h\)/);
    expect(poster).toMatch(/width:\s*var\(--feed-poster-w\)/);
    const card = rule('.cs-feed-row .cs-poster-card');
    expect(card).toMatch(/flex:\s*0 0 var\(--feed-poster-w\)/);
    expect(card).toMatch(/width:\s*var\(--feed-poster-w\)/);
  });
});
