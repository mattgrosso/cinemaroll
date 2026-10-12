// Your Nth watch (report 2026-10-11: "I should be able to look up what my
// Xth watch was").
//
// Every dated viewing in the library, rewatches included, numbered from 1 in
// the order they happened. Undated viewings get no number — there's no honest
// place to put them. Viewings on the same instant keep logged order (the sort
// is stable over the library's own order).
//
// Shorts COUNT, whatever the "Include short films" setting says — like the
// Insights calendar, a short still means you watched something that day, and
// the number a viewing carries must not change when a setting is flipped.
//
// A viewing is addressed by its entry's dbKey and its index in that entry's
// `ratings` array, which is the order getAllRatings returns them in, so a
// ratings list can label row `index` directly.

import { memoByIdentity } from '../../utils/memoByIdentity.js';

/** A rating's date as epoch ms: a number, a string of one, or a date string. */
export function viewingTime (rating) {
  const date = rating?.date;
  if (date === null || date === undefined || date === '') return null;
  if (typeof date === 'number') return Number.isFinite(date) ? date : null;
  const text = String(date).trim();
  const ms = /^\d+$/.test(text) ? parseInt(text, 10) : Date.parse(text);
  return Number.isFinite(ms) ? ms : null;
}

export function viewingKey (dbKey, index) {
  return `${dbKey}:${index}`;
}

/**
 * { ordered: [{ number, dbKey, index, at, entry }], byKey: Map(viewingKey -> number) }
 */
export function buildWatchNumbers (entries) {
  const viewings = [];
  (entries || []).forEach((entry) => {
    if (!entry || !Array.isArray(entry.ratings)) return;
    entry.ratings.forEach((rating, index) => {
      const at = viewingTime(rating);
      if (at === null) return;
      viewings.push({ dbKey: entry.dbKey, index, at, entry });
    });
  });

  viewings.sort((a, b) => a.at - b.at);

  const byKey = new Map();
  viewings.forEach((viewing, position) => {
    viewing.number = position + 1;
    byKey.set(viewingKey(viewing.dbKey, viewing.index), viewing.number);
  });

  return { ordered: viewings, byKey };
}

// Keyed on the store getter's array, so it's built once per library change
// and shared by Home, the result cards and the movie page.
export const watchNumbersFor = memoByIdentity(buildWatchNumbers);

/** The viewing numbered `number`, or null. */
export function viewingNumbered (index, number) {
  if (!index || !Number.isInteger(number) || number < 1) return null;
  return index.ordered[number - 1] || null;
}

/** The number of `entry.ratings[ratingIndex]`, or null when it has none. */
export function watchNumberOf (index, dbKey, ratingIndex) {
  return index?.byKey.get(viewingKey(dbKey, ratingIndex)) ?? null;
}

/**
 * Does the typed text ask for a watch by number? "#812", "812th",
 * "812th watch", "watch 812", "watch #812", "viewing 812". A bare number is
 * NOT one — "1999" stays a year, and plain digits can be part of a title.
 * Returns the number, or null.
 */
export function parseWatchNumberQuery (text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (!value) return null;

  const patterns = [
    /^#\s*(\d+)$/,
    /^#?(\d+)(?:st|nd|rd|th)(?:\s+(?:watch|viewing|film|movie))?$/,
    /^(?:watch|viewing)\s*(?:no\.?|number)?\s*#?\s*(\d+)$/
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match) {
      const number = parseInt(match[1], 10);
      return number >= 1 ? number : null;
    }
  }
  return null;
}

/** 1 -> "1st", 12 -> "12th", 812 -> "812th". */
export function ordinalSuffix (number) {
  const mod100 = number % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${number}th`;
  switch (number % 10) {
    case 1: return `${number}st`;
    case 2: return `${number}nd`;
    case 3: return `${number}rd`;
    default: return `${number}th`;
  }
}
