import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criticsSummary, criticByline, criticRoleLabel } from '@/assets/javascript/criticReviews.js';

const postToAi = vi.hoisted(() => vi.fn());
vi.mock('@/utils/aiRequest.js', () => ({ postToAi }));

const { fetchCriticReviews, criticErrorMessage, resetCriticReviewsCache } = await import('@/utils/criticReviewsRequest.js');

const ebert = { role: 'release', critic: 'Roger Ebert', outlet: 'rogerebert.com', year: 1990, url: 'https://x/1' };

describe('critics wording', () => {
  it('summarises the folded row by state, naming at most two critics', () => {
    expect(criticsSummary('idle')).toBe('What the critics said');
    expect(criticsSummary('loading')).toBe('Looking…');
    expect(criticsSummary('ready', [])).toBe('None found');
    expect(criticsSummary('ready', [
      ebert,
      { ...ebert, role: 'revisit' },
      { critic: 'Owen Gleiberman' },
      { critic: 'Staff review', outlet: 'Variety' }
    ])).toBe('Roger Ebert, Owen Gleiberman +1');
  });

  it('writes the byline, folding an unsigned review into its outlet', () => {
    expect(criticByline(ebert)).toBe('Roger Ebert, rogerebert.com, 1990');
    expect(criticByline({ critic: 'Staff review', outlet: 'Variety', year: null })).toBe('Staff review, Variety');
    expect(criticRoleLabel('dissent')).toBe('Against the grain');
  });
});

describe('fetchCriticReviews', () => {
  beforeEach(() => {
    resetCriticReviewsCache();
    postToAi.mockReset();
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('asks again while the search is pending, then remembers the answer for the page load', async () => {
    postToAi
      .mockResolvedValueOnce({ data: { status: 'pending', reviews: [] } })
      .mockResolvedValueOnce({ data: { status: 'ready', reviews: [ebert] } });
    const answer = fetchCriticReviews({ tmdbId: 10144, title: 'The Godfather Part III' }, { pollMs: 5000 });
    await vi.advanceTimersByTimeAsync(5000);
    await expect(answer).resolves.toEqual({ status: 'ready', reviews: [ebert] });
    expect(postToAi).toHaveBeenCalledTimes(2);
    expect(postToAi).toHaveBeenCalledWith('/reviews', expect.objectContaining({ tmdbId: '10144' }));

    await expect(fetchCriticReviews({ tmdbId: 10144 })).resolves.toEqual({ status: 'ready', reviews: [ebert] });
    expect(postToAi).toHaveBeenCalledTimes(2);
  });

  it('shares one lookup between two opens of the same film', async () => {
    postToAi.mockResolvedValue({ data: { status: 'ready', reviews: [] } });
    await Promise.all([fetchCriticReviews({ tmdbId: 1 }), fetchCriticReviews({ tmdbId: 1 })]);
    expect(postToAi).toHaveBeenCalledTimes(1);
  });

  it('gives up as failed when the search never finishes', async () => {
    postToAi.mockResolvedValue({ data: { status: 'pending', reviews: [] } });
    const answer = fetchCriticReviews({ tmdbId: 2 }, { pollMs: 10, limit: 3 });
    await vi.advanceTimersByTimeAsync(100);
    await expect(answer).resolves.toEqual({ status: 'failed', reviews: [] });
    expect(postToAi).toHaveBeenCalledTimes(3);
  });

  it('turns request failures into sentences', () => {
    expect(criticErrorMessage({ response: { status: 429, data: { error: "That's all the review lookups for today - they reset tomorrow." } } }))
      .toMatch(/reset tomorrow/);
    expect(criticErrorMessage(new Error('Not signed in — AI features need an authenticated user.'))).toBe('Sign in to look up reviews.');
    expect(criticErrorMessage(new Error('Network Error'))).toBe("Couldn't reach the reviews just now.");
  });
});
