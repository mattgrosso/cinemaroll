// The Letterboxd import end to end (2026-11-14): the real export fixture in,
// TMDB and the database faked at their edges, the library and the "Find the
// match" list out — and a run that stops part way picks up without doubling.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DecompressionStream as NodeDecompressionStream } from 'node:stream/web';

if (typeof globalThis.DecompressionStream === 'undefined') globalThis.DecompressionStream = NodeDecompressionStream;

const { fakeStore, snapshots, reviewWrites, tmdb } = vi.hoisted(() => {
  const state = { movieLog: {}, isOnline: true };
  const fakeStore = {
    state,
    getters: {
      databaseTopKey: 'tester',
      get allMediaAsArray () { return Object.entries(state.movieLog).map(([dbKey, entry]) => ({ ...entry, dbKey })); }
    },
    writes: [],
    failNextWrite: false,
    commit: (name, payload) => {
      if (name !== 'setMovieLogEntries') return;
      const next = { ...state.movieLog };
      payload.forEach(({ key, value }) => { next[key] = value; });
      state.movieLog = next;
    },
    dispatch: async (name, payload) => {
      if (name !== 'updateDatabaseEntriesNow') return;
      if (fakeStore.failNextWrite) { fakeStore.failNextWrite = false; throw new Error('write timed out'); }
      fakeStore.writes.push(payload);
    }
  };
  return { fakeStore, snapshots: new Map(), reviewWrites: [], tmdb: { calls: [] } };
});

vi.mock('../store/index', () => ({ default: fakeStore }));
vi.mock('../utils/offlineStore.js', () => ({
  saveSnapshot: async (topKey, kind, data) => { snapshots.set(`${topKey}:${kind}`, data && JSON.parse(JSON.stringify(data))); },
  loadSnapshot: async (topKey, kind) => snapshots.get(`${topKey}:${kind}`) || null
}));
vi.mock('../utils/letterboxdData.js', () => ({
  importLetterboxdReviews: async (topKey, updates) => { reviewWrites.push(updates); return Object.keys(updates).length; }
}));

const SEARCH = {
  Heat: [{ id: 949, title: 'Heat', release_date: '1995-12-15', popularity: 40 }],
  'Crouching Tiger, Hidden Dragon': [{ id: 146, title: 'Crouching Tiger, Hidden Dragon', release_date: '2000-07-06' }],
  'Paddington 2': [{ id: 346648, title: 'Paddington 2', release_date: '2017-11-09' }],
  'Some Obscure Short': [{ id: 777, title: 'An Obscure Short', release_date: '2019-02-02' }]
};

vi.mock('axios', () => ({
  default: {
    get: vi.fn(async (url, { params } = {}) => {
      tmdb.calls.push({ url, params });
      if (url.endsWith('/search/movie')) return { data: { results: SEARCH[params.query] || [] } };
      const id = Number(url.split('/movie/')[1]);
      const known = Object.values(SEARCH).flat().find((result) => result.id === id);
      return {
        data: {
          id, title: known?.title || `Film ${id}`, release_date: known?.release_date || '2000-01-15', runtime: 120, genres: [{ id: 18, name: 'Drama' }],
          credits: { cast: [{ name: 'Al Pacino', character: 'Hanna' }], crew: [{ job: 'Director', name: 'Someone' }, { job: 'Stunts', name: 'Dropped' }] },
          keywords: { keywords: [{ id: 1, name: 'heist' }] }
        }
      };
    })
  }
}));

const exportFile = () => {
  const bytes = readFileSync(join(__dirname, 'fixtures/letterboxd-export.zip'));
  return { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
};

const freshRunner = async () => {
  vi.resetModules();
  return import('../utils/letterboxdImportRun.js');
};

const libraryByTitle = () => Object.fromEntries(Object.values(fakeStore.state.movieLog).map((entry) => [entry.movie.title, entry]));

beforeEach(() => {
  fakeStore.state.movieLog = {};
  fakeStore.writes = [];
  fakeStore.failNextWrite = false;
  snapshots.clear();
  reviewWrites.length = 0;
  tmdb.calls.length = 0;
  localStorage.clear();
});

describe('a Letterboxd import into an empty library', () => {
  it('brings in the sure films with their viewings and scores, and holds back the doubtful one', async () => {
    const runner = await freshRunner();
    await runner.startLetterboxdImport(exportFile());
    const state = runner.importState;

    const library = libraryByTitle();
    expect(Object.keys(library).sort()).toEqual(['Crouching Tiger, Hidden Dragon', 'Heat', 'Paddington 2']);
    expect(library.Heat.ratings.map((rating) => rating.letterboxdStars)).toEqual([4.5, 5]);
    expect(library.Heat.ratings[0].overall).toBe(9);
    expect(library.Heat.movie.crew.map((person) => person.job)).toEqual(['Director']); // trimmed like any rating
    expect(library.Heat.movie.keywords).toEqual([{ id: 1, name: 'heist' }]);

    // One details call per film, credits and keywords included.
    const details = tmdb.calls.filter((call) => /\/movie\/\d+$/.test(call.url));
    expect(details).toHaveLength(3);
    expect(details.every((call) => call.params.append_to_response === 'credits,keywords')).toBe(true);

    // Written whole, through the stamped batch path.
    const paths = fakeStore.writes.flatMap((updates) => Object.keys(updates));
    expect(paths.every((path) => /^movieLog\/[^/]+$/.test(path))).toBe(true);

    expect(state.imported).toBe(3);
    expect(state.viewingsAdded).toBe(4);
    expect(state.doubtful.map((film) => film.title)).toEqual(['Some Obscure Short']);
    expect(state.doubtful[0].suggestion.id).toBe(777);
    expect(state.phase).toBe('done');

    // Then the reviews, now that Heat is in the library.
    expect(state.reviewsImported).toBe(1);
    expect(Object.keys(reviewWrites[0])[0]).toMatch(/^949\//);
  });

  it('adds a doubtful film once its match is picked, and forgets one skipped', async () => {
    const runner = await freshRunner();
    await runner.startLetterboxdImport(exportFile());
    await runner.matchDoubtfulFilm(runner.importState.doubtful[0].key, 777);
    expect(libraryByTitle()['An Obscure Short'].ratings[0].letterboxdUnrated).toBe(true);
    expect(runner.importState.doubtful).toEqual([]);
  });

  it('a run interrupted part way resumes without making a second copy of anything', async () => {
    let runner = await freshRunner();
    fakeStore.failNextWrite = true; // the one batch fails: nothing marked done
    await runner.startLetterboxdImport(exportFile());
    expect(runner.importState.pending).toBe(4); // the doubtful one rode in that batch too
    expect(runner.importState.message).toMatch(/pick up where it stopped/);
    // Nothing the server didn't take shows up locally: otherwise the resumed
    // run would think these films were already in and never send them.
    expect(Object.keys(fakeStore.state.movieLog)).toHaveLength(0);

    // The app is closed and reopened: a fresh runner reads the saved import.
    runner = await freshRunner();
    await runner.loadSavedImport();
    expect(runner.importState.phase).toBe('paused');
    await runner.resumeLetterboxdImport();

    const titles = Object.values(fakeStore.state.movieLog).map((entry) => entry.movie.title).sort();
    expect(titles).toEqual(['Crouching Tiger, Hidden Dragon', 'Heat', 'Paddington 2']);
    expect(libraryByTitle().Heat.ratings).toHaveLength(2);
    // And the server has every one of them.
    const sent = Object.assign({}, ...fakeStore.writes);
    expect(Object.values(sent).map((entry) => entry.movie.title).sort()).toEqual(['Crouching Tiger, Hidden Dragon', 'Heat', 'Paddington 2']);
    expect(runner.importState.pending).toBe(0);
    expect(runner.importState.doubtful.map((film) => film.title)).toEqual(['Some Obscure Short']);
  });

  it('adds only missing viewings to a film the library already has', async () => {
    fakeStore.state.movieLog = {
      mine: { movie: { id: 949, title: 'Heat', release_date: '1995-12-15' }, ratings: [{ date: new Date(2024, 0, 2, 21).getTime(), overall: 10 }] }
    };
    const runner = await freshRunner();
    await runner.startLetterboxdImport(exportFile());
    const heat = fakeStore.state.movieLog.mine;
    expect(heat.ratings).toHaveLength(2);
    expect(heat.ratings[0].overall).toBe(10); // mine, untouched
    expect(heat.ratings[1].letterboxdStars).toBe(5);
    expect(fakeStore.writes.some((updates) => 'movieLog/mine/ratings' in updates)).toBe(true);
    // Heat was found in the library by title: TMDB was never asked about it.
    expect(tmdb.calls.some((call) => call.params?.query === 'Heat')).toBe(false);
  });

  it('says so when the file is not an export', async () => {
    const runner = await freshRunner();
    const file = { arrayBuffer: async () => new TextEncoder().encode('Username\nsomeone\n').buffer };
    await runner.startLetterboxdImport(file);
    expect(runner.importState.error).toBe(true);
    expect(runner.importState.message).toMatch(/Letterboxd export/);
    expect(fakeStore.writes).toEqual([]);
  });
});
