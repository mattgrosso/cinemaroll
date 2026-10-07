import otherAwardsWinners from '../data/otherAwardsWinners.json';

// Static dataset of major-ceremony wins/nominations (Golden Globes, BAFTA,
// Cannes, Venice — see CLAUDE.md's "Other Ceremonies" section for how it was
// built and its known limitations). Each entry is { ceremony, category,
// year, title, isWinner }. There's no TMDB id in the source data (it was
// scraped from Wikipedia list pages, not TMDB), so matching against the
// user's library happens by normalized title + release year instead — see
// findOtherAwardsForMovie below.
//
// Index by normalized title once at module load, not per-movie-page-visit.
const normalizeTitle = (title) => {
  return (title || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
};

const INDEX = new Map();
const BY_TMDB = new Map();
otherAwardsWinners.forEach((entry) => {
  if (entry.tmdb) {
    if (!BY_TMDB.has(entry.tmdb)) BY_TMDB.set(entry.tmdb, []);
    BY_TMDB.get(entry.tmdb).push(entry);
  }
  const key = normalizeTitle(entry.title);
  if (!INDEX.has(key)) {
    INDEX.set(key, []);
  }
  INDEX.get(key).push(entry);
});

// Ceremony year conventions don't always line up 1:1 with a film's TMDB
// release year (international rollouts, year-of-eligibility vs year-of-
// ceremony labeling quirks across sources) — allow a 1-year slop either way.
const YEAR_TOLERANCE = 1;

// The Golden Globes have run every year since their 1943 debut with no gaps,
// so the ordinal ("Nth Golden Globe Awards" — Wikipedia's actual article
// naming convention) is a reliable straight-line formula from the film year.
// BAFTA/Cannes/Venice all had historical irregularities (wartime pauses,
// combined-year ceremonies) that make a similar formula unreliable, so for
// those we fall back to a "<year> <ceremony>" query — not always the exact
// article title, but goToWikipedia() routes it through Wikipedia's search
// ("go to page, else show results") rather than a raw page URL, so a
// near-miss still lands somewhere useful instead of a dead link.
const GOLDEN_GLOBES_FIRST_CEREMONY_YEAR = 1943;

function ordinal (n) {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1: return `${n}st`;
    case 2: return `${n}nd`;
    case 3: return `${n}rd`;
    default: return `${n}th`;
  }
}

function buildWikipediaQuery (ceremony, year) {
  if (!year) return ceremony;
  if (ceremony === 'Golden Globe Awards') {
    const ceremonyNumber = year - GOLDEN_GLOBES_FIRST_CEREMONY_YEAR + 1;
    return `${ordinal(ceremonyNumber)} Golden Globe Awards`;
  }
  return `${year} ${ceremony}`;
}

export function findOtherAwardsForMovie (movie) {
  const empty = { wins: [], nominations: [] };
  if (!movie || !movie.title) return empty;

  const releaseYear = movie.release_date ? new Date(movie.release_date).getFullYear() : null;
  // Rows resolved to a TMDB id (scripts/enrich-other-awards.mjs) match on it
  // outright; the rest still go by title and year.
  const byId = movie.id != null ? (BY_TMDB.get(Number(movie.id)) || []) : [];
  const candidates = byId.length ? byId : (INDEX.get(normalizeTitle(movie.title)) || []);
  const matches = releaseYear && !byId.length
    ? candidates.filter((entry) => Math.abs(entry.year - releaseYear) <= YEAR_TOLERANCE)
    : candidates;

  const wins = [];
  const nominations = [];

  matches.forEach((entry, index) => {
    const record = {
      id: `${entry.ceremony}-${entry.category}-${entry.year}-${index}`,
      ceremony: entry.ceremony,
      category: entry.category,
      year: entry.year,
      wikipediaQuery: buildWikipediaQuery(entry.ceremony, entry.year),
    };
    if (entry.isWinner) {
      wins.push(record);
    } else {
      nominations.push(record);
    }
  });

  return { wins, nominations };
}
