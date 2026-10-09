import { describe, it, expect, vi } from 'vitest';
import {
  buildLocationsQuery,
  parsePoint,
  parseLocationsResponse,
  collectMoviesNeedingLocations,
  fetchLocationsForIds,
  backfillMovieLocations,
  MAX_LOCATIONS_PER_MOVIE,
  LOCATION_TYPES
} from '../assets/javascript/movieLocations.js';

const row = ({ tmdb, type = LOCATION_TYPES.FILMING, place = 'Q65', label, coord }) => ({
  tmdb: { value: tmdb },
  type: { value: type },
  place: { value: `http://www.wikidata.org/entity/${place}` },
  placeLabel: { value: label },
  coord: { value: coord }
});

const response = (rows) => ({ results: { bindings: rows } });

describe('parsePoint', () => {
  it('reads WKT longitude-first, which is the opposite of the usual order', () => {
    // Los Angeles: lon -118, lat 34. Getting this backwards puts it in the
    // Indian Ocean, so it is worth pinning explicitly.
    expect(parsePoint('Point(-118.24368 34.05223)')).toEqual({ lat: 34.05223, lon: -118.24368 });
  });

  it('tolerates extra whitespace', () => {
    expect(parsePoint('Point( 2.35  48.85 )')).toEqual({ lat: 48.85, lon: 2.35 });
  });

  it('rejects malformed, missing, or out-of-range values', () => {
    expect(parsePoint('')).toBeNull();
    expect(parsePoint(undefined)).toBeNull();
    expect(parsePoint('POLYGON((1 2))')).toBeNull();
    expect(parsePoint('Point(200 10)')).toBeNull();
    expect(parsePoint('Point(10 100)')).toBeNull();
  });
});

describe('buildLocationsQuery', () => {
  it('asks for both location types in one query', () => {
    const query = buildLocationsQuery(['27205']);
    expect(query).toContain('wdt:P4947');
    expect(query).toContain('wdt:P915');
    expect(query).toContain('wdt:P840');
    expect(query).toContain('wdt:P625');
  });

  it('quotes every id into the VALUES block', () => {
    expect(buildLocationsQuery(['1', '2', '3'])).toContain('VALUES ?tmdb { "1" "2" "3" }');
  });
});

describe('parseLocationsResponse', () => {
  it('groups locations by TMDB id and keeps the type', () => {
    const parsed = parseLocationsResponse(response([
      row({ tmdb: '27205', label: 'Tokyo', place: 'Q1490', coord: 'Point(139.69 35.68)' }),
      row({ tmdb: '27205', label: 'Paris', place: 'Q90', coord: 'Point(2.35 48.85)', type: LOCATION_TYPES.NARRATIVE }),
      row({ tmdb: '550', label: 'Los Angeles', place: 'Q65', coord: 'Point(-118.24 34.05)' })
    ]));

    expect(Object.keys(parsed).sort()).toEqual(['27205', '550']);
    expect(parsed['27205']).toHaveLength(2);
    expect(parsed['27205'][0]).toEqual({ name: 'Tokyo', lat: 35.68, lon: 139.69, type: 'filming', id: 'Q1490' });
    expect(parsed['27205'][1].type).toBe('narrative');
  });

  it('keeps a place that is BOTH a filming and a narrative location', () => {
    // Two genuinely different facts about the same film, not a duplicate.
    const parsed = parseLocationsResponse(response([
      row({ tmdb: '1', label: 'Paris', place: 'Q90', coord: 'Point(2.35 48.85)', type: LOCATION_TYPES.FILMING }),
      row({ tmdb: '1', label: 'Paris', place: 'Q90', coord: 'Point(2.35 48.85)', type: LOCATION_TYPES.NARRATIVE })
    ]));

    expect(parsed['1']).toHaveLength(2);
  });

  it('collapses exact repeats', () => {
    const parsed = parseLocationsResponse(response([
      row({ tmdb: '1', label: 'Paris', place: 'Q90', coord: 'Point(2.35 48.85)' }),
      row({ tmdb: '1', label: 'Paris', place: 'Q90', coord: 'Point(2.35 48.85)' })
    ]));

    expect(parsed['1']).toHaveLength(1);
  });

  it('drops rows with no usable coordinate', () => {
    const parsed = parseLocationsResponse(response([
      row({ tmdb: '1', label: 'Middle-earth', place: 'Q100', coord: 'not-a-point' })
    ]));

    expect(parsed['1']).toBeUndefined();
  });

  it('drops unlabelled items whose "name" is just their Q-id', () => {
    const parsed = parseLocationsResponse(response([
      row({ tmdb: '1', label: 'Q12345', place: 'Q12345', coord: 'Point(1 2)' })
    ]));

    expect(parsed['1']).toBeUndefined();
  });

  it('caps how many locations one movie can contribute', () => {
    const rows = Array.from({ length: MAX_LOCATIONS_PER_MOVIE + 15 }, (_, i) =>
      row({ tmdb: '1', label: `Place ${i}`, place: `Q${i}`, coord: `Point(${i % 90} ${i % 45})` })
    );

    expect(parseLocationsResponse(response(rows))['1']).toHaveLength(MAX_LOCATIONS_PER_MOVIE);
  });

  it('tolerates an empty or malformed response', () => {
    expect(parseLocationsResponse({})).toEqual({});
    expect(parseLocationsResponse(null)).toEqual({});
  });
});

describe('collectMoviesNeedingLocations', () => {
  const log = {
    never: { movie: { id: 1 } },
    hasSome: { movie: { id: 2, locations: [{ name: 'Paris', lat: 1, lon: 2, type: 'filming' }] } },
    checkedEmpty: { movie: { id: 3, locations: [] } },
    placeholder: { movie: { id: 'offline-abc' } },
    noMovie: {},
    zeroId: { movie: { id: 0 } }
  };

  it('selects only movies never checked', () => {
    expect(collectMoviesNeedingLocations(log).map((c) => c.dbKey)).toEqual(['never', 'zeroId']);
  });

  it('treats an empty array as "checked, found nothing" and does not re-query it', () => {
    // The distinction backfillBoxOffice can't make, because TMDB uses 0 for
    // both "no data" and a real value.
    expect(collectMoviesNeedingLocations(log).map((c) => c.dbKey)).not.toContain('checkedEmpty');
  });

  it('skips offline placeholders, which have no Wikidata counterpart', () => {
    expect(collectMoviesNeedingLocations(log).map((c) => c.dbKey)).not.toContain('placeholder');
  });

  it('does not treat a legitimate id of 0 as missing', () => {
    expect(collectMoviesNeedingLocations(log).map((c) => c.dbKey)).toContain('zeroId');
  });

  it('tolerates an empty log', () => {
    expect(collectMoviesNeedingLocations(null)).toEqual([]);
  });
});

describe('fetchLocationsForIds', () => {
  it('splits large id sets across multiple queries', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(response([])) }));
    await fetchLocationsForIds(Array.from({ length: 450 }, (_, i) => String(i)), { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(3); // 200 + 200 + 50
  });

  it('throws on a non-ok response so the caller can record the failure', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: false, status: 500 }));
    await expect(fetchLocationsForIds(['1'], { fetchImpl })).rejects.toThrow(/500/);
  });

  it('gives every request a deadline, so a dead connection cannot hang forever', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(response([])) }));
    await fetchLocationsForIds(['1'], { fetchImpl });
    expect(fetchImpl.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe('backfillMovieLocations', () => {
  const makeLog = (count) => Object.fromEntries(
    Array.from({ length: count }, (_, i) => [`key-${i}`, { movie: { id: i + 1 } }])
  );

  const okFetch = (byId) => vi.fn(() => Promise.resolve({
    ok: true,
    json: () => Promise.resolve(response(
      Object.entries(byId).flatMap(([tmdb, places]) =>
        places.map((p) => row({ tmdb, label: p, place: `Q${p}`, coord: 'Point(2.35 48.85)' }))
      )
    ))
  }));

  it('writes locations for movies that have them', async () => {
    const writeBatchFn = vi.fn();
    const result = await backfillMovieLocations(makeLog(2), writeBatchFn, {
      fetchImpl: okFetch({ 1: ['Paris'] })
    });

    expect(writeBatchFn).toHaveBeenCalledTimes(1);
    const batch = writeBatchFn.mock.calls[0][0];
    expect(batch).toHaveLength(2);
    expect(batch.find((b) => b.dbKey === 'key-0').locations).toHaveLength(1);
    expect(result).toMatchObject({ total: 2, completed: 2, failed: 0, withLocations: 1 });
  });

  it('writes an explicit empty array for movies with no locations, so they are not re-queried', async () => {
    const writeBatchFn = vi.fn();
    await backfillMovieLocations(makeLog(1), writeBatchFn, { fetchImpl: okFetch({}) });

    expect(writeBatchFn.mock.calls[0][0][0].locations).toEqual([]);
  });

  it('reports progress as it goes', async () => {
    const onProgress = vi.fn();
    await backfillMovieLocations(makeLog(3), vi.fn(), { fetchImpl: okFetch({}), onProgress });

    expect(onProgress).toHaveBeenCalled();
    expect(onProgress.mock.calls.at(-1)[0]).toMatchObject({ completed: 3, total: 3 });
  });

  it('counts a failed query as failed without aborting the run', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValue({ ok: true, json: () => Promise.resolve(response([])) });

    // 250 movies => two query batches; the first fails, the second must still run.
    const result = await backfillMovieLocations(makeLog(250), vi.fn(), { fetchImpl });

    expect(result.failed).toBe(200);
    expect(result.completed).toBe(250);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('counts a failed write without aborting', async () => {
    const writeBatchFn = vi.fn().mockRejectedValue(new Error('offline'));
    const result = await backfillMovieLocations(makeLog(2), writeBatchFn, { fetchImpl: okFetch({}) });

    expect(result.failed).toBe(2);
    expect(result.withLocations).toBe(0);
  });

  it('stops early when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn();

    const result = await backfillMovieLocations(makeLog(10), vi.fn(), { fetchImpl, signal: controller.signal });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.completed).toBe(0);
  });

  it('does nothing when everything has already been checked', async () => {
    const log = { a: { movie: { id: 1, locations: [] } } };
    const fetchImpl = vi.fn();

    const result = await backfillMovieLocations(log, vi.fn(), { fetchImpl });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.total).toBe(0);
  });
});
