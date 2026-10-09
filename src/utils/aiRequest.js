import axios from 'axios';
import { getAuth } from 'firebase/auth';

// Every call behind VUE_APP_AI_API_URL costs real money per request, and that
// URL is baked into the public client bundle — so the endpoint verifies a
// Firebase ID token and rate-limits per user (see aws-lambda/claude-ai.js).
// This is the one place that attaches the token, so no caller can forget.
//
// Throws if there's no signed-in user rather than firing a request that would
// come back 401 anyway. Callers already treat a failure as "no suggestions".
// The app-wide 8s timeout (networkHealth.js) is for "is anything answering";
// a model call takes 4-10s when everything is fine. Match the Lambda's own
// 30s limit plus a little slack, or the app hangs up on answers mid-flight.
export const AI_REQUEST_TIMEOUT_MS = 35000;

export async function postToAi (route, payload) {
  const user = getAuth().currentUser;
  if (!user) {
    throw new Error('Not signed in — AI features need an authenticated user.');
  }

  // Firebase refreshes this automatically when it's close to expiring, so this
  // is cheap to call per request and always returns something valid.
  const idToken = await user.getIdToken();

  return axios.post(`${process.env.VUE_APP_AI_API_URL}${route}`, payload, {
    timeout: AI_REQUEST_TIMEOUT_MS,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${idToken}`
    }
  });
}

// Statuses the endpoint answers on purpose when it is busy: the per-person
// limit (429) and AWS's concurrency overflow (503, see auth-and-db-rules.md).
const EXPECTED_STATUSES = new Set([429, 503]);

/**
 * What went wrong with a postToAi call, in words, and whether it is the kind
 * of failure that just happens (no connection, a timeout, the endpoint busy,
 * nobody signed in). Sentry, 2026-10-09: the keywords failure logged the
 * axios error as context and arrived as "[object Object]", with no way to
 * tell a dropped connection from a broken route.
 */
export function describeAiFailure (error) {
  const status = error?.response?.status;
  const detail = error?.response?.data?.detail || error?.response?.data?.error;
  if (status) {
    return {
      expected: EXPECTED_STATUSES.has(status),
      reason: `status ${status}${detail ? `: ${String(detail).slice(0, 200)}` : ''}`
    };
  }
  const message = String(error?.message || error || 'unknown error').slice(0, 200);
  const noAnswer = Boolean(error?.isAxiosError || error?.request || error?.code === 'ECONNABORTED');
  const signedOut = /signed in/i.test(message);
  return {
    expected: noAnswer || signedOut,
    reason: noAnswer ? `no answer (${error?.code || message})` : message
  };
}
