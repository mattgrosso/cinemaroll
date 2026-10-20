import { describe, it, expect } from 'vitest';
import { maxUpdatedAt, reconstructFromDelta, diffLibraries, describeStaleEntry, launchPlan, FULL_RESYNC_INTERVAL_MS, isWriteRaceOnly, summarizeShadowReport } from '@/assets/javascript/deltaSync.js';

function entry (title, updatedAt) {
  return { movie: { id: title, title }, ratings: [{ calculatedTotal: 7 }], updatedAt };
}

describe('maxUpdatedAt', () => {
  it('returns the largest finite stamp, ignoring unstamped entries', () => {
    const log = { a: entry('A', 100), b: entry('B', 300), c: { movie: {} }, d: entry('D', 200) };
    expect(maxUpdatedAt(log)).toBe(300);
  });

  it('returns null when nothing is stamped (nothing to delta from)', () => {
    expect(maxUpdatedAt({ a: { movie: {} } })).toBeNull();
    expect(maxUpdatedAt({})).toBeNull();
    expect(maxUpdatedAt(null)).toBeNull();
  });
});

describe('reconstructFromDelta', () => {
  it('delta entries replace their snapshot counterparts wholesale and add new ones', () => {
    const snapshot = { a: entry('A old', 100), b: entry('B', 100) };
    const delta = { a: entry('A new', 500), c: entry('C', 400) };

    const result = reconstructFromDelta(snapshot, delta);

    expect(result.a.movie.title).toBe('A new');
    expect(result.b.movie.title).toBe('B');
    expect(result.c.movie.title).toBe('C');
  });

  it('does not mutate the snapshot it was given', () => {
    const snapshot = { a: entry('A', 100) };
    reconstructFromDelta(snapshot, { a: entry('A2', 200) }, { a: 900 });
    expect(snapshot.a.movie.title).toBe('A');
  });

  describe('tombstones are advisory, compared by time', () => {
    it('a tombstone newer than the entry deletes it', () => {
      const result = reconstructFromDelta({ a: entry('A', 100) }, {}, { a: 200 });
      expect(result.a).toBeUndefined();
    });

    it('a re-rated movie survives its own older tombstone (re-rating wins on the newer stamp)', () => {
      const snapshot = { a: entry('A deleted then re-rated', 100) };
      const delta = { a: entry('A re-rated', 500) };
      const result = reconstructFromDelta(snapshot, delta, { a: 300 });
      expect(result.a.movie.title).toBe('A re-rated');
    });

    it('an unstamped entry loses to any tombstone (cannot prove it is newer)', () => {
      const result = reconstructFromDelta({ a: { movie: { title: 'A' } } }, {}, { a: 200 });
      expect(result.a).toBeUndefined();
    });

    it('a tombstone for an absent entry is a no-op', () => {
      expect(reconstructFromDelta({}, {}, { ghost: 200 })).toEqual({});
    });
  });
});

describe('diffLibraries', () => {
  it('reports identical for equal libraries regardless of property order', () => {
    const full = { a: { movie: { id: 1, title: 'A' }, updatedAt: 5 } };
    const reconstructed = { a: { updatedAt: 5, movie: { title: 'A', id: 1 } } };

    const report = diffLibraries(full, reconstructed);

    expect(report.identical).toBe(true);
    expect(report.compared).toBe(1);
  });

  it('classifies missing, stale, and extra keys', () => {
    const full = { a: entry('A', 1), b: entry('B', 2), c: entry('C', 3) };
    const reconstructed = { a: entry('A', 1), b: entry('B changed', 2), d: entry('D', 4) };

    const report = diffLibraries(full, reconstructed);

    expect(report.identical).toBe(false);
    expect(report.missing).toEqual(['c']);
    expect(report.stale).toEqual(['b']);
    expect(report.extra).toEqual(['d']);
  });

  it('caps example lists so a pathological divergence cannot build a giant report', () => {
    const full = {};
    const reconstructed = {};
    for (let i = 0; i < 50; i++) full[`m${i}`] = entry(`M${i}`, i);

    const report = diffLibraries(full, reconstructed);

    expect(report.missing).toHaveLength(20);
    expect(report.compared).toBe(50);
  });

  describe('describeStaleEntry', () => {
    const fresh = { updatedAt: 100, movie: { id: 1, title: 'Dune', revenue: 700 }, ratings: [{ love: 9 }] };

    it('names the differing fields and reports both stamps', () => {
      const recon = { updatedAt: 90, movie: { id: 1, title: 'Dune', revenue: null }, ratings: [{ love: 9 }] };
      const detail = describeStaleEntry(fresh, recon, {}, 'k-dune');

      expect(detail.freshStamp).toBe(100);
      expect(detail.reconstructedStamp).toBe(90);
      expect(detail.inDelta).toBe(false);
      expect(detail.diffPaths).toContain('updatedAt');
      expect(detail.diffPaths).toContain('movie.revenue');
    });

    it('reports when the delta query did return the key (mismatch is content, not coverage)', () => {
      const recon = { ...fresh, movie: { ...fresh.movie, revenue: 1 } };
      const detail = describeStaleEntry(fresh, recon, { 'k-dune': recon }, 'k-dune');

      expect(detail.inDelta).toBe(true);
      expect(detail.diffPaths).toEqual(['movie.revenue']);
    });

    it('caps the path list so a pathological entry cannot bloat the report', () => {
      const recon = { ...fresh, movie: Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['f' + i, i])) };
      const detail = describeStaleEntry(fresh, recon, {}, 'k-dune');

      expect(detail.diffPaths.length).toBeLessThanOrEqual(5);
    });
  });
})

describe('diffLibraries ignores runtime-injected fields', () => {
  // dbKey/_search are added when an entry is read and are never stored, so
  // the full download has them and delta-reconstructed entries do not.
  // Comparing them made shadow mode report a divergence on every launch
  // with recent activity — a false alarm that would have poisoned the
  // phase-2 go/no-go.
  const stored = { movie: { id: 1, title: 'Alpha' }, ratings: [{ calculatedTotal: 8 }], updatedAt: 1000 }

  it('entries differing only by dbKey/_search count as identical', () => {
    const fresh = { a: { ...stored, dbKey: 'a', _search: { title: 'alpha' } } }
    const reconstructed = { a: { ...stored } }

    const report = diffLibraries(fresh, reconstructed)
    expect(report.identical).toBe(true)
    expect(report.stale).toEqual([])
  })

  it('a real difference is still reported', () => {
    const fresh = { a: { ...stored, dbKey: 'a' } }
    const reconstructed = { a: { ...stored, ratings: [{ calculatedTotal: 4 }] } }

    const report = diffLibraries(fresh, reconstructed)
    expect(report.identical).toBe(false)
    expect(report.stale).toEqual(['a'])
  })

  it('describeStaleEntry does not name dbKey as a differing path', () => {
    const detail = describeStaleEntry(
      { ...stored, dbKey: 'a', ratings: [{ calculatedTotal: 9 }] },
      { ...stored },
      { a: {} },
      'a'
    )
    expect(detail.diffPaths).not.toContain('dbKey')
    expect(detail.diffPaths.length).toBeGreaterThan(0) // the real rating diff survives
  })
})

describe('launchPlan (phase 2: which listener a launch attaches)', () => {
  const NOW = 1_800_000_000_000;
  const DAY = 24 * 60 * 60 * 1000;
  const meta = (overrides) => ({ lastSync: 500, lastFullSyncAt: NOW - DAY, ...overrides });
  const snapshot = { a: { movie: { id: 1 }, updatedAt: 500 } };

  it('goes delta only when baseline, snapshot, and a recent full sync all exist', () => {
    expect(launchPlan(meta(), snapshot, NOW)).toEqual({ mode: 'delta' });
  });

  it('full on a missing or lastSync-less baseline', () => {
    expect(launchPlan(null, snapshot, NOW)).toEqual({ mode: 'full', reason: 'no-meta' });
    expect(launchPlan({ savedAt: NOW }, snapshot, NOW)).toEqual({ mode: 'full', reason: 'no-meta' });
  });

  it('full when the snapshot is missing or empty — a lost snapshot with a surviving lastSync must never produce a near-empty library', () => {
    expect(launchPlan(meta(), null, NOW)).toEqual({ mode: 'full', reason: 'no-snapshot' });
    expect(launchPlan(meta(), {}, NOW)).toEqual({ mode: 'full', reason: 'no-snapshot' });
  });

  it('full when the periodic resync is due, or the meta predates phase 2 (no lastFullSyncAt)', () => {
    expect(launchPlan(meta({ lastFullSyncAt: NOW - FULL_RESYNC_INTERVAL_MS - 1 }), snapshot, NOW))
      .toEqual({ mode: 'full', reason: 'resync-due' });
    expect(launchPlan({ lastSync: 500, savedAt: NOW }, snapshot, NOW))
      .toEqual({ mode: 'full', reason: 'resync-due' });
  });

  it('a full sync exactly at the interval edge still counts as fresh', () => {
    expect(launchPlan(meta({ lastFullSyncAt: NOW - FULL_RESYNC_INTERVAL_MS }), snapshot, NOW))
      .toEqual({ mode: 'delta' });
  });
});

// Sentry, 2026-10-20: a resync-due launch logged "diverged from full
// download: [object Object]" — the report was in the context argument, which
// Sentry flattens, and a save landing between the two reads was an error.
describe('shadow reports that explain themselves', () => {
  // The full download is read first; the delta query a moment later picks up
  // a save that reached the server in between.
  const raceReport = () => {
    const fresh = { a: { movie: { id: 1 }, ratings: [{ love: 8 }], updatedAt: 100 } };
    const delta = { a: { movie: { id: 1 }, ratings: [{ love: 9 }], updatedAt: 150 } };
    const reconstructed = reconstructFromDelta(fresh, delta, {});
    const report = { ...diffLibraries(fresh, reconstructed), deltaEntryCount: 1, lastSyncUsed: 90 };
    report.staleDetail = report.stale.map((key) => describeStaleEntry(fresh[key], reconstructed[key], delta, key));
    return report;
  };

  it('calls a save between the two reads a race, not a divergence', () => {
    expect(isWriteRaceOnly(raceReport())).toBe(true);
  });

  it('keeps anything else a real divergence', () => {
    expect(isWriteRaceOnly({ identical: true })).toBe(false);
    expect(isWriteRaceOnly({ ...raceReport(), missing: ['b'] })).toBe(false);
    expect(isWriteRaceOnly({ ...raceReport(), extra: ['b'] })).toBe(false);

    const older = raceReport();
    older.staleDetail[0].reconstructedStamp = 100; // same stamp, different content: the Dune class
    expect(isWriteRaceOnly(older)).toBe(false);

    const notInDelta = raceReport();
    notInDelta.staleDetail[0].inDelta = false;
    expect(isWriteRaceOnly(notInDelta)).toBe(false);

    const capped = raceReport();
    capped.stale = Array.from({ length: 20 }, (_, i) => `k${i}`);
    capped.staleDetail = capped.stale.map((dbKey) => ({ ...capped.staleDetail[0], dbKey }));
    expect(isWriteRaceOnly(capped)).toBe(false);
  });

  it('puts counts, stamps, coverage and fields into one line of text', () => {
    const summary = summarizeShadowReport(raceReport());

    expect(summary).not.toContain('[object Object]');
    expect(summary).toContain('1 compared');
    expect(summary).toContain('stale 1');
    expect(summary).toContain('lastSync 90');
    expect(summary).toContain('a: full 100 vs delta 150, in delta');
    expect(summary).toContain('ratings');
  });
});
