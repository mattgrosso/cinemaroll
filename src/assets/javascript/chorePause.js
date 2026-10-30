// A chore put away with its X stays away until tomorrow — everywhere, not just
// on the card.
//
// Bug report (Matt, 2026-10-30): "I hit the X on one of the notification
// pop-ups ... it went away ... but now I still have a red dot on my icon ...
// if I hit the X on something like that, what it ought to do is just reset it
// and then it should reappear next time it would've appeared anyway."
//
// The X (homeNotices.js) only hid the card on that phone, in localStorage,
// which only Home reads. The icon badge (appBadge.js) and the push Lambda
// count from the published digest (pushDigest.js), which never heard about
// it — so the chore still counted, and stickiness, with no daily quota by
// default, is always "open". Now the X on a chore card also writes
// `settings/choresPausedUntil/<chore>` = the next local midnight (the same
// "until tomorrow" the card means), and the digest folds that into the
// section's `eligibleAt`, which the badge and the Lambda already honour.
// Tapping a chore notification clears the pauses, like the card dismissals.

import { CHORE_NOTICES } from './homeNotices.js';

export const CHORE_PAUSE_PATH = 'settings/choresPausedUntil';

// The user's next midnight — when "hidden for today" ends.
export function chorePauseEnd (now = Date.now()) {
  const date = new Date(now);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

// When this chore's pause ends, or 0 if it isn't paused right now.
export function chorePausedUntil (settings, chore, now = Date.now()) {
  const until = Number(settings?.choresPausedUntil?.[chore]);
  return Number.isFinite(until) && until > now ? until : 0;
}

// A section's eligibleAt with the pause folded in. `null` (never) stays never.
export function withChorePause (gate, settings, chore, now = Date.now()) {
  if (gate === null) return null;
  return Math.max(Number(gate) || 0, chorePausedUntil(settings, chore, now));
}

export function isChore (id) {
  return CHORE_NOTICES.includes(id);
}
