// The history behind Insights' Activity counts. Bug report (Matt,
// 2026-09-25): "we show how many movies this month and how many movies last
// month and this week and last week — we should make those all tappable so
// I could click on, for instance, the month one and see a month by month
// breakdown going backwards." Tapping a tile opens one of these lists.
//
// Store-free on purpose (the yearInReview.js precedent): viewing dates come
// in as an array, `now` is injectable so tests don't depend on the clock.
// Every period runs from the current one back to the first viewing, newest
// first, zero-count periods included — a gap is part of the answer.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const LONG_MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const startOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const validDates = (dates) => (dates || [])
  .map((d) => (d instanceof Date ? d : new Date(d)))
  .filter((d) => Number.isFinite(d.getTime()));

// Month by month, e.g. { key: '2026-9', label: 'September 2026', count }.
export function monthlyBreakdown (dates, now = new Date()) {
  const valid = validDates(dates);
  if (!valid.length) return [];
  const counts = new Map();
  let earliest = now;
  for (const d of valid) {
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    counts.set(key, (counts.get(key) || 0) + 1);
    if (d < earliest) earliest = d;
  }
  const rows = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);
  const stop = new Date(earliest.getFullYear(), earliest.getMonth(), 1);
  while (cursor >= stop) {
    const key = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    rows.push({ key, label: `${LONG_MONTHS[cursor.getMonth()]} ${cursor.getFullYear()}`, count: counts.get(key) || 0 });
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return rows;
}

// Rolling seven-day windows ending today — the same window the "This Week"
// tile counts (today and the six days before it), then the seven before
// that, and so on.
export function weeklyBreakdown (dates, now = new Date()) {
  const valid = validDates(dates);
  if (!valid.length) return [];
  const today = startOfDay(now);
  const counts = new Map();
  let maxIndex = 0;
  for (const d of valid) {
    const daysAgo = Math.round((today - startOfDay(d)) / 86400000);
    if (daysAgo < 0) continue;
    const index = Math.floor(daysAgo / 7);
    counts.set(index, (counts.get(index) || 0) + 1);
    if (index > maxIndex) maxIndex = index;
  }
  const rows = [];
  for (let index = 0; index <= maxIndex; index++) {
    const end = new Date(today);
    end.setDate(end.getDate() - index * 7);
    const start = new Date(end);
    start.setDate(start.getDate() - 6);
    const fmt = (d) => `${MONTHS[d.getMonth()]} ${d.getDate()}`;
    const year = start.getFullYear() !== today.getFullYear() ? `, ${start.getFullYear()}` : '';
    rows.push({ key: `w${index}`, label: `${fmt(start)} – ${fmt(end)}${year}`, count: counts.get(index) || 0 });
  }
  return rows;
}

// Year by year, each with how many had been watched by today's date in that
// year — the pair the "Last Year to Same Date" and "Last Year Total" tiles
// show, extended backwards.
export function yearlyBreakdown (dates, now = new Date()) {
  const valid = validDates(dates);
  if (!valid.length) return [];
  const totals = new Map();
  const toDate = new Map();
  let earliestYear = now.getFullYear();
  for (const d of valid) {
    const year = d.getFullYear();
    totals.set(year, (totals.get(year) || 0) + 1);
    const cutoff = new Date(year, now.getMonth(), now.getDate(), 23, 59, 59, 999);
    if (d <= cutoff) toDate.set(year, (toDate.get(year) || 0) + 1);
    if (year < earliestYear) earliestYear = year;
  }
  const rows = [];
  for (let year = now.getFullYear(); year >= earliestYear; year--) {
    rows.push({ key: `y${year}`, label: String(year), count: totals.get(year) || 0, toDate: toDate.get(year) || 0 });
  }
  return rows;
}
