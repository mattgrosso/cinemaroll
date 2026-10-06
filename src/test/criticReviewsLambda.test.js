import { describe, it, expect } from 'vitest';
import {
  acceptReviews,
  searchedUrls,
  normalizeUrl,
  isTrustedOutlet,
  cacheLifetime,
  filmFromTmdb,
  SYSTEM_PROMPT,
  TRUSTED_OUTLETS,
  BLOCKED_DOMAINS
} from '../../aws-lambda/criticReviews.js';

// The /reviews route's rules (report, 2026-10-06: Ebert, Kael, "a brief
// summary and then a link to the full article"). The model searches and
// picks; this is what it is allowed to hand back.

const pick = (overrides = {}) => ({
  role: 'release',
  critic: 'Roger Ebert',
  outlet: 'Chicago Sun-Times',
  year: 1967,
  verdict: '4 stars',
  summary: 'He called it a milestone.',
  url: 'https://www.rogerebert.com/reviews/bonnie-and-clyde-1967',
  paywalled: false,
  ...overrides
});

const seen = (...urls) => new Set(urls.map(normalizeUrl));

describe('acceptReviews', () => {
  it('keeps a review whose link was in the search results', () => {
    const kept = acceptReviews([pick()], seen('https://www.rogerebert.com/reviews/bonnie-and-clyde-1967'));
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatchObject({ critic: 'Roger Ebert', year: 1967, role: 'release' });
  });

  // The guarantee that a link can't be invented: a URL the search never
  // returned is dropped, however plausible it looks.
  it('drops a review whose link the search never returned', () => {
    const kept = acceptReviews(
      [pick({ url: 'https://www.rogerebert.com/reviews/great-movie-bonnie-and-clyde-1967' })],
      seen('https://www.rogerebert.com/reviews/bonnie-and-clyde-1967')
    );
    expect(kept).toEqual([]);
  });

  it('drops a review from an outlet that is not on the trusted list, even if searched', () => {
    const blog = 'https://jdhansel.com/2017/09/bonnie-and-clyde-review';
    expect(acceptReviews([pick({ url: blog })], seen(blog))).toEqual([]);
  });

  it('matches links that differ only in www, query, fragment or trailing slash', () => {
    const kept = acceptReviews(
      [pick({ url: 'https://rogerebert.com/reviews/bonnie-and-clyde-1967/?utm_source=x#top' })],
      seen('https://www.rogerebert.com/reviews/bonnie-and-clyde-1967')
    );
    expect(kept).toHaveLength(1);
  });

  it('holds each job to its limit and orders release (oldest first), revisit, dissent', () => {
    const urls = [1, 2, 3, 4, 5].map((n) => `https://variety.com/review-${n}`);
    const kept = acceptReviews([
      pick({ role: 'dissent', critic: 'A', url: urls[0], year: 1990 }),
      pick({ role: 'release', critic: 'B', url: urls[1], year: 1968 }),
      pick({ role: 'release', critic: 'C', url: urls[2], year: 1967 }),
      pick({ role: 'release', critic: 'D', url: urls[3], year: 1967 }),
      pick({ role: 'revisit', critic: 'E', url: urls[4], year: 2017 })
    ], seen(...urls));
    expect(kept.map((r) => r.critic)).toEqual(['C', 'B', 'E', 'A']);
  });

  it('drops a duplicate link, an unknown job, and a pick with no summary', () => {
    const url = 'https://variety.com/review';
    const kept = acceptReviews([
      pick({ url }),
      pick({ url, critic: 'Someone else' }),
      pick({ role: 'gossip', url: 'https://variety.com/other' }),
      pick({ summary: '  ', url: 'https://variety.com/third' })
    ], seen(url, 'https://variety.com/other', 'https://variety.com/third'));
    expect(kept).toHaveLength(1);
  });

  it('lets the same critic do two different jobs (Ebert at release and his Great Movies essay)', () => {
    const a = 'https://www.rogerebert.com/reviews/bonnie-and-clyde-1967';
    const b = 'https://www.rogerebert.com/reviews/great-movie-bonnie-and-clyde-1967';
    const kept = acceptReviews([pick({ url: a }), pick({ url: b, role: 'revisit', year: 1998 })], seen(a, b));
    expect(kept).toHaveLength(2);
  });

  it('copes with nothing at all', () => {
    expect(acceptReviews(undefined, new Set())).toEqual([]);
  });
});

describe('searchedUrls', () => {
  it('collects result URLs and skips error results, whose content is an object', () => {
    const urls = searchedUrls([
      { type: 'text', text: 'hi' },
      { type: 'web_search_tool_result', content: [{ type: 'web_search_result', url: 'https://www.variety.com/a/' }] },
      { type: 'web_search_tool_result', content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' } }
    ]);
    expect([...urls]).toEqual(['variety.com/a']);
  });
});

describe('outlets', () => {
  it('trusts subdomains of a listed outlet and nothing else', () => {
    expect(isTrustedOutlet('https://www.nytimes.com/1967/08/14/archives/x.html')).toBe(true);
    expect(isTrustedOutlet('https://notnytimes.com/x')).toBe(false);
  });

  // Found trying it (2026-10-06): web search refuses an allowed_domains list
  // naming a site that blocks Anthropic's crawler, so the list is enforced
  // after the search instead — and the outlets are named in the prompt.
  it('names the trusted outlets in the prompt and keeps the block list apart from them', () => {
    for (const outlet of TRUSTED_OUTLETS) expect(SYSTEM_PROMPT).toContain(outlet);
    for (const blocked of BLOCKED_DOMAINS) expect(TRUSTED_OUTLETS).not.toContain(blocked);
  });
});

describe('cacheLifetime', () => {
  it('keeps an old film\'s reviews, refreshes a new film monthly, and retries a failure within the hour', () => {
    expect(cacheLifetime({ filmYear: 1958, found: true, nowYear: 2026 })).toBeNull();
    expect(cacheLifetime({ filmYear: 2026, found: true, nowYear: 2026 })).toBe(30 * 24 * 3600);
    expect(cacheLifetime({ filmYear: 1958, found: false, nowYear: 2026 })).toBe(30 * 24 * 3600);
    expect(cacheLifetime({ failed: true })).toBe(3600);
  });
});

// The film comes from TMDB's record of the id, never the request body
// (2026-10-06: a request with the wrong id stored one film's reviews under
// another's key for everyone).
describe('filmFromTmdb', () => {
  it('takes the title, year and director from the TMDB record', () => {
    expect(filmFromTmdb({
      title: 'The Little Mermaid',
      release_date: '1989-11-17',
      credits: { crew: [{ job: 'Producer', name: 'Howard Ashman' }, { job: 'Director', name: 'Ron Clements' }, { job: 'Director', name: 'John Musker' }] }
    })).toEqual({ title: 'The Little Mermaid', year: 1989, director: 'Ron Clements, John Musker' });
  });

  it('copes with a record that has no date or crew', () => {
    expect(filmFromTmdb({ title: 'Untitled', credits: {} })).toEqual({ title: 'Untitled', year: null, director: '' });
  });

  it('is null for nothing, or for a record without a title', () => {
    expect(filmFromTmdb(null)).toBeNull();
    expect(filmFromTmdb({ release_date: '1990-01-01' })).toBeNull();
  });
});
