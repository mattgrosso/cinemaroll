import { postToAi } from './aiRequest.js';

// Critics' reviews for one film, from the AI endpoint's /reviews route.
//
// The server answers at once when the film has been looked up before (by
// anyone — the answer is stored per film), and otherwise starts a search in
// the background and says `pending`. So this asks again every few seconds
// until the answer is there. The interval is set by the endpoint's per-person
// limit of 20 calls a minute, which the other AI routes share: every 5s is 12.
export const CRITIC_POLL_MS = 5000;
// A search takes 10-30 seconds; the job gives up at two minutes.
export const CRITIC_POLL_LIMIT = 30;

const answered = new Map(); // tmdbId -> reviews, for this page load
const inFlight = new Map(); // tmdbId -> promise

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A sentence for the screen from a failed request. */
export function criticErrorMessage (error) {
  const status = error?.response?.status;
  const serverMessage = error?.response?.data?.error;
  if (status === 429 && serverMessage) return serverMessage;
  if (status === 401 || /not signed in/i.test(error?.message || '')) return 'Sign in to look up reviews.';
  return "Couldn't reach the reviews just now.";
}

async function poll (film, { pollMs, limit }) {
  for (let attempt = 0; attempt < limit; attempt += 1) {
    const { data } = await postToAi('/reviews', film);
    if (data?.status === 'ready') {
      const reviews = Array.isArray(data.reviews) ? data.reviews : [];
      answered.set(film.tmdbId, reviews);
      return { status: 'ready', reviews };
    }
    if (data?.status === 'failed') return { status: 'failed', reviews: [] };
    await wait(pollMs);
  }
  return { status: 'failed', reviews: [] };
}

/**
 * Resolves to { status: 'ready' | 'failed', reviews }. Throws on a request
 * error (network, sign-in, the daily limit) — see criticErrorMessage.
 */
export function fetchCriticReviews (film, { pollMs = CRITIC_POLL_MS, limit = CRITIC_POLL_LIMIT } = {}) {
  const key = String(film?.tmdbId || '');
  if (answered.has(key)) return Promise.resolve({ status: 'ready', reviews: answered.get(key) });
  if (inFlight.has(key)) return inFlight.get(key);

  const request = poll({ ...film, tmdbId: key }, { pollMs, limit })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}

/** Tests only. */
export function resetCriticReviewsCache () {
  answered.clear();
  inFlight.clear();
}
