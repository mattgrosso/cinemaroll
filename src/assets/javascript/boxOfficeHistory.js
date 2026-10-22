// Box Office History (Matt's rescue of the old Box Office Mojo, 2026-10-14):
// the numbers as they were reported at the time, with a source for every
// one. Pure helpers here; the network side is utils/boxOfficeHistoryRequest.js.
//
// Why this and not TMDB's `revenue`: TMDB has one worldwide lifetime number of
// unknown provenance. The archive has the domestic run weekend by weekend,
// the opening, the theater count, how long it held #1, and links back to the
// archived page each figure came from.
import { adjustGross, adjustForInflation, BASE_YEAR, WORDING, TICKET_PRICES } from './inflation.js';
import { formatMoneyShort } from './formatMoney.js';

// Switches to boxofficehistory.com once the domain lands.
export const HISTORY_ORIGIN = 'https://boxofficehistory.com';
export const ARCHIVE_API = `${HISTORY_ORIGIN}/api/v1`;

export const archiveMovieUrl = (id) => `${HISTORY_ORIGIN}/movie/${encodeURIComponent(id)}`;
export const archiveWeekendUrl = (key) => `${HISTORY_ORIGIN}/weekend/${encodeURIComponent(key)}`;

/** The 3-day weekends of a film's run, oldest first (4-day holiday versions dropped). */
export const threeDayWeekends = (film) => {
  const all = film?.weekends || [];
  return all
    .filter((w) => w.days === 3 || !all.some((o) => o.start === w.start && o.days === 3))
    .slice()
    .sort((a, b) => String(a.start).localeCompare(String(b.start)));
};

/**
 * The facts the Box office tile shows for a film the archive knows, or null
 * when the archive has nothing useful (no domestic total).
 */
export const archiveFacts = (film) => {
  if (!film || !(film.domestic > 0)) return null;
  const weekends = threeDayWeekends(film);
  const atOne = weekends.filter((w) => w.rank === 1).length;
  const inTopTen = weekends.filter((w) => w.rank && w.rank <= 10).length;
  const biggest = weekends.reduce((a, w) => (w.gross > (a?.gross ?? -1) ? w : a), null);
  const opening = film.opening?.gross ? film.opening : (weekends[0] || null);
  const year = film.year || (film.releaseDate ? Number(String(film.releaseDate).slice(0, 4)) : null);
  const todays = year ? grossTodayByRuns(film.domestic, year, film.runs, film.tickets) : null;
  const byRuns = (Array.isArray(film.runs) && film.runs.filter((r) => r?.gross > 0 && r.year).length > 1) || film.tickets > 0;
  return {
    id: film.id,
    title: film.title,
    year,
    domestic: film.domestic,
    domesticToday: todays && Math.round(todays) !== Math.round(film.domestic) ? todays : null,
    // True when the lifetime figure was restated release by release (a
    // re-issued film), so the label can say so.
    domesticTodayByRuns: byRuns,
    runs: Array.isArray(film.runs) && film.runs.length > 1 ? film.runs.map((r) => ({ year: r.year, gross: r.gross, title: r.title || null })) : null,
    tickets: film.tickets > 0 ? film.tickets : null,
    worldwide: film.worldwide || null,
    opening: opening ? { gross: opening.gross, theaters: opening.theaters ?? null, rank: opening.rank ?? null, average: opening.average ?? null, weekendKey: opening.weekendKey ?? null } : null,
    widest: film.widest || null,
    weekends: weekends.length,
    atOne,
    inTopTen,
    biggest: biggest && biggest !== weekends[0] ? { gross: biggest.gross, week: biggest.week ?? null } : null,
    days: film.inRelease?.days || null,
    url: archiveMovieUrl(film.id)
  };
};

/** "$535M domestic · opened #1, $158M" for the closed tile. */
export const archiveSummary = (facts) => {
  if (!facts) return '';
  const parts = [`${formatMoneyShort(facts.domestic)} domestic`];
  if (facts.opening?.gross) {
    const rank = facts.opening.rank ? `#${facts.opening.rank}, ` : '';
    parts.push(`opened ${rank}${formatMoneyShort(facts.opening.gross)}`);
  }
  if (facts.atOne > 1) parts.push(`${facts.atOne} weekends at #1`);
  return parts.join(' · ');
};

/**
 * Whether a viewing was in a theater, the only kind that gets a weekend's #1
 * (report, 2026-10-21: "only if I watched that movie in a theater"). Case
 * blind, in case an older entry spelled the medium differently.
 */
export const seenInTheater = (rating) => String(rating?.medium || '').trim().toLowerCase() === 'theater';

// A viewing on Monday to Thursday belongs to the weekend just gone: Sunday
// is at most four days back. Further back than that, the archive simply
// doesn't have the right weekend yet.
const MAX_DAYS_AFTER_WEEKEND = 4;
const DAY_MS = 24 * 60 * 60 * 1000;
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/**
 * The weekend chart a viewing date belongs to, from the archive's
 * calendar/<year>.json: the 3-day weekend whose Friday–Sunday holds the
 * date, else the weekend just gone (a Tuesday viewing belongs to the
 * Friday–Sunday before it). Null when that weekend isn't in the file — the
 * archive runs a few weeks behind, and an older weekend would be the wrong
 * answer (2026-10-21: an October viewing said September's #1).
 */
export const weekendForDate = (calendar, isoDate) => {
  const date = String(isoDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const list = (calendar?.weekends || []).slice().sort((a, b) => a.s.localeCompare(b.s));
  if (!list.length) return null;
  const within = list.find((w) => w.s <= date && date <= w.e);
  if (within) return within;
  const before = list.filter((w) => w.e < date);
  const last = before[before.length - 1];
  return last && daysBetween(last.e, date) <= MAX_DAYS_AFTER_WEEKEND ? last : null;
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthDay = (iso) => ({ month: MONTHS[Number(iso.slice(5, 7)) - 1], day: Number(iso.slice(8, 10)) });

/** "Oct 16–18", or "Sep 30–Oct 2" across a month end; '' without dates. */
export const weekendDates = (weekend) => {
  if (!/^\d{4}-\d{2}-\d{2}/.test(weekend?.s || '') || !/^\d{4}-\d{2}-\d{2}/.test(weekend?.e || '')) return '';
  const start = monthDay(weekend.s);
  const end = monthDay(weekend.e);
  return start.month === end.month ? `${start.month} ${start.day}–${end.day}` : `${start.month} ${start.day}–${end.month} ${end.day}`;
};

/** "#1 the weekend of Jul 3–5: Inside Out ($30M)" — the dates say which weekend. */
export const weekendLine = (weekend) => {
  if (!weekend?.top) return '';
  const gross = weekend.g ? ` (${formatMoneyShort(weekend.g)})` : '';
  const dates = weekendDates(weekend);
  return `#1 ${dates ? `the weekend of ${dates}` : 'that weekend'}: ${weekend.top}${gross}`;
};

/**
 * A lifetime gross in today's dollars, release by release: each run (the
 * original, re-issues, anniversaries) at its own year's ticket price, and
 * whatever the runs don't account for at the original year's. Without runs
 * it is the plain one-year adjustment.
 */
export const grossTodayByRuns = (domestic, year, runs, ticketsSold = null) => {
  // The old site's own tickets-sold estimate, where it made one, wins: it
  // splits re-issues the run data lumps together.
  if (ticketsSold > 0 && TICKET_PRICES[String(BASE_YEAR)]) return ticketsSold * TICKET_PRICES[String(BASE_YEAR)];
  const list = (runs || []).filter((r) => r?.gross > 0 && r.year);
  if (!list.length) return adjustGross(domestic, year);
  const accounted = list.reduce((s, r) => s + r.gross, 0);
  const remainder = Math.max(0, domestic - accounted);
  const parts = list.map((r) => adjustGross(r.gross, r.year));
  if (parts.some((v) => v === null)) return adjustGross(domestic, year);
  const rest = remainder > 0 ? adjustGross(remainder, year) : 0;
  return parts.reduce((s, v) => s + v, 0) + (rest ?? 0);
};

/**
 * The explanation, for anywhere the restated figure needs one. The same
 * words live in the archive's inflation.json (method.runs) and its About page.
 */
export const DOLLARS_EXPLANATION = {
  gross: 'A gross is tickets: divide by the average US ticket price of the year it was earned (tickets sold), multiply by today\'s price.',
  budget: 'A budget is not tickets: it is scaled by the Consumer Price Index.',
  runs: 'A film released more than once earned its money in different years at different ticket prices, so each release is restated separately: the original run at its year\'s price, each re-issue at its own, and anything the known runs don\'t account for at the original year\'s. For the 300 films on the old Box Office Mojo\'s adjusted chart, its own estimate of tickets sold is used instead.'
};

/** "in 2025 dollars, by average ticket price" — the shared wording for a gross. */
export const todaysDollarsLabel = (byRuns = false) => `in ${BASE_YEAR} dollars, ${WORDING.grossMethod}${byRuns ? ', release by release' : ''}`;
/** "in 2025 dollars, by CPI" — the shared wording for a budget. */
export const todaysBudgetLabel = () => `in ${BASE_YEAR} dollars, ${WORDING.budgetMethod}`;
/** A budget in today's dollars, by CPI (null when it can't be done honestly). */
export const budgetToday = (budget, year) => (budget > 0 && year ? adjustForInflation(budget, year) : null);
