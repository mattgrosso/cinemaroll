import { describe, it, expect } from 'vitest';
import { findBurst, labelBurst, requestPattern, BURST_MIN_COUNT } from '@/utils/burstLabel.js';
import { beforeSendTransaction } from '@/utils/sentryBeforeSend.js';

// 2026-10-19: Sentry's "N+1 API Call" alerts kept reopening on Home, Watchlist
// and Film Club, and each time someone had to guess which burst it was. The
// transaction now carries a burst_cause tag naming it.

const HAT = 'https://movie-hat-9c418-default-rtdb.firebaseio.com';
const TMDB = 'https://api.themoviedb.org/3';

function span (url, { inData = true } = {}) {
  return inData
    ? { op: 'http.client', description: `GET ${url}`, data: { url, 'http.method': 'GET' } }
    : { op: 'http.client', description: `GET ${url}` };
}

function transaction (urls, extra = []) {
  return { type: 'transaction', transaction: 'Home', tags: { route: 'Home' }, spans: [...urls.map((u) => span(u)), ...extra] };
}

const repeat = (n, make) => Array.from({ length: n }, (_, i) => make(i));

describe('burst labels', () => {
  it('names the Movie Hat read: the index and one read per hat', () => {
    const event = transaction([
      `${HAT}/userHats/mattgrosso%40gmail%2Ecom.json?auth=t`,
      ...repeat(8, (i) => `${HAT}/hats/${encodeURIComponent(`Hat ${i}`)}/-Nab${i}xYz/movies.json?auth=t`)
    ]);
    expect(findBurst(event)).toEqual({ cause: 'movie-hat-read', count: 8, pattern: 'movie-hat-9c418-default-rtdb.firebaseio.com/hats/*/*/movies.json' });
  });

  it('names each TMDB lookup burst by its endpoint', () => {
    for (const [endpoint, cause] of [
      ['search/person', 'tmdb-person-lookups'],
      ['search/company', 'tmdb-company-lookups'],
      ['search/keyword', 'tmdb-keyword-lookups'],
      ['search/movie', 'tmdb-movie-search']
    ]) {
      const event = transaction(repeat(6, (i) => `${TMDB}/${endpoint}?api_key=[Filtered]&query=name${i}`));
      expect(findBurst(event)).toEqual({ cause, count: 6, pattern: `api.themoviedb.org/3/${endpoint}` });
    }
  });

  it('calls anything else unknown, with its pattern and count', () => {
    const event = transaction(repeat(7, (i) => `${TMDB}/movie/${1000 + i}/credits?api_key=k`));
    expect(findBurst(event)).toEqual({ cause: 'unknown', count: 7, pattern: 'api.themoviedb.org/3/movie/*/credits' });
  });

  it('tags the event, keeping its other tags, and reads URLs from descriptions too', () => {
    const event = { spans: repeat(5, (i) => span(`${TMDB}/search/person?query=p${i}`, { inData: false })), tags: { route: 'Home' } };
    labelBurst(event);
    expect(event.tags).toEqual({ route: 'Home', burst_cause: 'tmdb-person-lookups', burst_count: '5', burst_pattern: 'api.themoviedb.org/3/search/person' });
  });

  it('tags nothing below the burst size, and ignores spans that are not requests', () => {
    const event = transaction(
      repeat(BURST_MIN_COUNT - 1, (i) => `${TMDB}/search/person?query=p${i}`),
      repeat(10, () => ({ op: 'resource.img', description: 'https://image.tmdb.org/t/p/w500/a1.jpg' }))
    );
    expect(findBurst(event)).toBeNull();
    expect(labelBurst(event).tags).toEqual({ route: 'Home' });
    expect(labelBurst({}).tags).toBeUndefined();
  });

  it('names the largest group when several kinds of request ran', () => {
    const event = transaction([
      ...repeat(5, (i) => `${TMDB}/search/company?query=c${i}`),
      ...repeat(9, (i) => `${HAT}/hats/T${i}/k${i}/movies.json`)
    ]);
    expect(findBurst(event).cause).toBe('movie-hat-read');
  });

  it('stars ids and drops the query', () => {
    expect(requestPattern('https://api.themoviedb.org/3/person/12345/movie_credits?api_key=k')).toEqual({ host: 'api.themoviedb.org', path: '/3/person/*/movie_credits' });
    expect(requestPattern('not a url')).toBeNull();
  });

  it('runs in the Sentry transaction hook after the scrubber', () => {
    const event = transaction(repeat(6, (i) => `${HAT}/hats/T${i}/k${i}/movies.json?auth=secret`));
    const out = beforeSendTransaction(event);
    expect(out.tags.burst_cause).toBe('movie-hat-read');
    expect(out.spans[0].data.url).toBe(`${HAT}/hats/T0/k0/movies.json?auth=[Filtered]`);
  });
});
