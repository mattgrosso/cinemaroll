// House module (2026-10-08): the "errors nobody saw" channel.
//
// Every app reported only uncaught errors to Sentry. The failures that
// matter most — a refused Firebase write, a sync that gave up, a TMDB 429 —
// were caught, console.error'd, and gone (Cinema Roll alone had 151 such
// calls and two Sentry captures). Sentry's captureConsole integration now
// turns every console.error into an event, and this filter keeps that from
// costing anything: a per-page-load budget, one event per message shape,
// and a fingerprint that files "lookup failed for Tom Hanks" with "... for
// Brad Pitt" — one Sentry issue, one Bug Desk card. Uncaught errors pass
// through untouched.
//
// Byte-identical in every app (see tools/house-drift.mjs). Change it in one
// repo, copy to the rest.

export const CONSOLE_BUDGET_PER_LOAD = 20;

/** The shape of a message with its particulars removed, for grouping. */
export function normalizeMessage (message) {
  return String(message ?? '')
    .replace(/https?:\/\/\S+/g, 'URL')
    .replace(/"[^"]*"|'[^']*'|`[^`]*`/g, '"…"')
    .replace(/\b[0-9a-f]{8,}\b/gi, 'ID')
    .replace(/\d+(\.\d+)?/g, '#')
    // The house phrasing: "... failed for <name>", "... friend <name> <why>".
    .replace(/\b(for|friend|hat|user|movie|file)\s+\S.*$/i, '$1 …')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export function isConsoleCapture (event) {
  return event?.logger === 'console' || event?.exception?.values?.some((v) => v?.mechanism?.type === 'console') || false;
}

function describe (event, hint) {
  return event?.message
    || hint?.originalException?.message
    || event?.exception?.values?.[0]?.value
    || '';
}

/**
 * A beforeSend. `next` is the scrubber that ran alone before (scrubEvent),
 * so this wraps it rather than replacing it. Returns null to drop.
 */
export function handledErrorFilter (next = (event) => event, { budget = CONSOLE_BUDGET_PER_LOAD } = {}) {
  const seen = new Set();
  let spent = 0;
  return (event, hint) => {
    if (isConsoleCapture(event)) {
      const key = normalizeMessage(describe(event, hint));
      if (seen.has(key) || spent >= budget) return null;
      seen.add(key);
      spent += 1;
      event.fingerprint = ['console', key];
      event.tags = { ...(event.tags || {}), handled: 'console' };
    }
    return next(event, hint);
  };
}
