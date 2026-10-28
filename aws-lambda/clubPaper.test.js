import { describe, expect, it } from 'vitest';
import { awardsItem, buildClubFeed, externalItems, logItems, reviewItems } from './clubPaper.js';

const since = Date.parse('2026-10-06T00:00:00Z');

describe('club paper items', () => {
  it('a friend\'s new viewings become one item each, old ones stay out', () => {
    const entries = {
      '1792808221530-x-Film': { movie: { id: 7, title: 'Film', poster_path: '/p.jpg' }, ratings: [{ date: Date.parse('2026-10-20T00:00:00Z'), rating: 8.25, medium: 'Theater', title: 'Film', year: 2026, id: 7, tags: [{ title: 'New' }] }] },
      '1709866106769-y-Old': { movie: { id: 8, title: 'Old' }, ratings: [{ date: Date.parse('2024-03-01T00:00:00Z'), rating: 5 }] }
    };
    const items = logItems({ key: 'seth', name: 'Seth Hopper', entries }, since);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Seth watched Film (2026)');
    expect(items[0].content_html).toBe('<p>On Theater. Rated it 8.3 out of 10. Tagged New.</p>');
    expect(items[0].url).toBe('https://www.cinemaroll.org/movie/7');
    expect(items[0].image).toBe('https://image.tmdb.org/t/p/w500/p.jpg');
  });

  it('a Letterboxd review carries its stars, words and spoiler warning', () => {
    const reviews = { 4232: { a: { title: 'Scream', year: 1996, rating: 2.5, review: 'First one.\n\nScary <b>', spoilers: true, publishedAt: '2026-10-25T20:00:00Z', url: 'https://letterboxd.com/x' }, b: { title: 'Scream', rating: 3, publishedAt: '2026-10-26T20:00:00Z' } } };
    const items = reviewItems({ key: 'nat', name: 'Natalie Grosso', reviews }, since);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Natalie on Scream (1996): ★★½');
    expect(items[0].content_html).toBe('<p><i>Spoilers.</i></p><p>First one.</p><p>Scary &lt;b&gt;</p>');
    expect(items[0].url).toBe('https://letterboxd.com/x');
  });

  it('an awards board lists winners by category with the film in brackets for people', () => {
    const board = { lastUpdated: Date.parse('2026-10-10T00:00:00Z'), completed: false, categories: { bestPicture: { winner: { movieId: 745, type: 'movie' } }, bestActor: { winner: { id: 'Bruce Willis', name: 'Bruce Willis', movieId: 745, type: 'person' } }, bestScore: { noNominees: true } } };
    const item = awardsItem({ key: 'nat', name: 'Natalie', year: '1999', board }, (id) => (id === 745 ? 'The Sixth Sense' : null));
    expect(item.title).toBe("Natalie's 1999 awards: The Sixth Sense for Best Picture (so far)");
    expect(item.content_html).toBe('<p><b>Best Picture</b> · The Sixth Sense</p><p><b>Best Actor</b> · Bruce Willis <i>(The Sixth Sense)</i></p>');
    expect(awardsItem({ key: 'n', name: 'N', year: '1', board: { lastUpdated: 1, categories: {} } }, () => null)).toBeNull();
  });

  it('a Movie Log friend\'s watches in the window become logs', () => {
    const items = externalItems({ id: 'ext-1', name: 'Brian Goegan', watches: [{ tmdbId: 568, title: 'Apollo 13', watchedAt: Date.parse('2026-10-21T00:00:00Z'), score: 9.97 }, { tmdbId: 1, title: 'Old', watchedAt: 1, score: 1 }] }, since);
    expect(items.map((i) => i.title)).toEqual(['Brian logged Apollo 13']);
    expect(items[0].content_html).toBe('<p>Rated it 9.97 out of 10.</p>');
  });

  it('buildClubFeed reads shallow keys, skips the tester, caches an external feed by its revision', async () => {
    const now = Date.parse('2026-10-27T00:00:00Z');
    const data = {
      'social/friends/me': { seth: true, 'cinemaroll-tester-example-com': true },
      'social/directory/seth/name': 'Seth Hopper',
      'seth/movieLog': { '1792808221530-x-Film': true, '1709866106769-y-Old': true },
      'seth/movieLog/1792808221530-x-Film': { movie: { id: 7, title: 'Film' }, ratings: [{ date: now - 1000, rating: 7, title: 'Film', id: 7 }] },
      'seth/settings/letterboxdUsername': null,
      'seth/personalAwards': { 1999: true },
      'seth/personalAwards/1999/lastUpdated': now - 5000,
      'seth/personalAwards/1999': { lastUpdated: now - 5000, completed: true, categories: { bestPicture: { winner: { movieId: 745, type: 'movie' } } } },
      'me/settings/externalFriends': { 'ext-1': { name: 'Brian Goegan', feedUrl: 'https://x/clubFeed/a/b.json' } }
    };
    const reads = [];
    const writes = {};
    const db = { get: async (p, q) => { reads.push(q ? `${p}?${q}` : p); return p in writes ? writes[p] : data[p] ?? null; }, set: async (p, v) => { writes[p] = v; } };
    const feed = await buildClubFeed({ topKey: 'me', db, now, readExternal: async () => ({ revision: 'r1', watches: [{ tmdbId: 568, title: 'Apollo 13', watchedAt: now - 2000, score: 9.9 }] }), titleOf: async (id) => (id === 745 ? 'The Sixth Sense' : null) });
    expect(feed.items.map((i) => i.title)).toEqual(['Seth watched Film', 'Brian logged Apollo 13', "Seth's 1999 awards: The Sixth Sense for Best Picture"]);
    expect(reads).toContain('seth/movieLog?shallow=true');
    expect(reads).not.toContain('seth/movieLog/1709866106769-y-Old');
    expect(reads.some((r) => r.startsWith('cinemaroll-tester-example-com'))).toBe(false);
    expect(writes['me/paper/club/external/ext-1'].revision).toBe('r1');
  });
});
