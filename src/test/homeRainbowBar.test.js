import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Report, 2026-10-24: "Awards needs to be a more more of a first-class object
// here. I go to there all the time." Awards left the Insights directory for a
// chip of its own on Home's rainbow bar. The bar used to colour its chips by
// position (:nth-child), so inserting one shifted every colour after it; each
// chip now names its colour. Read from the source: jsdom loads no CSS.
const source = () => readFileSync(join(__dirname, '../components/Home.vue'), 'utf8');
const actionsRow = () => {
  const text = source();
  const start = text.indexOf('<div class="results-actions ');
  return text.slice(start, text.indexOf('<ul class="dropdown-menu', start));
};
const chips = () => [...actionsRow().matchAll(/<button[^>]*class="results-actions-button (chip-[a-z]+)/g)].map((m) => m[1]);

describe('the rainbow bar', () => {
  it('has an Awards chip, beside Insights, that goes to /awards', () => {
    expect(chips()).toEqual(['chip-settings', 'chip-games', 'chip-count', 'chip-insights', 'chip-awards', 'chip-club', 'chip-watchlist', 'chip-sort']);
    const awards = actionsRow().match(/<button[^>]*chip-awards[^>]*>/)[0];
    expect(awards).toContain("$router.push('/awards')");
  });

  it('pins every chip colour by name, so the existing chips kept theirs', () => {
    const css = source();
    const colour = (chip) => css.match(new RegExp(`&\\.${chip} \\{\\s*background-color: (#[0-9A-Fa-f]+)`))?.[1];
    expect(colour('chip-settings')).toBe('#E71D36');
    expect(colour('chip-games')).toBe('#FF9F1C');
    expect(colour('chip-count')).toBe('#FFD700');
    expect(colour('chip-insights')).toBe('#24d776');
    expect(colour('chip-club')).toBe('#1D8BF1');
    expect(colour('chip-watchlist')).toBe('#5A189A');
    expect(colour('chip-sort')).toBe('#cd7fe8');
    expect(colour('chip-awards')).toBeTruthy();
    expect(css).not.toMatch(/\.results-actions-button[\s\S]{0,2000}&:nth-child\(1\) \{\s*background-color/);
  });

  it('Year in Review and Library Poster are Settings rows beside the Newsletter', () => {
    const text = source();
    const newsletter = text.indexOf('<SettingsSection title="Newsletter"');
    const year = text.indexOf('<SettingsSection title="Year in Review"');
    const poster = text.indexOf('<SettingsSection title="Library Poster"');
    expect(newsletter).toBeGreaterThan(-1);
    expect(year).toBeGreaterThan(newsletter);
    expect(poster).toBeGreaterThan(year);
    expect(text.slice(year, text.indexOf('/>', year))).toContain('to="/year-in-review"');
    expect(text.slice(poster, text.indexOf('/>', poster))).toContain('to="/library-poster"');
  });
});
