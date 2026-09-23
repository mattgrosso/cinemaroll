import uniq from 'lodash/uniq';
import { placeNames } from './places.js';
import { memoByIdentity } from '../../utils/memoByIdentity.js';

// Pure counting logic shared by Home.vue's "add filter" dropdown counts and
// MovieDetail.vue's parenthetical (N) badges next to cast/director/genre/
// keyword/company names — previously hand-duplicated, byte-for-byte, in both
// files (a bug report questioning the badges' accuracy surfaced two real
// bugs in that duplicated logic; see CLAUDE.md).
//
// Every function takes the already-flatKeywords-added entries array plus
// whether short films should be counted, so callers control both inputs
// explicitly rather than reading from a store.

function isShort (movie) {
  return Boolean(movie?.runtime && movie.runtime <= 40);
}

function eligibleEntries (entries, includeShorts) {
  return includeShorts ? entries : entries.filter((result) => !isShort(result.movie));
}

function incrementEach (counts, names) {
  uniq(names.filter(Boolean)).forEach((name) => {
    counts[name] = (counts[name] || 0) + 1;
  });
}

// Job titles counted into the shared cast/crew bucket alongside cast —
// matches every crew role MovieDetail actually renders a badge for
// (Writer/Composer/Editor/Cinematographer/Producer, via getCrewMember's own
// substring matching). Director is deliberately excluded: it already has
// its own dedicated countDirectors map below, so including it here too
// would just be redundant work, not a correctness fix.
const COUNTED_CREW_JOB_SUBSTRINGS = ['Writer', 'Composer', 'Editor', 'Photo', 'Producer'];

// Bug fixed here: the old logic used `crew.find(...)`, crediting only
// whichever director TMDB happened to list FIRST for a co-directed movie —
// every other credited co-director silently undercounted. `.filter(...)`
// credits all of them.
function countDirectorsUncached (entries, includeShorts) {
  const counts = {};
  eligibleEntries(entries, includeShorts).forEach((result) => {
    const crew = result.movie.crew;
    const directors = Array.isArray(crew)
      ? crew.filter((person) => person.job === 'Director').map((person) => person.name)
      : [];
    incrementEach(counts, directors);
  });
  return counts;
}

// Bug fixed here: the old logic capped cast AND crew to the first 10 array
// POSITIONS regardless of job, so a composer/editor/cinematographer (or a
// cast member) billed past position 10 in a given movie's TMDB list simply
// never counted for that movie — a per-movie coin flip that produced
// exactly the "sometimes right, sometimes not" pattern reported. Cast is now
// counted in full (matching the "Cast" section, which already renders the
// full list); crew is filtered by JOB instead of array position, matching
// what getCrewMember actually surfaces, while still avoiding counting every
// background department credit TMDB lists (grips, sound mixers, etc.) that
// no template section ever displays a badge for.
function countCastCrewUncached (entries, includeShorts) {
  const counts = {};
  eligibleEntries(entries, includeShorts).forEach((result) => {
    const cast = Array.isArray(result.movie.cast) ? result.movie.cast.map((person) => person.name) : [];
    const crew = Array.isArray(result.movie.crew)
      ? result.movie.crew
        .filter((person) => COUNTED_CREW_JOB_SUBSTRINGS.some((role) => person.job?.includes(role)))
        .map((person) => person.name)
      : [];
    incrementEach(counts, [...cast, ...crew]);
  });
  return counts;
}

function countGenresUncached (entries, includeShorts) {
  const counts = {};
  eligibleEntries(entries, includeShorts).forEach((result) => {
    const genres = result.movie.genres;
    if (Array.isArray(genres)) incrementEach(counts, genres.map((genre) => genre.name));
  });
  return counts;
}

function countKeywordsUncached (entries, includeShorts) {
  const counts = {};
  eligibleEntries(entries, includeShorts).forEach((result) => {
    const keywords = result.movie.flatKeywords;
    if (Array.isArray(keywords)) incrementEach(counts, keywords);
  });
  return counts;
}

function countStudiosUncached (entries, includeShorts) {
  const counts = {};
  eligibleEntries(entries, includeShorts).forEach((result) => {
    const companies = (result.movie.production_companies || []).map((company) => company.name);
    incrementEach(counts, companies);
  });
  return counts;
}

// Places (Wikidata filming + narrative locations, see places.js): one count
// per movie per place, whichever type it was.
function countPlacesUncached (entries, includeShorts) {
  const counts = {};
  eligibleEntries(entries, includeShorts).forEach((result) => {
    incrementEach(counts, placeNames(result.movie));
  });
  return counts;
}

// Each table is a pure function of (library entries, include shorts) and is
// asked for by Home on every mount: cached by identity, so a return to Home
// with an unchanged library costs nothing here. See memoByIdentity.js.
export const countDirectors = memoByIdentity(countDirectorsUncached);
export const countCastCrew = memoByIdentity(countCastCrewUncached);
export const countGenres = memoByIdentity(countGenresUncached);
export const countKeywords = memoByIdentity(countKeywordsUncached);
export const countStudios = memoByIdentity(countStudiosUncached);
export const countPlaces = memoByIdentity(countPlacesUncached);

