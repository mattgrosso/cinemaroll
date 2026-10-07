// GENERATED from src/assets/javascript — edit the ESM source and run scripts/sync-lambda-twins.mjs.
// CinemaScore on the movie page (Matt, 2026-10-06: "on the movie details
// screen as a review, essentially, not as a guide for what I might want to
// go watch"). CinemaScore is an opening-night exit poll: ballot cards handed
// out in a handful of theaters, a letter grade from A+ to F, published the
// next morning. Only wide releases get polled, so most films have no grade.
//
// This file is the pure half — the title encoding their search expects, the
// choosing of one result, the wording. The request lives in
// utils/cinemaScoreRequest.js.

const CINEMASCORE_SITE = 'https://www.cinemascore.com/';
const SEARCH_URL = 'https://webapp.cinemascore.com/guest/search/title/';

/** The site's own search base64-encodes the typed title into the URL. */
function cinemaScoreSearchUrl (title) {
  const bytes = new TextEncoder().encode(String(title || ''));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return SEARCH_URL + btoa(binary);
}

/**
 * Titles compare by letters and digits only, upper-cased, with a trailing
 * "(2021)" dropped: their list has "DUNE (2021)" and "DUNE: PART TWO", TMDB
 * has "Dune" and "Dune: Part Two".
 */
function normalizeTitle (title) {
  return String(title || '')
    .replace(/\s*\((?:19|20)\d{2}\)\s*$/, '')
    .toUpperCase()
    .replace(/&/g, 'AND')
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * One grade for this film, or null. Their search is a substring match, so
 * "Dune" also returns "Dune: Part Two": only an exact (normalized) title
 * counts, and among those the one whose year matches the release — a year
 * either way covers a December release polled in January. Never a guess.
 */
function pickCinemaScore (results, { title, year } = {}) {
  if (!Array.isArray(results) || !results.length) return null;
  const wanted = normalizeTitle(title);
  if (!wanted) return null;
  const sameTitle = results
    .map((entry) => ({
      title: String(entry?.TITLE || '').trim(),
      grade: String(entry?.GRADE || '').trim(),
      year: Number(entry?.YEAR) || null
    }))
    .filter((entry) => entry.grade && normalizeTitle(entry.title) === wanted);
  if (!sameTitle.length) return null;
  const releaseYear = Number(year) || null;
  if (!releaseYear) return sameTitle.length === 1 ? sameTitle[0] : null;
  const exact = sameTitle.find((entry) => entry.year === releaseYear);
  if (exact) return exact;
  const near = sameTitle.filter((entry) => entry.year && Math.abs(entry.year - releaseYear) <= 1);
  return near.length === 1 ? near[0] : null;
}

/**
 * What the grade means, in a line. The scale is inflated — opening-night
 * crowds chose to be there — so a B is lukewarm and anything below C+ is a
 * flop with the people who most wanted to see it.
 */
function cinemaScoreReading (grade) {
  switch (String(grade || '').toUpperCase()) {
    case 'A+': return 'The rarest grade: opening-night audiences loved it outright.';
    case 'A': return 'Opening-night audiences loved it.';
    case 'A-': return 'Opening-night audiences liked it a lot.';
    case 'B+': return 'Liked, not loved, by the crowd that chose to be there.';
    case 'B': return 'Lukewarm from the people who most wanted to see it.';
    case 'B-': return 'The opening-night crowd left unconvinced.';
    case 'C+':
    case 'C':
    case 'C-': return 'The fans who turned up were let down.';
    case 'D+':
    case 'D':
    case 'D-': return 'Opening-night audiences disliked it.';
    case 'F': return 'The grade that almost never happens: the opening-night crowd hated it.';
    default: return '';
  }
}

module.exports = { cinemaScoreSearchUrl, normalizeTitle, pickCinemaScore, cinemaScoreReading, CINEMASCORE_SITE };
