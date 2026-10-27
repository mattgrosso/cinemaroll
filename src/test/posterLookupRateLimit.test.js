import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Sentry, 2026-10-27: the Showtimes board fired every poster lookup at once,
// TMDB answered one with 429, and that failure was stored on the device as
// "no poster, no year" for a month. A 429 now waits and retries, a failure
// is never stored, slow-down is a warning, and searches run four at a time.
const log = vi.hoisted(() => ({ error: vi.fn(), warn: vi.fn() }));
vi.mock('../services/ErrorLogService.js', () => ({ default: log }));

const answer = (status, results = [], headers = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  headers: { get: (name) => headers[name] ?? null },
  json: async () => ({ results })
});
const FOUND = [{ poster_path: '/p.jpg', release_date: '1978-10-25' }];

let lookupFilm;
let fetchMock;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  log.error.mockReset();
  log.warn.mockReset();
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  ({ lookupFilm } = await import('../utils/posterLookup.js'));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('poster lookup under TMDB rate limiting', () => {
  it('waits and retries once on a 429, and keeps the real answer', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValueOnce(answer(429, [], { 'Retry-After': '1' }))
      .mockResolvedValueOnce(answer(200, FOUND));
    const pending = lookupFilm('Halloween', 1978);
    await vi.advanceTimersByTimeAsync(1000);
    const hit = await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hit).toEqual({ poster: 'https://image.tmdb.org/t/p/w342/p.jpg', year: 1978 });
    expect(log.error).not.toHaveBeenCalled();
  });

  it('never stores a failed lookup, so the next visit asks again', async () => {
    vi.useFakeTimers();
    fetchMock.mockResolvedValue(answer(429));
    const pending = lookupFilm('Halloween', 1978);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await pending).toEqual({ poster: null, year: null });
    expect(JSON.parse(localStorage.getItem('showtimesPosters') || '{}')).toEqual({});
    // A 429 is TMDB asking us to slow down, not our bug.
    expect(log.warn).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();

    vi.useRealTimers();
    fetchMock.mockReset();
    fetchMock.mockResolvedValue(answer(200, FOUND));
    expect((await lookupFilm('Halloween', 1978)).poster).toContain('/p.jpg');
  });

  it('still reports a real refusal as an error', async () => {
    fetchMock.mockResolvedValue(answer(401));
    await lookupFilm('Halloween', 1978);
    expect(log.error).toHaveBeenCalled();
  });

  it('runs at most four searches at a time', async () => {
    let open = 0;
    let peak = 0;
    const releases = [];
    fetchMock.mockImplementation(() => {
      open += 1;
      peak = Math.max(peak, open);
      return new Promise((resolve) => releases.push(() => { open -= 1; resolve(answer(200, FOUND)); }));
    });
    let done = false;
    const all = Promise.all(Array.from({ length: 10 }, (_, i) => lookupFilm(`Film ${i}`)))
      .then(() => { done = true; return done; });
    while (!done) {
      await new Promise((resolve) => setTimeout(resolve, 0));
      releases.splice(0).forEach((release) => release());
    }
    await all;
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(peak).toBe(4);
  });
});
