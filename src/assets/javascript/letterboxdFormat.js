// Letterboxd data, the client side (2026-09-29). Pure and store-free: how the
// synced reviews and film stats are shaped for a screen, and how a Letterboxd
// CSV export becomes the same review records the Lambda's RSS sync writes.
//
// The RSS feed carries only the latest ~50 diary entries, so the history
// arrives once through Letterboxd's own export (Settings → Import & Export →
// Export your data → reviews.csv), matched to the library by title and year
// because the CSV carries no TMDB id.

export const FILM_STALE_MS = 30 * 24 * 60 * 60 * 1000;

// 3.5 -> "★★★½". Letterboxd's own vocabulary; null for "not rated".
export const starsFor = (rating) => {
  const value = Number(rating);
  if (!Number.isFinite(value) || value <= 0) return null;
  const whole = Math.floor(value);
  const half = value - whole >= 0.5;
  return '★'.repeat(whole) + (half ? '½' : '');
};

// 1307901 -> "1.3M", 61000 -> "61K", 842 -> "842".
export const compactCount = (count) => {
  if (count === null || count === undefined || count === '') return null;
  const value = Number(count);
  if (!Number.isFinite(value) || value < 0) return null;
  if (value >= 1e6) return `${(value / 1e6).toFixed(value >= 1e7 ? 0 : 1).replace(/\.0$/, '')}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(value >= 1e4 ? 0 : 1).replace(/\.0$/, '')}K`;
  return String(Math.round(value));
};

// The reviews node for one film -> newest viewing first. The same viewing can
// arrive twice — once from the feed (review-<id>) and once from the CSV
// (csv-<code>) — so entries with the same watched date and the same text
// collapse to one, preferring the feed's copy (it carries the URL). "Same
// text" ignores whitespace: the CSV keeps a trailing space on each paragraph
// that the feed trims, which showed every review twice (2026-09-29). A plain
// watch (no text) on the same day as a review is the same viewing too.
const textKey = (review) => String(review || '').replace(/\s+/g, ' ').trim();

export const reviewsFromNode = (node) => {
  const entries = Object.entries(node || {})
    .filter(([, value]) => value && typeof value === 'object')
    .map(([id, value]) => ({ id, ...value }));
  const seen = new Map();
  for (const entry of entries) {
    const key = `${entry.watchedDate || ''}|${textKey(entry.review)}`;
    const existing = seen.get(key);
    if (!existing || (existing.source === 'csv' && entry.source !== 'csv')) seen.set(key, entry);
  }
  const kept = [...seen.values()];
  const datesWithText = new Set(kept.filter((entry) => textKey(entry.review)).map((entry) => entry.watchedDate));
  return kept.filter((entry) => textKey(entry.review) || !entry.watchedDate || !datesWithText.has(entry.watchedDate)).sort((a, b) => {
    const dateA = a.watchedDate || '';
    const dateB = b.watchedDate || '';
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return (b.publishedAt || 0) - (a.publishedAt || 0);
  });
};

// RFC 4180: quoted fields, doubled quotes, newlines inside quotes (every
// review of more than a paragraph has them), CRLF or LF. Returns an array of
// objects keyed by the header row.
export const parseCsv = (text) => {
  const source = String(text || '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; } else { quoted = false; }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field); field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const [header, ...body] = rows.filter((cells) => cells.some((cell) => cell !== ''));
  if (!header) return [];
  const keys = header.map((cell) => cell.trim());
  return body.map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index] ?? ''])));
};

// Title matching: case, punctuation, accents and articles' spacing all vary
// between Letterboxd and TMDB; digits and letters rarely do.
export const normalizeTitle = (title) => String(title || '')
  .normalize('NFD')
  .replace(/[̀-ͯ]/g, '')
  .toLowerCase()
  .replace(/&/g, 'and')
  .replace(/[^a-z0-9]+/g, '');

const releaseYear = (entry) => {
  const year = Number(String(entry?.movie?.release_date || '').slice(0, 4));
  return Number.isInteger(year) ? year : null;
};

// A lookup from "normalizedtitle|year" to the TMDB id. A film whose TMDB and
// Letterboxd years differ by one (festival premieres) still matches through
// the neighbouring years, exact year winning.
export const buildTitleIndex = (entries) => {
  const index = new Map();
  for (const entry of entries || []) {
    const tmdbId = Number(entry?.movie?.id);
    const year = releaseYear(entry);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !year) continue;
    const title = normalizeTitle(entry.movie.title);
    if (!title) continue;
    if (!index.has(`${title}|${year}`)) index.set(`${title}|${year}`, tmdbId);
  }
  return index;
};

export const matchTitle = (index, title, year) => {
  const key = normalizeTitle(title);
  const wanted = Number(year);
  if (!key || !Number.isInteger(wanted)) return null;
  return index.get(`${key}|${wanted}`) ?? index.get(`${key}|${wanted - 1}`) ?? index.get(`${key}|${wanted + 1}`) ?? null;
};

const reviewIdFromUri = (uri, fallback) => {
  const match = /boxd\.it\/([A-Za-z0-9]+)/.exec(String(uri || ''));
  return `csv-${match ? match[1] : fallback}`;
};

// Letterboxd's reviews.csv (and diary.csv, which has the same columns minus
// Review) -> the multi-path update for `<topKey>/letterboxd/reviews`, plus
// what didn't match so the screen can say so.
export const reviewsCsvToUpdates = (rows, entries, now = Date.now()) => {
  const index = buildTitleIndex(entries);
  const updates = {};
  const unmatched = [];
  let matched = 0;
  rows.forEach((row, position) => {
    const title = row.Name || row.Title || '';
    const year = Number(row.Year);
    if (!title) return;
    const tmdbId = matchTitle(index, title, year);
    if (!tmdbId) { unmatched.push({ title, year: Number.isInteger(year) ? year : null }); return; }
    const rating = Number(row.Rating);
    const review = String(row.Review || '').replace(/\r\n/g, '\n').split('\n').map((line) => line.trimEnd()).join('\n').trim();
    const value = {
      source: 'csv',
      kind: review ? 'review' : 'watch',
      title,
      year: Number.isInteger(year) ? year : null,
      rating: Number.isFinite(rating) && rating > 0 ? rating : null,
      watchedDate: row['Watched Date'] || row.Date || null,
      rewatch: /^yes$/i.test(row.Rewatch || '') || null,
      review: review || null,
      tags: row.Tags ? row.Tags : null,
      url: /^https?:\/\//.test(row['Letterboxd URI'] || '') ? row['Letterboxd URI'] : null,
      publishedAt: row.Date ? Date.parse(`${row.Date}T12:00:00`) || null : null,
      syncedAt: now
    };
    for (const key of Object.keys(value)) if (value[key] === null || value[key] === undefined) delete value[key];
    updates[`${tmdbId}/${reviewIdFromUri(row['Letterboxd URI'], `row${position}`)}`] = value;
    matched += 1;
  });
  return { updates, matched, unmatched };
};

// "Synced 3 hours ago" for the Settings line.
export const relativeTimeFrom = (then, now = Date.now()) => {
  const diff = Math.max(0, now - Number(then));
  const minutes = Math.round(diff / 60000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
};
