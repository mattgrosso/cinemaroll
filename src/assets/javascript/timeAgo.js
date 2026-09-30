// "3 hours ago", "2 days ago", then a plain date once that stops being
// useful — for the Film Club feeds, where the question is "how fresh is
// this?" (Matt, 2026-08-16: "it'll be nice if in that feed, there was some
// indication of when the person watched it... a certain number of hours ago,
// days ago, and then after it goes past the good number of days, it should
// just give the date").
//
// Deliberately not MovieDetail's `formatTimeDifference`, whose months branch
// runs to 730 days and answers a different question ("how long between
// viewings"). Here anything past a fortnight is better read as a date.

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const DATE_AFTER_DAYS = 14;

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'} ago`;

// The Film Club feed fits stars and "when" on one line under a 116px poster
// (2026-09-27, "I wish we could get this all fit on two lines consistently"),
// so it asks for "45m" / "3h" / "5d" and a past year's date as "9/4/25".
const SHORT_UNITS = { minute: 'm', hour: 'h', day: 'd' };

/**
 * `timestamp` is epoch milliseconds. Returns null for anything unusable, so
 * callers render nothing rather than "Invalid Date" or "56 years ago".
 * `{ short: true }` gives the compact form ("3h", "5d") for tight spaces.
 * `{ dayOnly: true }` is for a friend's end-of-day copy (2026-09-30), whose
 * times are noon UTC of the day they watched: counted in calendar days,
 * never hours, so the time of day can't be read back out.
 */
export function timeAgo (timestamp, now = Date.now(), { short = false, dayOnly = false } = {}) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;

  const ago = (count, noun) => (short ? `${count}${SHORT_UNITS[noun]}` : plural(count, noun));

  if (dayOnly) {
    const watched = new Date(timestamp);
    const today = new Date(now);
    const days = Math.max(0, Math.round((
      Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) -
      Date.UTC(watched.getUTCFullYear(), watched.getUTCMonth(), watched.getUTCDate())
    ) / DAY));
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < DATE_AFTER_DAYS) return ago(days, 'day');
    return dateLabel(timestamp, now, short, 'UTC');
  }

  const elapsed = now - timestamp;

  // A clock skewed a little ahead shouldn't read as a negative age.
  if (elapsed < MINUTE) return short ? 'now' : 'just now';
  if (elapsed < HOUR) return ago(Math.floor(elapsed / MINUTE), 'minute');
  if (elapsed < DAY) return ago(Math.floor(elapsed / HOUR), 'hour');

  const days = Math.floor(elapsed / DAY);
  if (days === 1) return 'yesterday';
  if (days < DATE_AFTER_DAYS) return ago(days, 'day');

  return dateLabel(timestamp, now, short);
}

function dateLabel (timestamp, now, short, timeZone = undefined) {
  const date = new Date(timestamp);
  const year = timeZone === 'UTC' ? date.getUTCFullYear() : date.getFullYear();
  const sameYear = year === new Date(now).getFullYear();

  if (sameYear) return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone });

  return date.toLocaleDateString('en-US', short
    ? { month: 'numeric', day: 'numeric', year: '2-digit', timeZone }
    : { month: 'short', day: 'numeric', year: 'numeric', timeZone });
}
