import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { showtimeLabel } from '../components/ShowtimesScreen.vue';
import { posterQuery } from '../utils/posterLookup.js';

// The Showtimes screen (2026-09-28) is a read-only view of the board the
// push sweep publishes. These pin the wiring that would otherwise fail
// silently: the route, the Insights card, the store read, and the fact
// that the screen never writes the board.
const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('Showtimes screen wiring', () => {
  it('is routed under Insights and linked from its directory', () => {
    const router = read('../router/index.js');
    expect(router).toMatch(/path: '\/showtimes',[\s\S]*?parent: '\/insights'/);
    const insights = read('../components/Insights.vue');
    expect(insights).toContain("$router.push('/showtimes')");
    expect(insights).toContain("dispatch('loadTheaterBoard')");
  });

  it('reads the board the sweep writes, and only reads it', () => {
    const store = read('../store/index.js');
    expect(store).toContain('`${root}/theaters/board`');
    const lambda = read('../../aws-lambda/push-notify.js');
    expect(lambda).toContain('/theaters/board`');
    const screen = read('../components/ShowtimesScreen.vue');
    expect(screen).not.toMatch(/\bset\(|\bupdate\(/);
    // Dismissals go through the store, to their own node, never the board.
    expect(screen).toContain("dispatch('dismissListing'");
    expect(store).toContain('`${root}/theaters/dismissed/${theaterKey}`');
    // Reminders likewise: the screen chooses the time, the store writes it,
    // the sweep sends it.
    expect(screen).toContain("dispatch('remindListing'");
    expect(store).toContain('`${root}/theaters/reminders/${theaterKey}`');
    expect(lambda).toContain('/theaters/reminders`');
  });

  it('labels a showing on the cinema clock without a timezone getting a say', () => {
    expect(showtimeLabel('2026-10-02T15:20:00')).toBe('Fri Oct 2, 3:20 PM');
    expect(showtimeLabel('2026-10-26')).toBe('Mon Oct 26');
    expect(showtimeLabel('2026-10-31T00:05:00')).toBe('Sat Oct 31, 12:05 AM');
    expect(showtimeLabel(null)).toBe('');
  });

  it('asks TMDB for the film, not the format note or the event suffix', () => {
    expect(posterQuery('HALLOWEEN (1978) in 35mm')).toEqual({ query: 'HALLOWEEN', year: 1978 });
    expect(posterQuery("DON'T PLAY WITH FIRE - New Restoration")).toEqual({ query: "DON'T PLAY WITH FIRE", year: null });
    expect(posterQuery('Dune: Part Three (Advance Screening)', 2026)).toEqual({ query: 'Dune: Part Three', year: 2026 });
    expect(posterQuery('Avengers: Endgame', 2019).year).toBe(2019);
    expect(posterQuery('').query).toBe('');
  });
});
