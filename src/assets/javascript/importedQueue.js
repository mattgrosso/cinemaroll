// Rate the imported films properly, one after another (2026-11-14, Matt:
// "there should be a way that if somebody doesn't wanna deal with it, they
// don't have to be bothered"). A Letterboxd import scores every film at its
// stars doubled, every category the same; the film page's "Rate it properly"
// fixes one at a time, but nothing walked anyone through a library of them.
//
// Home's "Rate properly" card counts what's left and opens the next one; the
// Rate page offers the one after. It is NEVER on the icon badge and never in
// a push: it isn't a chore (CHORE_NOTICES), so neither appBadge.js nor the
// push digest know about it. "Stop asking" writes `settings/importedReminders`
// = false for every device; Settings turns it back on.
//
// Pure: Home and RateMovie pass the library and settings in.
import { importedViewingIndex } from './letterboxdImport.js';

export const IMPORTED_REMINDERS_PATH = 'settings/importedReminders';

/** Off only when explicitly turned off: absent means on. */
export const importRemindersOn = (settings) => settings?.importedReminders !== false;

/**
 * One row per film that still has an imported viewing (its newest), in the
 * order the card serves them: best-loved first (the Letterboxd stars, films
 * brought in with none last), then most recently watched.
 */
export const importedViewings = (movieLog) => {
  const rows = [];
  for (const [dbKey, entry] of Object.entries(movieLog || {})) {
    const ratings = entry?.ratings;
    if (!Array.isArray(ratings) || !ratings.length) continue;
    const index = importedViewingIndex(ratings);
    if (index < 0) continue;
    const rating = ratings[index];
    const stars = Number(rating.letterboxdStars);
    rows.push({
      dbKey,
      index,
      stars: !rating.letterboxdUnrated && Number.isFinite(stars) ? stars : null,
      date: Number(rating.date) || 0
    });
  }
  return rows.sort((a, b) => {
    if (a.stars !== b.stars) {
      if (a.stars === null) return 1;
      if (b.stars === null) return -1;
      return b.stars - a.stars;
    }
    if (a.date !== b.date) return b.date - a.date;
    return a.dbKey < b.dbKey ? -1 : a.dbKey > b.dbKey ? 1 : 0;
  });
};

export const nextImportedViewing = (movieLog) => importedViewings(movieLog)[0] ?? null;

/** Home's signature for the card: how many are left, or null when it isn't due. */
export const importedNoticeSignature = (count, settings) =>
  (count > 0 && importRemindersOn(settings) ? count : null);

export const importedNoticeText = (count) =>
  `${count.toLocaleString()} film${count === 1 ? '' : 's'} still carr${count === 1 ? 'ies' : 'y'} only ${count === 1 ? 'its' : 'their'} Letterboxd stars.`;
