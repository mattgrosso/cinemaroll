import { describe, expect, it } from 'vitest';
import { awardsItem, boardMovieIds, buildClubFeed, CATEGORIES, categoryMatchKey, externalAwardItems, externalAwardYears, externalBoards, externalItems, releaseAwardYears, awardsReleaseAt, posterGrid, houseCategoryRank, logItems, reviewItems } from './clubPaper.js';
import { PERSONAL_AWARD_CATEGORIES } from '../src/assets/javascript/personalAwardsCategories.js';
import { categoryMatchKey as appMatchKey, houseCategoryRank as appRank } from '../src/assets/javascript/awardsShare.js';

const since = Date.parse('2026-10-06T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

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
    const reviews = { 4232: { a: { title: 'Scream', year: 1996, rating: 2.5, review: 'First one.\n\nScary <b>', spoilers: true, publishedAt: Date.parse('2026-10-25T20:00:00Z'), url: 'https://letterboxd.com/x' }, b: { title: 'Scream', rating: 3, publishedAt: '2026-10-26T20:00:00Z' } } };
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

  it('an awards board carries its name, the nominees, and the app\'s order with custom awards last', () => {
    // Stored in the database's (alphabetical) order, as Firebase hands it back.
    const board = {
      lastUpdated: 5, completed: true,
      customCategories: { 'custom-b': { name: 'Best Dog', createdAt: 2 }, 'custom-a': { name: 'Biggest Scare', createdAt: 1 } },
      categories: {
        'custom-a': { winner: { movieId: 745, type: 'movie' }, nominees: [{ movieId: 745 }] },
        'custom-b': { nominees: { 0: { movieId: 2 } } },
        bestActress: { winner: { name: 'Toni Collette', movieId: 745, type: 'person' }, nominees: [{ name: 'Toni Collette', movieId: 745, type: 'person' }, { name: 'Hilary Swank', movieId: 3, type: 'person' }] },
        bestPicture: { winner: { movieId: 745, type: 'movie' }, nominees: [{ movieId: 2 }, { movieId: 745 }, { movieId: 99 }] },
        bestScreenplay: { winner: { movieId: 2 }, nominees: [{ movieId: 2 }] }
      }
    };
    const titles = { 745: 'The Sixth Sense', 2: 'Magnolia', 3: 'Boys Don\'t Cry' };
    const item = awardsItem({ key: 'nat', name: 'Natalie Grosso', year: '1999', board, awardsName: 'The Roses' }, (id) => titles[id] || null);
    expect(item.title).toBe("Natalie's 1999 Roses: The Sixth Sense for Best Picture");
    expect(item.content_html).toBe(
      '<p><b>Best Picture</b> · The Sixth Sense<br><small>Also nominated: Magnolia</small></p>' +
      '<p><b>Best Actress</b> · Toni Collette <i>(The Sixth Sense)</i><br><small>Also nominated: Hilary Swank <i>(Boys Don&#39;t Cry)</i></small></p>'.replace('&#39;', "'") +
      '<p><b>Best Screenplay or Writing</b> · Magnolia</p>' +
      '<p><b>Biggest Scare</b> · The Sixth Sense</p>' +
      '<p><b>Best Dog</b><br><small>Nominees: Magnolia</small></p>'
    );
    expect(awardsItem({ key: 'n', name: 'N', year: '1', board: { ...board }, awardsName: 'Oscar' }, () => 'X').title).toBe("N's 1 awards: X for Best Picture");
    expect(boardMovieIds(board)).toEqual([745, 2, 99, 3]);
  });

  it('the Lambda\'s copy of the categories and their order matches the app', () => {
    expect(CATEGORIES).toEqual(PERSONAL_AWARD_CATEGORIES.map(({ key, name, type }) => ({ key, name, type })));
    for (const label of ['Best Film', 'Best Writing', 'Best Actress in a Supporting Role', 'Directing', 'Best Motion Picture – Drama', 'Best Original Score', 'Worst Hair', 'Most Important Movie']) {
      expect(categoryMatchKey(label)).toBe(appMatchKey(label));
      expect(houseCategoryRank(label)).toBe(appRank(label));
    }
  });

  it('a Movie Log friend\'s awards fold into boards and are told when a year changes, the newest only at first', () => {
    const movies = [
      { tmdbId: 1, title: 'Arrival', awards: [{ year: 2016, category: 'pic', label: 'Brians: Best Film', result: 'won' }, { year: 2016, category: 'act', label: 'Brians: Best Actress', result: 'won', name: 'Amy Adams' }] },
      { tmdbId: 2, title: 'Moonlight', awards: [{ year: 2016, category: 'pic', label: 'Brians: Best Film', result: 'nominated', name: 'A Producer' }, { year: 2015, category: 'pic', label: 'Brians: Best Film', result: 'won' }] }
    ];
    const boards = externalBoards(movies, null);
    const b2016 = boards['Brians|2016'];
    expect(b2016.categories.map((c) => c.label)).toEqual(['Best Film', 'Best Actress']);
    expect(b2016.categories[0]).toEqual({ label: 'Best Film', winners: ['Arrival'], nominees: ['Moonlight'] });
    expect(b2016.categories[1].winners).toEqual(['Amy Adams <i>(Arrival)</i>']);

    const T = Date.parse('2026-11-11T00:00:00Z');
    const first = externalAwardYears(boards, null, T + 100);
    const told = Object.values(first).filter((y) => y.at);
    expect(told.map((y) => y.year)).toEqual([2016]);
    const items = externalAwardItems({ id: 'ext-1', name: 'Brian Goegan', years: first }, T + 50);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Brian's 2016 Brians: Arrival for Best Film");
    expect(items[0].content_html).toBe('<p><b>Best Film</b> · Arrival<br><small>Also nominated: Moonlight</small></p><p><b>Best Actress</b> · Amy Adams <i>(Arrival)</i></p>');

    // Nothing moved: nothing new. 2015 changes: told, 2016 keeps its old story.
    const same = externalAwardYears(boards, first, T + 200);
    expect(Object.values(same).filter((y) => y.at === T + 200)).toHaveLength(0);
    movies[1].awards.push({ year: 2015, category: 'act', label: 'Brians: Best Actor', result: 'won', name: 'Someone' });
    const moved = externalAwardYears(externalBoards(movies, null), same, T + 300);
    expect(Object.values(moved).filter((y) => y.at === T + 300).map((y) => y.year)).toEqual([2015]);
    expect(Object.values(moved).filter((y) => y.at === T + 100).map((y) => y.year)).toEqual([2016]);
    expect(Object.keys(moved).every((k) => /^[A-Za-z0-9-]+$/.test(k))).toBe(true);
  });

  it('a year\'s awards are held until 1 March of the next year, Eastern', () => {
    expect(new Date(awardsReleaseAt('2026')).toISOString()).toBe('2027-03-01T05:00:00.000Z');
    const board = { lastUpdated: Date.parse('2026-11-10T00:00:00Z'), categories: { bestPicture: { winner: { movieId: 1, type: 'movie' } } } };
    const make = (now) => awardsItem({ key: 'k', name: 'Knox', year: '2026', board, now }, () => 'Project Hail Mary (2026)');
    expect(make(Date.parse('2027-02-28T23:59:00-05:00'))).toBeNull();
    const out = make(Date.parse('2027-03-01T00:00:00-05:00'));
    expect(out.date_published).toBe('2027-03-01T05:00:00.000Z');
    expect(out.id).toBe(`awards-k-2026-${awardsReleaseAt(2026)}`);
    // Touched after its March: told as of the touch, as before.
    const later = Date.parse('2027-04-02T00:00:00Z');
    expect(awardsItem({ key: 'k', name: 'Knox', year: '2026', board: { ...board, lastUpdated: later }, now: later + 1 }, () => 'X').date_published).toBe(iso(later));
  });

  it('a Movie Log friend\'s year under way is held, then told once on the first check after its March', () => {
    const movies = [{ tmdbId: 9, title: 'Project Hail Mary', awards: [{ year: 2026, category: 'pic', label: 'Ollies: Best Picture', result: 'won' }] }];
    const nov = Date.parse('2026-11-11T12:00:00Z');
    const held = externalAwardYears(externalBoards(movies, null), {}, nov);
    const [slot] = Object.keys(held);
    expect(held[slot].held).toBe(true);
    expect(held[slot].at).toBeUndefined();
    expect(externalAwardItems({ id: 'e', name: 'Knox', years: held }, 0)).toHaveLength(0);
    // A story told before the hold existed is taken back.
    expect(releaseAwardYears({ [slot]: { ...held[slot], held: undefined, at: nov - 1000 } }, nov)[slot].held).toBe(true);
    // Still February: unchanged (same object).
    const feb = Date.parse('2027-02-28T23:00:00-05:00');
    expect(releaseAwardYears(held, feb)).toBe(held);
    const mar = Date.parse('2027-03-01T08:00:00-05:00');
    const out = releaseAwardYears(held, mar);
    expect(out[slot].at).toBe(mar);
    expect(out[slot].held).toBeUndefined();
    expect(releaseAwardYears(out, mar + 1000)).toBe(out);
    const items = externalAwardItems({ id: 'e', name: 'Knox', years: out }, mar - 1, (id) => (id === 9 ? 'https://image.tmdb.org/t/p/w342/phm.jpg' : null));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Knox's 2026 Ollies: Project Hail Mary for Best Picture");
    expect(items[0].image).toBe('https://image.tmdb.org/t/p/w342/phm.jpg');
    expect(items[0].content_html.startsWith('<div><figure><img src="https://image.tmdb.org/t/p/w342/phm.jpg"')).toBe(true);
    // A fresh read after the March tells a held board (its hash unchanged) once, then not again.
    const fresh = externalAwardYears(externalBoards(movies, null), held, mar);
    expect(fresh[slot].at).toBe(mar);
    expect(externalAwardYears(externalBoards(movies, null), fresh, mar + 5000)[slot].at).toBe(mar);
  });

  it('an awards story opens on the main winners\' posters, a film winning twice on one poster', () => {
    const board = { lastUpdated: Date.parse('2026-10-10T00:00:00Z'), completed: true, categories: {
      bestPicture: { winner: { movieId: 745, type: 'movie' } },
      bestActor: { winner: { name: 'Bruce Willis', movieId: 745, type: 'person' } },
      bestActress: { winner: { name: 'Hilary Swank', movieId: 3, type: 'person' } },
      bestScreenplay: { winner: { movieId: 2 } } } };
    const titles = { 745: 'The Sixth Sense', 2: 'Magnolia', 3: 'Boys Don\'t Cry' };
    const posters = { 745: 'https://image.tmdb.org/t/p/w342/ss.jpg', 2: 'https://image.tmdb.org/t/p/w342/m.jpg', 3: 'https://image.tmdb.org/t/p/w342/b.jpg' };
    const item = awardsItem({ key: 'nat', name: 'Natalie', year: '1999', board }, (id) => titles[id], (id) => posters[id]);
    expect(item.image).toBe(posters[745]);
    const grid = item.content_html.slice(0, item.content_html.indexOf('</div>') + 6);
    expect(grid).toBe('<div>' +
      '<figure><img src="https://image.tmdb.org/t/p/w342/ss.jpg" alt="The Sixth Sense" loading="lazy"><figcaption><b>Best Picture</b><br><b>Best Actor</b><br>Bruce Willis</figcaption></figure>' +
      '<figure><img src="https://image.tmdb.org/t/p/w342/b.jpg" alt="Boys Don\'t Cry" loading="lazy"><figcaption><b>Best Actress</b><br>Hilary Swank</figcaption></figure>' +
      '</div>');
    expect(grid).not.toContain('m.jpg');
    // No posters known: the story is the list alone, as before.
    expect(awardsItem({ key: 'nat', name: 'Natalie', year: '1999', board }, (id) => titles[id]).content_html.startsWith('<p>')).toBe(true);
    expect(posterGrid([{ label: 'Best Picture', posterUrl: 'javascript:alert(1)' }])).toBe('');
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
    const feed = await buildClubFeed({ topKey: 'me', db, now, readExternal: async () => ({ revision: 'r1', watches: [{ tmdbId: 568, title: 'Apollo 13', watchedAt: now - 2000, score: 9.9 }], awardsName: 'The Briannies', awards: [{ tmdbId: 568, title: 'Apollo 13', awards: [{ year: 1995, category: 'p', label: 'Best Picture', result: 'won' }] }] }), titleOf: async (id) => (id === 745 ? 'The Sixth Sense' : null) });
    expect(feed.items.map((i) => i.title)).toEqual(["Brian's 1995 Briannies: Apollo 13 for Best Picture", 'Seth watched Film', 'Brian logged Apollo 13', "Seth's 1999 awards: The Sixth Sense for Best Picture"]);
    expect(reads).toContain('seth/movieLog?shallow=true');
    expect(reads).not.toContain('seth/movieLog/1709866106769-y-Old');
    expect(reads.some((r) => r.startsWith('cinemaroll-tester-example-com'))).toBe(false);
    expect(writes['me/paper/club/external/ext-1'].revision).toBe('r1');
    expect(writes['me/paper/club/external/ext-1'].awardsRead).toBe(true);
    expect(reads).toContain('seth/settings/personalAwardName');
  });
});
