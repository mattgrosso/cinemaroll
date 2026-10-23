// When to remind Matt about a showing (2026-09-28: "remind me again one
// week before the showtime. And if it's already within one week, remind me
// again the day before"). A third rung, three hours before, covers a film
// swiped the day of; past that there is nothing left to aim at.
//
// The showing is the cinema's own clock ("2026-10-02T19:00:00", or a bare
// date for a board that only knows the day). It is read as LOCAL time -
// every theater here is in Matt's own zone - and a bare date means noon.
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
export const REMINDER_RUNGS = [
  { label: 'a week before', before: 7 * DAY },
  { label: 'the day before', before: DAY },
  { label: 'three hours before', before: 3 * HOUR }
];

export function showingEpoch (firstShowTime) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(firstShowTime || '');
  if (!m) return null;
  const [y, mo, d] = m.slice(1, 4).map(Number);
  const h = m[4] === undefined ? 12 : Number(m[4]);
  const min = m[5] === undefined ? 0 : Number(m[5]);
  return new Date(y, mo - 1, d, h, min).getTime();
}

// No date at all (AFI's grid, until the sweep learns it): "just snooze for a
// week, you can represent it then" (2026-09-28).
export const SNOOZE_MS = 7 * DAY;

// Swiped on the day of the first showing, with showings on later days too
// (2026-10-23: "if there are Showtimes that aren't today, we should just go
// ahead and hide it until the last Showtime. So give me a day or two's
// warning before the final Showtime and maybe say last chance").
export const LAST_CHANCE_RUNGS = [
  { label: 'two days before its last showing', before: 2 * DAY },
  { label: 'the day before its last showing', before: DAY }
];

const dayKey = (epoch) => {
  const d = new Date(epoch);
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
};

/**
 * -> { remindAt, label, lastChance? } for the first rung still ahead of now;
 * a week's snooze when the showing has no date; null only when every rung
 * has passed (the film plays within three hours and no later day is known).
 * A first showing today (or already gone) with a last showing on a later
 * day aims at that last showing instead, flagged lastChance.
 */
export function reminderTimeFor (firstShowTime, now = Date.now(), { lastShowTime = null } = {}) {
  const showing = showingEpoch(firstShowTime);
  if (!showing) return { remindAt: now + SNOOZE_MS, label: 'in a week' };
  const last = showingEpoch(lastShowTime);
  if (last && dayKey(showing) <= dayKey(now) && dayKey(last) > dayKey(now)) {
    for (const rung of LAST_CHANCE_RUNGS) {
      const remindAt = last - rung.before;
      if (remindAt > now) return { remindAt, label: rung.label, lastChance: true };
    }
  }
  for (const rung of REMINDER_RUNGS) {
    const remindAt = showing - rung.before;
    if (remindAt > now) return { remindAt, label: rung.label };
  }
  return null;
}
