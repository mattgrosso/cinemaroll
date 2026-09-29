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
