import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

vi.mock('axios', () => ({ default: { post: vi.fn(() => Promise.resolve({ data: {} })) } }));

const getIdToken = vi.fn(() => Promise.resolve('a-real-token'));
let currentUser = { getIdToken };
vi.mock('firebase/auth', () => ({ getAuth: () => ({ get currentUser () { return currentUser; } }) }));

const { postToAi } = await import('@/utils/aiRequest.js');
const { REQUEST_TIMEOUT_MS } = await import('@/utils/networkHealth.js');

describe('postToAi', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = { getIdToken };
    getIdToken.mockResolvedValue('a-real-token');
  });

  it('attaches the signed-in user\'s ID token', async () => {
    // The endpoint costs money per call and its URL is public in the bundle, so
    // it verifies this token server-side. Every call has to carry one.
    await postToAi('/trivia', { title: 'Jaws', year: 1975 });

    const [, , config] = axios.post.mock.calls[0];
    expect(config.headers.Authorization).toBe('Bearer a-real-token');
  });

  it('posts the payload to the right route', async () => {
    await postToAi('/keywords', { title: 'Jaws' });

    const [url, payload] = axios.post.mock.calls[0];
    expect(url).toContain('/keywords');
    expect(payload).toEqual({ title: 'Jaws' });
  });

  it('waits longer than the app-wide 8s network timeout', async () => {
    // Bug report (Matt, 2026-09-24): "could not load context" every time.
    // The Lambda answered in 8.1s and 9.1s; the lie-fi work had just put an
    // 8s timeout on every axios request, so the app hung up on a reply that
    // was about to arrive. Model calls are slow by nature, not a dead link.
    await postToAi('/context', { title: 'Jaws', year: 1975 });

    const [, , config] = axios.post.mock.calls[0];
    expect(config.timeout).toBeGreaterThan(REQUEST_TIMEOUT_MS);
    expect(config.timeout).toBeGreaterThanOrEqual(30000);
  });

  it('refuses to fire a request at all when nobody is signed in', async () => {
    // Better to fail here than to spend a round trip on a guaranteed 401.
    currentUser = null;

    await expect(postToAi('/trivia', { title: 'Jaws' })).rejects.toThrow(/signed in/i);
    expect(axios.post).not.toHaveBeenCalled();
  });

  it('lets a token failure surface rather than sending an unauthenticated call', async () => {
    getIdToken.mockRejectedValue(new Error('token refresh failed'));

    await expect(postToAi('/trivia', { title: 'Jaws' })).rejects.toThrow();
    expect(axios.post).not.toHaveBeenCalled();
  });
});

const { describeAiFailure } = await import('@/utils/aiRequest.js');

describe('describeAiFailure', () => {
  // Sentry, 2026-10-09: "Failed to fetch keywords [object Object]" - the axios
  // error went out as context and the reason never reached the message.
  it('calls a dropped connection or timeout expected, and says which', () => {
    const timeout = { isAxiosError: true, code: 'ECONNABORTED', message: 'timeout of 35000ms exceeded' };
    expect(describeAiFailure(timeout)).toEqual({ expected: true, reason: 'no answer (ECONNABORTED)' });
    const dropped = { isAxiosError: true, code: 'ERR_NETWORK', message: 'Network Error' };
    expect(describeAiFailure(dropped).expected).toBe(true);
  });

  it('calls the endpoint being busy (429, 503) expected', () => {
    expect(describeAiFailure({ response: { status: 429, data: { error: 'Too many requests, slow down' } } }))
      .toEqual({ expected: true, reason: 'status 429: Too many requests, slow down' });
    expect(describeAiFailure({ response: { status: 503, data: {} } }))
      .toEqual({ expected: true, reason: 'status 503' });
  });

  it('calls a server failure unexpected and carries its detail', () => {
    const failed = { response: { status: 500, data: { error: 'AI request failed', detail: 'Unexpected end of JSON input' } } };
    expect(describeAiFailure(failed))
      .toEqual({ expected: false, reason: 'status 500: Unexpected end of JSON input' });
  });

  it('calls nobody signed in expected, and anything else unexpected with its message', () => {
    expect(describeAiFailure(new Error('Not signed in — AI features need an authenticated user.')).expected).toBe(true);
    expect(describeAiFailure(new Error('boom'))).toEqual({ expected: false, reason: 'boom' });
  });
});
