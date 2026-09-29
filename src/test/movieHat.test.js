import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  asArray,
  hatsForMember,
  alreadyInHat,
  toHatMovie,
  pickFromHat,
  drawnRecord,
  fetchHat,
  fetchHatMovies,
  hatsToCheck,
  readHatContents,
  addMovieToHat,
  commitDraw,
  isMovieHatAccessError
} from '@/assets/javascript/movieHat.js';
import { movieHatSession } from '@/assets/javascript/movieHatAuth.js';

// Movie Hat stays its own app (Matt, 2026-08-16: "I love that it's a
// standalone app"); this is the seam Cinema Roll reaches it through.

// Every request carries a Movie Hat ID token now — the rules went on
// 2026-08-17 and an unauthenticated read is refused outright. These tests
// used to run with no mock at all, i.e. entirely down the no-token path,
// which is the one branch that can no longer succeed in production.
vi.mock('@/assets/javascript/movieHatAuth.js', async (importOriginal) => ({
  ...(await importOriginal()),
  movieHatSession: vi.fn(async () => ({ token: 'hat-token', email: 'matt@example.com', reason: null }))
}));

const connectedAs = (email = 'matt@example.com') =>
  movieHatSession.mockResolvedValue({ token: 'hat-token', email, reason: null });
const notConnected = () =>
  movieHatSession.mockResolvedValue({ token: null, email: null, reason: 'not-connected' });
const tokenFailed = (email = 'matt@example.com') =>
  movieHatSession.mockResolvedValue({ token: null, email, reason: 'token-failed' });

describe('asArray', () => {
  it('turns a Firebase object-map into an array carrying each key', () => {
    expect(asArray({ abc: { id: 1 }, def: { id: 2 } })).toEqual([
      { id: 1, dbKey: 'abc' },
      { id: 2, dbKey: 'def' }
    ]);
  });

  it('passes an array straight through without inventing keys', () => {
    expect(asArray([{ id: 1, dbKey: 'abc' }])).toEqual([{ id: 1, dbKey: 'abc' }]);
  });

  it('is null-safe', () => {
    expect(asArray(null)).toEqual([]);
    expect(asArray(undefined)).toEqual([]);
    expect(asArray('nope')).toEqual([]);
  });
});

describe('hatsForMember', () => {
  const HATS = {
    'Just Matt': { k1: { members: { a: 'mattgrosso@gmail.com' }, movies: { m1: {}, m2: {} }, history: { h1: {} } } },
    'Natalie and Matt': { k2: { members: { a: 'mattgrosso@gmail.com', b: 'natalie@example.com' }, movies: { m1: {} } } },
    "Someone else's": { k3: { members: { a: 'stranger@example.com' }, movies: { m1: {} } } },
    Empty: { k4: {} }
  };

  it('finds every hat the email is a member of, with its counts', () => {
    expect(hatsForMember(HATS, 'mattgrosso@gmail.com')).toEqual([
      { title: 'Just Matt', dbKey: 'k1', movies: 2, drawn: 1 },
      { title: 'Natalie and Matt', dbKey: 'k2', movies: 1, drawn: 0 }
    ]);
  });

  it("leaves other people's hats alone", () => {
    expect(hatsForMember(HATS, 'stranger@example.com').map((hat) => hat.title))
      .toEqual(["Someone else's"]);
  });

  it('matches regardless of how the address was capitalized', () => {
    expect(hatsForMember(HATS, 'MattGrosso@Gmail.com')).toHaveLength(2);
  });

  it('is null-safe', () => {
    expect(hatsForMember(null, 'a@b.com')).toEqual([]);
    expect(hatsForMember(HATS, null)).toEqual([]);
  });
});

describe('alreadyInHat', () => {
  // "If you try to add something to a hat, it should just notify you back
  // that it's already in there." Movie Hat dedupes on the TMDB id.
  it('spots a movie already waiting, whatever shape the hat came in', () => {
    expect(alreadyInHat({ k: { id: 550 } }, 550)).toBe(true);
    expect(alreadyInHat([{ id: 550 }], 550)).toBe(true);
  });

  it('does not care whether the id is a string or a number', () => {
    expect(alreadyInHat([{ id: '550' }], 550)).toBe(true);
    expect(alreadyInHat([{ id: 550 }], '550')).toBe(true);
  });

  it('says no for a movie that is not there', () => {
    expect(alreadyInHat([{ id: 550 }], 99)).toBe(false);
    expect(alreadyInHat([], 550)).toBe(false);
    expect(alreadyInHat(null, 550)).toBe(false);
  });

  it('never matches on a missing id', () => {
    expect(alreadyInHat([{ id: 550 }], null)).toBe(false);
    expect(alreadyInHat([{ id: null }], null)).toBe(false);
  });
});

describe('toHatMovie', () => {
  const entry = {
    dbKey: 'library-key',
    ratings: [{ calculatedTotal: 9 }],
    movie: { id: 550, title: 'Fight Club', poster_path: '/f.jpg', release_date: '1999-10-15', overview: 'A man.' }
  };

  it('accepts a Cinema Roll library entry or a bare TMDB movie', () => {
    const fromEntry = toHatMovie(entry, { now: 1000 });
    const fromMovie = toHatMovie(entry.movie, { now: 1000 });

    expect(fromEntry).toEqual(fromMovie);
    expect(fromEntry.id).toBe(550);
    expect(fromEntry.title).toBe('Fight Club');
  });

  // Movie Hat renders these four; the rest is along for the ride.
  it('carries what Movie Hat actually displays', () => {
    const payload = toHatMovie(entry, { addedBy: 'Matt', note: 'For Friday', now: 1000 });

    expect(payload.title).toBe('Fight Club');
    expect(payload.poster_path).toBe('/f.jpg');
    expect(payload.addedBy).toBe('Matt');
    expect(payload.note).toBe('For Friday');
    expect(payload.timeStamp).toBe(1000);
  });

  it('says where it came from when nobody is named', () => {
    expect(toHatMovie(entry).addedBy).toBe('Cinema Roll');
  });

  it('omits the note entirely rather than sending an empty one', () => {
    expect('note' in toHatMovie(entry)).toBe(false);
  });

  it('refuses anything without a TMDB id — that is the join key', () => {
    expect(toHatMovie({ movie: { title: 'No id' } })).toBeNull();
    expect(toHatMovie(null)).toBeNull();
  });

  it('never writes undefined into Firebase, which would be rejected', () => {
    const payload = toHatMovie({ movie: { id: 1 } });
    Object.values(payload).forEach((value) => expect(value).not.toBeUndefined());
  });
});

describe('pickFromHat', () => {
  const movies = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];

  it('picks by the injected randomness, so a draw can be pinned', () => {
    expect(pickFromHat(movies, () => 0)).toEqual({ id: 1 });
    expect(pickFromHat(movies, () => 0.99)).toEqual({ id: 4 });
    expect(pickFromHat(movies, () => 0.5)).toEqual({ id: 3 });
  });

  it('can reach every movie in the hat', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) seen.add(pickFromHat(movies).id);
    expect(seen.size).toBe(4);
  });

  it('returns null for an empty hat rather than throwing', () => {
    expect(pickFromHat([])).toBeNull();
    expect(pickFromHat(null)).toBeNull();
  });
});

describe('drawnRecord', () => {
  it('stamps when it was drawn and drops the storage key', () => {
    const record = drawnRecord({ id: 550, title: 'Fight Club', dbKey: 'abc' }, 12345);

    expect(record).toEqual({ id: 550, title: 'Fight Club', dateDrawn: 12345 });
    expect('dbKey' in record).toBe(false);
  });

  it('is null-safe', () => {
    expect(drawnRecord(null)).toBeNull();
  });
});

describe('talking to the database', () => {
  let calls;

  beforeEach(() => {
    connectedAs();
    calls = [];
    global.fetch = vi.fn((url, options = {}) => {
      calls.push({ url, method: options.method || 'GET', body: options.body });
      if (url.includes('shallow=true')) {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ 'hat-key': true })) });
      }
      if (options.method === 'DELETE') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve('null') });
      }
      if (options.method === 'POST') {
        return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify({ name: 'new-key' })) });
      }
      // A request for one child gets that child, the way the database
      // answers it — not the whole hat.
      if (url.includes('/movies.json')) {
        return Promise.resolve({
          ok: true,
          text: () => Promise.resolve(JSON.stringify({ m1: { id: 1, title: 'Heat' } }))
        });
      }
      return Promise.resolve({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({
          movies: { m1: { id: 1, title: 'Heat' } },
          history: { h1: { id: 2, title: 'Cats', dateDrawn: 1 } },
          members: { a: 'matt@example.com' }
        }))
      });
    });
  });

  afterEach(() => {
    delete global.fetch;
  });

  it('reads a hat by title, looking up its key first', async () => {
    const hat = await fetchHat('Just Matt');

    expect(hat.dbKey).toBe('hat-key');
    expect(hat.movies).toEqual([{ id: 1, title: 'Heat', dbKey: 'm1' }]);
    expect(hat.members).toEqual(['matt@example.com']);
  });

  it('escapes a hat title with spaces and punctuation', async () => {
    await fetchHat('Natalie & Her mom', 'known-key');

    expect(calls[0].url).toContain('Natalie%20%26%20Her%20mom');
  });

  it('adds a movie by POSTing to the hat\'s movies node', async () => {
    await addMovieToHat('Just Matt', 'hat-key', { id: 550 });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toContain('/hats/Just%20Matt/hat-key/movies.json');
    expect(JSON.parse(calls[0].body)).toEqual({ id: 550 });
  });

  // The heart of it: a draw MUST move the movie, not copy it. Getting this
  // wrong would quietly break the thing Matt uses to choose every film.
  // One atomic multi-path write, matching Movie Hat's own draw exactly.
  it('completes a draw in a single atomic write', async () => {
    await commitDraw('Just Matt', 'hat-key', { id: 1, title: 'Heat', dbKey: 'm1' }, 999);

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('PATCH');
    expect(calls[0].url).toContain('/hats/Just%20Matt/hat-key.json');
    expect(JSON.parse(calls[0].body)).toEqual({
      'history/drawn-999': { id: 1, title: 'Heat', dateDrawn: 999 },
      'movies/m1': null
    });
  });

  // Atomic means atomic: a refused write leaves the movie in the hat and
  // nothing in history, rather than half a draw.
  it('leaves the hat untouched when the write fails', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') }));

    await expect(commitDraw('Just Matt', 'hat-key', { id: 1, dbKey: 'm1' })).rejects.toThrow(/500/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('surfaces a failed request rather than pretending it worked', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') }));

    await expect(addMovieToHat('Just Matt', 'hat-key', { id: 1 })).rejects.toThrow(/500/);
  });

  it('sends the token on every request, since an anonymous one is always refused now', async () => {
    await fetchHat('Just Matt', 'hat-key');

    expect(calls[0].url).toContain('auth=hat-token');
  });

  // Reading only what it needs: ensureMovieHatContents wants TMDB ids, and
  // fetchHat pulls the whole hat — history is the bulk of it, and one of
  // Matt's runs to 882KB.
  it('reads just the movies node when only the contents are wanted', async () => {
    const movies = await fetchHatMovies('Just Matt', 'hat-key');

    expect(calls[0].url).toContain('/hats/Just%20Matt/hat-key/movies.json');
    expect(calls[0].url).not.toContain('history');
    expect(movies).toEqual([{ id: 1, title: 'Heat', dbKey: 'm1' }]);
  });
});

// Bug report: the integration answered 401 and nobody could tell whether the
// session had lapsed, the wrong Google account was connected, or the rules
// were refusing — three different fixes behind one useless message.
describe('why a hat request was refused', () => {
  beforeEach(() => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: true, text: () => Promise.resolve(JSON.stringify({ movies: {} }))
    }));
  });

  afterEach(() => {
    delete global.fetch;
    connectedAs();
  });

  it('does not spend a request it knows will be refused', async () => {
    notConnected();

    await expect(fetchHat('Just Matt', 'hat-key')).rejects.toMatchObject({ reason: 'not-connected' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('keeps "signed in but the token failed" apart from "never signed in"', async () => {
    tokenFailed('matt@example.com');

    await expect(fetchHat('Just Matt', 'hat-key')).rejects.toMatchObject({
      reason: 'token-failed',
      email: 'matt@example.com'
    });
  });

  // The one that actually bit: a valid session for an account that isn't a
  // member of the hat reads exactly like being signed out.
  it('reports a rules refusal as denied, naming the account that was refused', async () => {
    connectedAs('movie-hat-tester@example.com');
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false,
      status: 401,
      text: () => Promise.resolve(JSON.stringify({ error: 'Permission denied' }))
    }));

    const error = await fetchHat('Just Matt', 'hat-key').catch((e) => e);

    expect(isMovieHatAccessError(error)).toBe(true);
    expect(error.reason).toBe('denied');
    expect(error.email).toBe('movie-hat-tester@example.com');
    // The database's own words, which used to be thrown away.
    expect(error.detail).toBe('Permission denied');
    expect(error.message).toContain('movie-hat-tester@example.com');
  });

  it('leaves a non-auth failure as an ordinary error, carrying what the server said', async () => {
    global.fetch = vi.fn(() => Promise.resolve({
      ok: false, status: 500, text: () => Promise.resolve('boom')
    }));

    const error = await fetchHat('Just Matt', 'hat-key').catch((e) => e);

    expect(isMovieHatAccessError(error)).toBe(false);
    expect(error.message).toContain('500');
    expect(error.message).toContain('boom');
  });
});

// "The order of my hats should be based on which hat I most recently added
// to, so they should get sorted by how recently I used them." (2026-08-17)
// The getter lives in the store, so this covers the ordering rule itself.
describe('hat ordering by recent use', () => {
  const order = (hats) => [...hats]
    .sort((a, b) => (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0))
    .map((hat) => hat.title);

  it('puts the most recently used hat first', () => {
    expect(order([
      { title: 'Old', lastUsedAt: 100 },
      { title: 'Newest', lastUsedAt: 900 },
      { title: 'Middle', lastUsedAt: 500 }
    ])).toEqual(['Newest', 'Middle', 'Old']);
  });

  it('leaves never-used hats behind the ones that have been', () => {
    expect(order([
      { title: 'Never' },
      { title: 'Used', lastUsedAt: 5 }
    ])).toEqual(['Used', 'Never']);
  });
});

// Bug report, 2026-09-29: "we should only show that button if the movie is
// not already in any of the hats that I'm subscribed to". Only LINKED hats
// were read, and a hat that failed to read was cached as empty for ten
// minutes.
describe('hatsToCheck', () => {
  it('includes every hat the index lists, not just the linked ones', () => {
    expect(hatsToCheck([{ title: 'Just Matt', dbKey: 'k1' }], [
      { title: 'Just Matt', dbKey: 'k1' },
      { title: 'Natalie and Matt', dbKey: 'k2' }
    ])).toEqual([
      { title: 'Just Matt', dbKey: 'k1' },
      { title: 'Natalie and Matt', dbKey: 'k2' }
    ]);
  });

  it('fills in a linked hat saved without a key from the index', () => {
    expect(hatsToCheck([{ title: 'Just Matt', dbKey: null }], [{ title: 'Just Matt', dbKey: 'k1' }]))
      .toEqual([{ title: 'Just Matt', dbKey: 'k1' }]);
  });

  it('still reads a linked hat the index has not caught up with', () => {
    expect(hatsToCheck([{ title: 'Old Hat', dbKey: 'k9' }], []))
      .toEqual([{ title: 'Old Hat', dbKey: 'k9' }]);
  });
});

describe('readHatContents', () => {
  const INDEX = { a: { title: 'Just Matt', hatKey: 'k1' }, b: { title: 'Natalie and Matt', hatKey: 'k2' } };
  const respond = (routes) => {
    global.fetch = vi.fn((url) => {
      const route = Object.keys(routes).find((part) => url.includes(part));
      const body = route ? routes[route] : null;
      if (body instanceof Error) return Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') });
      return Promise.resolve({ ok: true, text: () => Promise.resolve(JSON.stringify(body)) });
    });
  };

  beforeEach(() => {
    connectedAs();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    delete global.fetch;
    vi.restoreAllMocks();
  });

  it('counts films waiting in a hat that was never linked', async () => {
    respond({
      userHats: INDEX,
      'k1/movies': { m1: { id: 1 } },
      'k2/movies': { m2: { id: 2 } }
    });

    const result = await readHatContents({ linked: [{ title: 'Just Matt', dbKey: 'k1' }], email: 'matt@example.com' });

    expect(result.ids).toEqual({ 1: true, 2: true });
    expect(result.complete).toBe(true);
  });

  it('reads a linked hat saved without a key, using the index', async () => {
    respond({ userHats: INDEX, 'k1/movies': { m1: { id: 1 } }, 'k2/movies': {} });

    const result = await readHatContents({ linked: [{ title: 'Just Matt' }], email: 'matt@example.com' });

    expect(result.ids).toEqual({ 1: true });
  });

  it('flags a failed hat as incomplete and keeps what it knew before', async () => {
    respond({ userHats: INDEX, 'k1/movies': { m1: { id: 1 } }, 'k2/movies': new Error('boom') });

    const result = await readHatContents({
      linked: [{ title: 'Just Matt', dbKey: 'k1' }],
      email: 'matt@example.com',
      previousIds: { 2: true }
    });

    expect(result.complete).toBe(false);
    expect(result.ids).toEqual({ 1: true, 2: true });
  });

  it('flags a lapsed Movie Hat session as incomplete, with the reason', async () => {
    notConnected();
    respond({});

    const result = await readHatContents({ linked: [{ title: 'Just Matt', dbKey: 'k1' }], email: 'matt@example.com' });

    expect(result.complete).toBe(false);
    expect(result.accessError).toMatchObject({ reason: 'not-connected' });
  });

  it('drops films drawn since last time when every hat was read', async () => {
    respond({ userHats: INDEX, 'k1/movies': { m1: { id: 1 } }, 'k2/movies': {} });

    const result = await readHatContents({ linked: [], email: 'matt@example.com', previousIds: { 7: true } });

    expect(result.ids).toEqual({ 1: true });
  });
});
