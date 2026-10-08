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
  it('sizes the poster from the screen height, floored at 234px and capped', () => {
    const row = rule('.cs-feed-row');
    expect(row).toMatch(/--feed-poster-h:\s*clamp\(234px,\s*calc\(100dvh - \d+px\),\s*\d+px\)/);
    // A browser without dvh keeps the vh line before it.
    expect(row).toMatch(/--feed-poster-h:\s*clamp\(234px,\s*calc\(100vh - \d+px\),\s*\d+px\)/);
    const cap = Number(row.match(/100dvh - \d+px\),\s*(\d+)px\)/)[1]);
    expect(cap).toBeGreaterThan(234);
    expect(cap).toBeLessThanOrEqual(400);
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
