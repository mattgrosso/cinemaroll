import { describe, it, expect, vi } from 'vitest';

// Sentry 2026-11-13 ("null is not an object (evaluating 'n.dbKey=e')"):
// deleting a film's ONLY viewing writes null at movieLog/<key>. The local
// commit kept the key with a null value, and the next allMediaAsArray read
// crashed assigning dbKey to it.

vi.mock('@/services/ErrorLogService', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), log: vi.fn(), setSignedInCheck: vi.fn() },
  setSignedInCheck: vi.fn(),
}));

const loadStore = async () => (await import('@/store/index.js')).default;

describe('deleting a film\'s last viewing', () => {
  it('takes the film out of the library instead of leaving a null entry', async () => {
    const store = await loadStore();
    store.commit('setMovieLog', {
      keep: { ratings: [{ date: '2026-01-01', rating: { overall: 8 } }], movie: { title: 'Keep' } },
      gone: { ratings: [{ date: '2026-02-01', rating: { overall: 7 } }], movie: { title: 'Gone' } },
    });
    store.commit('setDbLoaded', true);

    store.commit('applyDbPathLocally', { path: 'movieLog/gone', value: null });

    expect(Object.keys(store.state.movieLog)).toEqual(['keep']);
    expect(() => store.getters.allMediaAsArray).not.toThrow();
    expect(store.getters.allMediaAsArray.map((m) => m.dbKey)).toEqual(['keep']);
    expect(store.getters.allMoviesAsArray).toHaveLength(1);
  });

  it('library lists skip a null entry that arrives some other way', async () => {
    const store = await loadStore();
    store.commit('setMovieLog', { keep: { ratings: [], movie: { title: 'Keep' } }, gone: null });
    store.commit('setDbLoaded', true);

    expect(store.getters.allMediaAsArray.map((m) => m.dbKey)).toEqual(['keep']);
    expect(store.getters.allMoviesAsArray).toHaveLength(1);
  });
});
