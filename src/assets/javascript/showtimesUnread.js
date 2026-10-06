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
  const gone = dismissedFilms(theaters, dismissed);
  const waiting = (t, l) => reminders[t.key]?.[l.slug] && !reminders[t.key][l.slug].sentAt;
  return theaters.some((t) => (t.listings || []).some((l) =>
    !l.coveredBy && !dismissed[t.key]?.[l.slug] && !gone.has(titleKey(l.title)) && !waiting(t, l) && Number(l.firstSeenAt) > seenAt
  ));
}

// One film, however a theater words it: case, bracketed years, "in 35mm",
// "New Restoration", Alamo's event suffixes all fold. A copy of
// aws-lambda/pushCadence.js titleKey; showtimesBadge.test.js pins the two.
export function titleKey (title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\((?:[^()]*)\)/g, ' ')
    .replace(/\b(?:in|on)\s+(?:35|70|16)\s*mm\b/g, ' ')
    .replace(/\b(?:new\s+)?(?:4k\s+)?restoration\b/g, ' ')
    .replace(/\b(?:dubbed|subtitled|encore|advance screening|the big show|insider screening)\b/g, ' ')
    .replace(/[‘’'"`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// A dismissal is the film's, not one theater's (2026-10-06: "At the
// Udvar-Hazy IMAX, I keep getting notifications for the same movie over and
// over again" - he'd dismissed the same films at the Air and Space IMAX).
// The titles dismissed at any theater on the board. Mirrors pushCadence.js.
export function dismissedFilms (theaters, dismissed) {
  const gone = new Set();
  if (!dismissed || typeof dismissed !== 'object') return gone;
  (theaters || []).forEach((t) => (Array.isArray(t?.listings) ? t.listings : []).forEach((l) => {
    if (!l || !dismissed[t.key]?.[l.slug]) return;
    const key = titleKey(l.title);
    if (key) gone.add(key);
  }));
  return gone;
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
  const gone = dismissedFilms(theaters, dismissed);
  let count = 0;
  theaters.forEach((t) => (Array.isArray(t.listings) ? t.listings : []).forEach((l) => {
    if (l.coveredBy || dismissed?.[t.key]?.[l.slug] || gone.has(titleKey(l.title))) return;
    const r = reminders?.[t.key]?.[l.slug];
    if (r && !r.sentAt) return;
    count += 1;
  }));
  return count;
}
