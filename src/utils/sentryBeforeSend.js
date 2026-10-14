// What leaves for Sentry, and what doesn't.
import { scrubEvent } from './scrubUrl.js';
import { isStaleChunkError, staleChunkReloadTriggered } from './staleChunkReload.js';

function describes (event, hint) {
  return hint?.originalException?.message
    || event?.exception?.values?.[0]?.value
    || event?.message
    || '';
}

/**
 * A stale-chunk failure that the router has already answered with a reload
 * is self-healing, so it is dropped: every deploy would otherwise open a new
 * Sentry issue (the chunk's hash is in the message) and a new Bug Desk card
 * for a page that fixed itself a moment later. One that did NOT get a reload
 * (the once-per-route guard) still goes out — that screen is dead.
 */
export function beforeSendError (event, hint) {
  if (staleChunkReloadTriggered() && isStaleChunkError({ message: describes(event, hint) })) return null;
  return scrubEvent(event);
}

/**
 * A page Sentry should stay out of entirely: a production build served from
 * this machine (scripts/perf-tour.mjs, `vite preview`, a screenshot run), or
 * any automated browser — Playwright, Puppeteer and Selenium all set
 * `navigator.webdriver`. Those are tests, not users, and their errors reached
 * Sentry as if from the live site (2026-10-08: a stale-chunk error from
 * HeadlessChrome at localhost; 2026-10-14: a tester run against
 * cinemaroll.org whose Playwright blocked the service worker, so
 * register-service-worker crashed reading `.waiting` off nothing).
 */
export function isTestBrowser (win = typeof window !== 'undefined' ? window : undefined) {
  if (!win) return false;
  if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(win.location?.hostname || '')) return true;
  return win.navigator?.webdriver === true;
}
