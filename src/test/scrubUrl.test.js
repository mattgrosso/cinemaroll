import { describe, it, expect } from 'vitest';
import { scrubUrl, scrubEvent, scrubBreadcrumb } from '@/utils/scrubUrl.js';

// 2026-10-06: a Sentry "N+1 API Call" alert's spans were nine Movie Hat
// reads, each URL carrying the Firebase ID token as ?auth=.
describe('scrubUrl', () => {
  it('blanks the secret-looking query values and keeps everything else', () => {
    expect(scrubUrl('https://x.firebaseio.com/hats/A/k/movies.json?auth=eyJhb.secret.sig'))
      .toBe('https://x.firebaseio.com/hats/A/k/movies.json?auth=[Filtered]');
    expect(scrubUrl('https://api.themoviedb.org/3/search/movie?api_key=abc123&language=en-US&query=heat'))
      .toBe('https://api.themoviedb.org/3/search/movie?api_key=[Filtered]&language=en-US&query=heat');
    expect(scrubUrl('https://app/#/login?testToken=tok')).toBe('https://app/#/login?testToken=[Filtered]');
    expect(scrubUrl('https://x/path?access_token=1&shallow=true#frag')).toBe('https://x/path?access_token=[Filtered]&shallow=true#frag');
  });

  it('leaves URLs without secrets, or without a query, alone', () => {
    expect(scrubUrl('https://image.tmdb.org/t/p/w500/abc.jpg')).toBe('https://image.tmdb.org/t/p/w500/abc.jpg');
    expect(scrubUrl('https://en.wikipedia.org/w/api.php?action=query&format=json')).toBe('https://en.wikipedia.org/w/api.php?action=query&format=json');
    expect(scrubUrl(undefined)).toBeUndefined();
  });

  it('scrubs a transaction event: its request, its spans and its breadcrumbs', () => {
    const event = {
      request: { url: 'https://cinemaroll.org/?auth=x' },
      breadcrumbs: [{ category: 'fetch', data: { url: 'https://db/a.json?auth=t', method: 'GET' } }],
      spans: [{ op: 'http.client', description: 'GET https://db/a.json?auth=t', data: { 'http.url': 'https://db/a.json?auth=t', 'http.method': 'GET' } }],
      contexts: { trace: { op: 'pageload', description: 'https://cinemaroll.org/?auth=x' } }
    };
    const out = scrubEvent(event);
    expect(out.request.url).toBe('https://cinemaroll.org/?auth=[Filtered]');
    expect(out.breadcrumbs[0].data.url).toBe('https://db/a.json?auth=[Filtered]');
    expect(out.spans[0].description).toBe('GET https://db/a.json?auth=[Filtered]');
    expect(out.spans[0].data['http.url']).toBe('https://db/a.json?auth=[Filtered]');
    expect(out.spans[0].data['http.method']).toBe('GET');
    expect(out.contexts.trace.description).toBe('https://cinemaroll.org/?auth=[Filtered]');
    expect(scrubBreadcrumb({ message: 'GET https://db/b.json?api_key=k' }).message).toBe('GET https://db/b.json?api_key=[Filtered]');
  });
});
