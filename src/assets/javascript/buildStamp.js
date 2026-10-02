// "Am I looking at new code?" — answered without opening devtools.
//
// House standard (Matt, 2026-08-22): every app shows its version and when that
// build was made, in one muted line, in the same format everywhere:
//
//     v1.96.4 · built Aug 22, 1:32 AM
//
// The timestamp is stamped at BUILD time, not page-load time — that's the
// distinction that makes it useful. A tab left open for a week keeps showing
// the build it is still running, so a stale one is obvious at a glance. Here
// the build time arrives as `VUE_APP_BUILD_TIME`, set in `vite.config.mjs` when
// the build starts (see the comment there), and the version is the existing
// `VUE_APP_VERSION` that `yarn deploy` bumps — no second version number.

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'
];

const pad = (n) => String(n).padStart(2, '0');

/**
 * "Aug 22, 1:32 AM" — local time, because the question is always "is this
 * newer than the deploy I just did?", which is asked in local time. The year
 * appears only when it isn't the current one, so the common case stays short.
 * Returns null rather than a lie when there's nothing usable to format.
 */
export function formatBuildTime (value, now = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (!value || Number.isNaN(date.getTime())) return null;

  const hour24 = date.getHours();
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const meridiem = hour24 < 12 ? 'AM' : 'PM';
  const year = date.getFullYear() === now.getFullYear() ? '' : `, ${date.getFullYear()}`;
  return `${MONTHS[date.getMonth()]} ${date.getDate()}${year}, ${hour}:${pad(date.getMinutes())} ${meridiem}`;
}

/**
 * The one line every app renders: "v1.96.4 · built Aug 22, 1:32 AM".
 * Degrades rather than disappearing — a missing version or an unparseable
 * timestamp still leaves something true on screen.
 */
export function buildStampText ({ version, buildTime, now } = {}) {
  const when = formatBuildTime(buildTime, now);
  const parts = [];
  if (version) parts.push(`v${version}`);
  if (when) parts.push(`built ${when}`);
  return parts.join(' · ');
}

// Handed over by main.js, the one place that reads the build-time values
// (Vite's `define` inlines VUE_APP_VERSION / VUE_APP_BUILD_TIME there).
// They used to be read right here, but this module lives in the shared core
// chunk, and a value that changes on every build made that chunk - and so
// every screen's file - change on every deploy (bug report, 2026-10-02; see
// coreChunk in vite.config.mjs). Unset (Vitest, unless a test sets them) is
// exactly the degraded case above.
let build = {};

export function setBuildInfo ({ version = null, buildTime = null } = {}) {
  build = { version, buildTime };
}

export const appVersion = () => build.version || null;
export const buildTime = () => build.buildTime || null;

/** The full house stamp for this build. */
export function buildStamp () {
  return buildStampText({ version: appVersion(), buildTime: buildTime() });
}

/**
 * Just the version half, for the header's corner badge — 0.5rem of type over a
 * banner photo has no room for a timestamp, and this is the standard's own
 * degraded form rather than a second competing style. The full stamp lives in
 * the footer, on screen at all times.
 */
export function versionLabel () {
  return buildStampText({ version: appVersion() });
}

// TAPPING THE STAMP RELOADS THE APP. Matt, 2026-09-19: "when we were
// building Space Base ages ago, we built in a thing where I could tap on the
// version number and it would force a refresh... it would be nice if tapping
// on a version number on any of our apps would refresh the app. Because you
// can't really refresh when you're in an installed app on the iPhone."
//
// That last sentence is the whole reason this exists: a home-screen PWA has
// no URL bar and no reload button, so when the update check has not yet
// noticed a deploy - or is waiting for a quiet moment - there is no way to
// ask for the new code by hand.
//
// A plain location.reload() is not enough there: the service worker will
// happily serve the same precached bundle back. So the caches go first, and
// any worker that is sitting in `waiting` is told to take over. Every step
// is best-effort - whatever fails, the reload still happens, because a tap
// that does nothing at all is the one outcome that must not be possible.
export const forceRefresh = async () => {
  try {
    const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
    await Promise.all(regs.map((r) => r.update().catch(() => {})));
    regs.forEach((r) => r.waiting?.postMessage?.({ type: 'SKIP_WAITING' }));
    if (window.caches?.keys) {
      const keys = await window.caches.keys();
      await Promise.all(keys.map((k) => window.caches.delete(k).catch(() => {})));
    }
  } catch {
    // Never let the housekeeping cost us the reload.
  }
  window.location.reload();
};
