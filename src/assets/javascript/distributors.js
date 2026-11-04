// Who RELEASED a film, as opposed to who made it.
//
// TMDB's production_companies names the makers only, so a company that just
// releases films is invisible to search. Matt, 2026-11-03: "a lot of movies
// that I see starting with Janus [Films] don't show up when I search for
// Janus." Janus restores and releases classics (Seven Samurai, The Seventh
// Seal, 8½); TMDB credits Toho, Svensk Filmindustri and Cineriz instead.
//
// Sources tried, measured against Matt's 1,500-film library that day:
//   - TMDB production_companies: 0 films with Janus.
//   - Wikidata P750 "distributed by": 12 films in ALL of Wikidata. Too thin.
//   - Janus's own catalogue (janusfilms.com/films/list, 1,195 films with year
//     and director, bundled by `yarn fetch-janus-films`): 47 library films.
// So the catalogue it is. No TMDB ids there, hence the matching below.
//
// Computed, never stored: a refreshed list reaches every film at once, with no
// backfill and no database writes. Pure and store-free; the index is built
// once, on first use.
//
// The names returned here join the STUDIO vocabulary everywhere search looks
// (buildSearchFields' companies, countStudios), so "Janus" finds them through
// the plain search, the studio chip, the typeahead and the (N) counts alike.
// Insights' studio stats deliberately stay on makers.

import janusFilms from '../data/janusFilms.json';
import { normalizeSearchText, looseSearchText } from './searchText.js';

export const JANUS_FILMS = 'Janus Films';

// Festival year vs release year: the two sources routinely disagree by one.
const YEAR_SLACK = 1;

const LEADING_ARTICLE = /^(a|an|the) /;

/**
 * The title as a matching key: normalized like every search string, leading
 * article dropped ("The Seventh Seal" / "Seventh Seal"), then every separator
 * removed ("8 1/2" vs "8½" aside, punctuation never decides a match).
 */
export function titleKey (title) {
  return looseSearchText(normalizeSearchText(title || '').replace(LEADING_ARTICLE, ''));
}

const surname = (name) => normalizeSearchText(name || '').split(' ').pop();

let janusIndex = null;
function index () {
  if (janusIndex) return janusIndex;
  janusIndex = new Map();
  janusFilms.forEach(([title, year, directors]) => {
    const key = titleKey(title);
    if (!key) return;
    if (!janusIndex.has(key)) janusIndex.set(key, []);
    janusIndex.get(key).push({ year, directors: (directors || []).map(surname) });
  });
  return janusIndex;
}

/**
 * Does a catalogue row describe this film? Title first (exact key), then
 * either the year within a year, or a shared director surname — the stored
 * crew says "Charles Chaplin" where Janus says "Charlie Chaplin", and an old
 * film's TMDB date is sometimes a re-release. A same-titled film from another
 * decade by someone else (a remake) matches neither.
 */
function rowMatches (row, year, directorSurnames) {
  if (row.year && year && Math.abs(row.year - year) <= YEAR_SLACK) return true;
  return row.directors.some((name) => directorSurnames.includes(name));
}

/** Is this film in Janus Films' catalogue? */
export function isJanusFilm (movie) {
  if (!movie?.title) return false;
  const keys = new Set([titleKey(movie.title), titleKey(movie.original_title)]);
  keys.delete('');
  const year = Number(String(movie.release_date || '').slice(0, 4)) || null;
  let directorSurnames = null;

  for (const key of keys) {
    const rows = index().get(key);
    if (!rows) continue;
    directorSurnames ??= (movie.crew || [])
      .filter((person) => person?.job === 'Director')
      .map((person) => surname(person.name));
    if (rows.some((row) => rowMatches(row, year, directorSurnames))) return true;
  }
  return false;
}

/**
 * Companies that released this film and aren't already among its makers.
 * Only Janus today; a second catalogue would join here.
 */
export function distributorsFor (movie) {
  if (!isJanusFilm(movie)) return [];
  const makers = (movie.production_companies || []).map((company) => normalizeSearchText(company?.name));
  return makers.includes(normalizeSearchText(JANUS_FILMS)) ? [] : [JANUS_FILMS];
}

/** Makers then releasers: every studio name search should know for a film. */
export function studioNamesFor (movie) {
  const makers = (movie?.production_companies || []).map((company) => company?.name).filter(Boolean);
  return [...makers, ...distributorsFor(movie)];
}
