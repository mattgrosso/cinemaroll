// Whether the theater board has something you haven't seen: a film first
// seen on a board since your last visit to the Showtimes screen, at a
// theater no better theater covers, that you haven't dismissed and aren't
// already waiting on a reminder for.
//
// Pure, and store-free so the Watchlist's Showtimes card (its home since
// 2026-09-29, moved from the Insights directory) can ask without importing
// the Showtimes screen itself.

// Per device: stamped by ShowtimesScreen when it opens.
export const SHOWTIMES_SEEN_KEY = 'showtimesSeenAt';

export function hasUnseenShowtimes ({ board, dismissed = {}, reminders = {}, seenAt = 0 }) {
  const theaters = board?.theaters;
  if (!Array.isArray(theaters)) return false;
  const waiting = (t, l) => reminders[t.key]?.[l.slug] && !reminders[t.key][l.slug].sentAt;
  return theaters.some((t) => (t.listings || []).some((l) =>
    !l.coveredBy && !dismissed[t.key]?.[l.slug] && !waiting(t, l) && Number(l.firstSeenAt) > seenAt
  ));
}

// How many films are still waiting on the board, for the icon badge
// ("Showtimes waiting" under Notifications, off by default - Matt,
// 2026-10-05). One per film not dismissed, not snoozed (a reminder set and
// not yet sent; a sent one is back on screen), and not a film a better
// theater also has. A mirror of aws-lambda/pushCadence.js showtimesWaiting,
// which the push Lambda's badge uses; src/test/showtimesBadge.test.js pins
// the two together.
export function showtimesWaiting ({ board, dismissed = {}, reminders = {} }) {
  const theaters = Array.isArray(board?.theaters) ? board.theaters : [];
  let count = 0;
  theaters.forEach((t) => (Array.isArray(t.listings) ? t.listings : []).forEach((l) => {
    if (l.coveredBy || dismissed?.[t.key]?.[l.slug]) return;
    const r = reminders?.[t.key]?.[l.slug];
    if (r && !r.sentAt) return;
    count += 1;
  }));
  return count;
}
