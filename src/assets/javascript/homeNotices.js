// One notice at a time on Home (report 2026-10-25): "I don't like having like
// three banners all stacked on top of each other." Every card the app can show
// in `.home-notices` is ranked here; Home renders only the first one that is
// due and not dismissed, and dismissing it lets the next one take its place.
//
// Each notice reports a SIGNATURE while it is due (null when it isn't): what
// it is currently about — the friend requests waiting, the fixes to read, the
// week's issue. The X hides a notice on this device until tomorrow, or until
// its signature changes, which is what "something new arrived" means. A
// numeric signature is a count, and only a BIGGER count is news: clearing one
// Showtimes film must not bring back a card you just put away.
//
// Pure: Home passes the clock (`promptNow`) and the dismissals in.

// Matt approved this order, 2026-10-25: a person waiting first, then a rating
// that can't be saved properly yet, then the app talking about itself, then
// news, and the movie homework last.
export const NOTICE_ORDER = [
  'friendRequest',
  'reconcile',
  'update',
  'bugFix',
  'showtimes',
  'newsletter',
  // The chores. Home's activeModalType names at most one of them at a time.
  'stickiness',
  'tieBreak',
  'awards'
];

export const CHORE_NOTICES = ['stickiness', 'tieBreak', 'awards'];

export const NOTICE_DISMISSALS_KEY = 'cinemaroll.dismissedNotices';

// The local calendar day, so "until tomorrow" means the user's midnight.
export function noticeDay (now) {
  const date = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const isDue = (signature) => signature !== null && signature !== undefined && signature !== false && signature !== '';

export function isNoticeDismissed (dismissals, id, signature, now) {
  const record = dismissals?.[id];
  if (!record || record.day !== noticeDay(now)) return false;
  if (typeof signature === 'number' && typeof record.signature === 'number') {
    return signature <= record.signature;
  }
  return record.signature === signature;
}

// The notice Home should show, or null.
export function pickNotice (signatures, dismissals, now) {
  return NOTICE_ORDER.find((id) => isDue(signatures?.[id]) && !isNoticeDismissed(dismissals, id, signatures[id], now)) ?? null;
}

// A new dismissals object (never mutated in place — Home keeps it reactive).
// Records from earlier days are dropped on the way, so the store never grows.
export function dismissNotice (dismissals, id, signature, now) {
  const today = noticeDay(now);
  const kept = Object.fromEntries(Object.entries(dismissals || {}).filter(([, record]) => record?.day === today));
  return { ...kept, [id]: { signature, day: today } };
}

// A chore notification tapped on the lock screen is an explicit "show me" —
// it overrides having put the chores away for the day.
export function clearChoreDismissals (dismissals) {
  return Object.fromEntries(Object.entries(dismissals || {}).filter(([id]) => !CHORE_NOTICES.includes(id)));
}

// Per-device, like the newsletter's "read" mark and friend-request snoozes.
// Wrapped: localStorage throws in a locked-down private window, and a notice
// must never be what takes Home down.
export function readNoticeDismissals () {
  try {
    const parsed = JSON.parse(localStorage.getItem(NOTICE_DISMISSALS_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeNoticeDismissals (dismissals) {
  try {
    localStorage.setItem(NOTICE_DISMISSALS_KEY, JSON.stringify(dismissals));
  } catch {
    // A device that can't remember it shows the card again. Harmless.
  }
}
