import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { showtimeLabel } from '../components/ShowtimesScreen.vue';
import { posterQuery, titleWithYear } from '../utils/posterLookup.js';
import { theaterHref, opensInNewTab, ALAMO_APP_LINK } from '../assets/javascript/theaterLinks.js';

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
    // A notification lands on this screen, never on a theater's site.
    const cadence = read('../../aws-lambda/pushCadence.js');
    expect(cadence).toMatch(/navigate: `\/showtimes\?focus=/);
    expect(cadence).not.toMatch(/navigate: entry\.url|navigate: reminder\.url/);
    expect(screen).toContain('query?.focus');
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

  it('lists the year, but never twice ("sometimes it\'s in the title … let\'s not duplicate")', () => {
    expect(titleWithYear('Beetlejuice', 1988)).toBe('Beetlejuice (1988)');
    expect(titleWithYear('Halloween (1978)', 1978)).toBe('Halloween (1978)');
    expect(titleWithYear('Sabrina – 1954', 1954)).toBe('Sabrina – 1954');
    expect(titleWithYear('Street Fighter (2026)', 2026)).toBe('Street Fighter (2026)');
    expect(titleWithYear('Blade Runner 2049', 2017)).toBe('Blade Runner 2049');
    expect(titleWithYear('Terminator 2: Judgment Day', 1991)).toBe('Terminator 2: Judgment Day (1991)');
    expect(titleWithYear('Tenet', null)).toBe('Tenet');
  });
});

describe('Showtimes links', () => {
  const alamo = { key: 'alamo-bryant-street', url: 'https://drafthouse.com/dc-metro-area/theater/dc-bryant-street' };
  const afi = { key: 'afi-silver', url: 'https://silver.afi.com/now-playing/' };

  it('opens the Alamo app, with nothing attached ("I just need it to open")', () => {
    expect(ALAMO_APP_LINK).toBe('shortcuts://run-shortcut?name=Open%20Alamo');
    expect(theaterHref(alamo)).toBe(ALAMO_APP_LINK);
    expect(theaterHref(alamo, { url: 'https://drafthouse.com/dc-metro-area/show/x?cinemaId=1101' })).toBe(ALAMO_APP_LINK);
    // An app link in a new tab would leave a blank one behind.
    expect(opensInNewTab(ALAMO_APP_LINK)).toBe(false);
  });

  it('leaves every other theater on its own site, in a new tab', () => {
    expect(theaterHref(afi, { url: 'https://silver.afi.com/movies/detail/1' })).toBe('https://silver.afi.com/movies/detail/1');
    expect(theaterHref(afi, {})).toBe(afi.url);
    expect(theaterHref(afi)).toBe(afi.url);
    expect(theaterHref({ key: 'x' })).toBe(null);
    expect(opensInNewTab(afi.url)).toBe(true);
  });

  it('routes both the posters and the theater heading through it', () => {
    const screen = read('../components/ShowtimesScreen.vue');
    expect(screen).toContain(':href="hrefFor(theater, item)"');
    expect(screen).toContain(':href="hrefFor(theater)"');
    expect(screen).not.toMatch(/:href="item\.url|:href="theater\.url/);
  });
});
