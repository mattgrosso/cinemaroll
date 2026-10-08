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
