import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { showtimeLabel } from '../components/ShowtimesScreen.vue';

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
  });

  it('labels a showing on the cinema clock without a timezone getting a say', () => {
    expect(showtimeLabel('2026-10-02T15:20:00')).toBe('Fri Oct 2, 3:20 PM');
    expect(showtimeLabel('2026-10-26')).toBe('Mon Oct 26');
    expect(showtimeLabel('2026-10-31T00:05:00')).toBe('Sat Oct 31, 12:05 AM');
    expect(showtimeLabel(null)).toBe('');
  });
});
