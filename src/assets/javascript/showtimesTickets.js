// "Got tickets" on the Showtimes screen (Matt, 2026-10-27: "swipe right to
// dismiss, swipe left to snooze, and then there should be a third way that I
// can mark as that I got tickets"). Hold a poster, let go, confirm.
//
// A ticket is a dismissal with a note on it: theaters/dismissed/<theater>/
// <slug> = { at, tickets: true } instead of a bare time. Every reader that
// skips dismissed films (the pushes, the icon badge, the Watchlist dot, the
// sweep's two-week pruning) only asks whether the key is there, so they all
// keep working untouched. Only this screen tells the two apart, to keep them
// in separate piles.
//
// Pure and store-free, like showtimesUnread.js.

import { titleKey } from './showtimesUnread.js';

export function ticketsMark (now = Date.now()) {
  return { at: now, tickets: true };
}

export function isTicketsMark (value) {
  return Boolean(value && typeof value === 'object' && value.tickets === true);
}

// Tickets are for the film, not one theater's copy of it: once you have
// seats, it's handled wherever it's showing. Every listing of the film on
// the board, as { theaterKey, slug }. A title that folds to nothing matches
// only itself.
export function filmCopies (theaters, title) {
  const key = titleKey(title);
  const copies = [];
  (Array.isArray(theaters) ? theaters : []).forEach((t) => (Array.isArray(t?.listings) ? t.listings : []).forEach((l) => {
    if (!l || !l.slug) return;
    if (key ? titleKey(l.title) === key : l.title === title) copies.push({ theaterKey: t.key, slug: l.slug });
  }));
  return copies;
}

// The films (by titleKey) you have tickets for, from any copy's mark.
export function ticketFilms (theaters, dismissed) {
  const films = new Set();
  if (!dismissed || typeof dismissed !== 'object') return films;
  (Array.isArray(theaters) ? theaters : []).forEach((t) => (Array.isArray(t?.listings) ? t.listings : []).forEach((l) => {
    if (!l || !isTicketsMark(dismissed[t.key]?.[l.slug])) return;
    const key = titleKey(l.title);
    if (key) films.add(key);
  }));
  return films;
}
