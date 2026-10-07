// When a friend's feed that USED to validate as v2 stops — the head unreadable,
// the body revision not matching, a journal gap that even a bootstrap could not
// certify — the reader quietly falls back to the legacy body, which costs that
// friend a full download every refresh. Matt (2026-10-06): "if we ever do stop
// validating, catch it quickly." So the first fallback per feed per hour is a
// Sentry warning (fingerprinted per feed so repeats group into one issue), and
// Sentry's new-issue email is the alarm. A peer that never supported v2 is not
// a fallback and is never reported.
const lastReported = new Map();
export const REPORT_EVERY_MS = 60 * 60 * 1000;

/** Once per feed per hour. Exported with its clock and map for the tests. */
export function fallbackReportDue (key, now = Date.now(), seen = lastReported, every = REPORT_EVERY_MS) {
  if (seen.has(key) && now - seen.get(key) < every) return false;
  seen.set(key, now);
  return true;
}

const defaultCapture = async (message, context) => {
  const Sentry = await import('@sentry/vue');
  Sentry.captureMessage(message, context);
};

/** Fire-and-forget; never throws into the sync. */
export async function reportFeedFallback ({ friendName, feedUrl, reason, established, now = Date.now(), capture = defaultCapture, seen = lastReported }) {
  if (!established) return false;
  const host = (() => { try { return new URL(feedUrl).host; } catch { return 'unknown-host'; } })();
  console.warn(`[film-club] ${friendName || 'a friend'}'s feed fell back to v1 (${reason})`);
  if (!fallbackReportDue(`${host}|${friendName}`, now, seen)) return false;
  try {
    await capture(`Film Club feed fell back to v1: ${friendName || 'a friend'} (${reason})`, {
      level: 'warning',
      tags: { feature: 'film-club-sync', reason: String(reason || 'unknown'), feedHost: host },
      fingerprint: ['film-club-v2-fallback', host, String(friendName || '')]
    });
  } catch (error) {
    console.warn('[film-club] could not report the fallback', error?.message);
  }
  return true;
}
