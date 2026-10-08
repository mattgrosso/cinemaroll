// Look someone up and get their whole filmography.
//
// Bug report, 2026-09-01: "It'll be nice if on watchlist I could type into
// the input a person like a director or an actor and get the full list their
// entire filmography that would be really great cause then I could go through
// and add them all to hat easily."
//
// This is deliberately NOT the discover.js treatment. Every other list on the
// watchlist screen is a RECOMMENDATION: rankWatchlistCandidates drops anything
// already rated, filters cast credits to `order < 10`, keeps directors only,
// and sorts by a quality score. That is the wrong shape here — "their entire
// filmography" means the whole list, in the order a filmography reads (newest
// first), including the ones already seen. The films already in the library
// are marked rather than removed, because knowing you've seen nine of the
// twelve is the useful part when you're deciding what to hat.

import { isShort } from './shorts.js';

// Crew jobs that count as authorship. A person's full crew credit list also
// carries producer, executive producer, thanks, and second-unit work, which
// for anyone established runs to hundreds of entries and buries the films
// they're actually known for. These four are what "a film by" means.
const AUTHOR_JOBS = ['Director', 'Writer', 'Screenplay', 'Story'];

// TMDB's genre id for Documentary.
const DOCUMENTARY = 99;

/**
 * Is this cast credit the person turning up as themselves rather than acting?
 *
 * Bug report, 2026-10-08, searching Ruben Östlund: "I get a bunch of like
 * making of docs and things like that in there." Every one of his twelve cast
 * credits was a documentary — festival films, tributes to other directors,
 * a making-of — with the character "Self", "Self - Filmmaker", or blank.
 * TMDB marks none of them any other way (`video` was false on all twelve), so
 * the character is the signal. A blank character only counts on a
 * documentary: actors' small fiction parts are often blank too, and those
 * are real films.
 */
export function isAppearance (credit) {
  const character = String(credit?.character ?? '').trim();
  if (/^(self|him ?self|her ?self|them ?sel(f|ves))\b/i.test(character)) return true;
  if (/archive footage/i.test(character)) return true;
  return character === '' && (credit?.genre_ids || []).includes(DOCUMENTARY);
}

/**
 * TMDB /search/person results, trimmed to what a chooser needs.
 *
 * The chooser exists because names collide and the app can't guess: TMDB's
 * first result for "Michael Jordan" is not Michael B. Jordan. `knownFor` is
 * the tiebreaker that actually resolves it — two people with the same name
 * and the same department are told apart by their films, not by their id.
 */
export function personCandidates (results, limit = 6) {
  return (results || [])
    .filter((person) => person && person.id != null && person.name)
    .slice(0, limit)
    .map((person) => ({
      id: person.id,
      name: person.name,
      department: person.known_for_department || null,
      profilePath: person.profile_path || null,
      knownFor: (person.known_for || [])
        .map((credit) => credit?.title || credit?.name)
        .filter(Boolean)
        .slice(0, 3)
    }));
}

/** "You: 8.50" where a score is known, "Rated" where it isn't. */
function seenLabel (id, scoreFor) {
  const score = scoreFor ? scoreFor(id) : null;
  return score ? `You: ${score}` : 'Rated';
}

/** The year a credit belongs to, or null for anything undated. */
function yearOf (credit) {
  const year = new Date(credit?.release_date ?? NaN).getFullYear();
  return Number.isFinite(year) ? year : null;
}

/**
 * One person's filmography from TMDB's /person/{id}/movie_credits.
 *
 * Returns `[{ id, title, poster_path, release_date, year, roles, extra, note }]`,
 * newest first. `roles` merges the cast and crew sides — someone who directed
 * and starred in the same film gets one card saying so, not two cards.
 *
 * Undated credits are dropped. TMDB lists announced and in-development
 * projects with no release date and no poster, and they can't be watched, so
 * they're noise in a list whose purpose is filling a hat.
 *
 * @param credits   the /movie_credits payload ({ cast, crew })
 * @param ratedIds  TMDB ids already in the user's library
 * @param scoreFor  optional id -> formatted score, for the "seen it" note
 */
export function filmographyFrom (credits, { ratedIds = new Set(), scoreFor = null } = {}) {
  const byId = new Map();

  // `extra` marks a credit that isn't really one of their films: an
  // appearance as themselves, or anything TMDB flags as a video (music
  // videos, featurettes). A film is an extra only if every credit on it is —
  // a documentary they directed AND appear in is still their film.
  const add = (credit, role, extra) => {
    if (!credit || credit.id == null || !role) return;
    const year = yearOf(credit);
    if (year === null) return;

    const existing = byId.get(credit.id);
    if (existing) {
      // Same film, second credit: keep the roles, not a duplicate card.
      if (!existing.roles.includes(role)) existing.roles.push(role);
      if (!extra) existing.extra = false;
      return;
    }
    byId.set(credit.id, {
      id: credit.id,
      title: credit.title || credit.name || '',
      poster_path: credit.poster_path || null,
      release_date: credit.release_date,
      year,
      roles: [role],
      rated: ratedIds.has(credit.id),
      extra
    });
  };

  // Cast first, so an actor-director's card leads with the acting role when
  // both apply — matching how the credit is usually spoken.
  (credits?.cast || []).forEach((credit) => {
    if (isAppearance(credit)) add(credit, 'Appearance', true);
    else add(credit, 'Actor', Boolean(credit?.video));
  });
  (credits?.crew || []).forEach((credit) => {
    if (AUTHOR_JOBS.includes(credit?.job)) add(credit, credit.job, Boolean(credit.video));
  });

  return [...byId.values()]
    .sort((a, b) => (b.year - a.year) || a.title.localeCompare(b.title))
    .map((film) => ({
      ...film,
      // What the poster can't say: when, what they did on it, and whether
      // it's already in the library. mediaItems reads `note`.
      //
      // An entry in the library can still have no usable score (rated on a
      // criterion the weights ignore, or mid-migration), so a null from
      // scoreFor falls back to the bare "Rated" rather than printing it.
      note: [
        String(film.year),
        film.roles.join(', '),
        film.rated ? seenLabel(film.id, scoreFor) : null
      ].filter(Boolean).join(' · ')
    }));
}

/** How many of a filmography the user has already rated. */
export function filmographyProgress (films) {
  const total = (films || []).length;
  const seen = (films || []).filter((film) => film.rated).length;
  return { total, seen, unseen: total - seen };
}

/**
 * Flag the shorts in a filmography (2026-10-08: "now let's get rid of
 * shorts... whatever the line is for shorts, I think it's 40 minutes").
 *
 * TMDB's movie_credits carries no runtime, so the caller supplies one per
 * film id — the library's where the film is rated, a /movie/{id} lookup
 * otherwise. The rule is the app's one rule (shorts.js): 40 minutes or
 * under, and an unknown runtime is NOT a short. A short is hidden like an
 * extra, and says so once shown.
 */
export function markShorts (films, runtimeFor) {
  return (films || []).map((film) => (isShort({ runtime: runtimeFor(film.id) })
    ? { ...film, short: true, note: `${film.note} · Short` }
    : film));
}

/**
 * Runtimes for a list of TMDB ids, `concurrency` lookups at a time. A failed
 * lookup is simply left out — unknown runtime, so not a short.
 */
export async function fetchRuntimes (ids, fetchOne, { concurrency = 6 } = {}) {
  const runtimes = new Map();
  const queue = [...ids];
  const worker = async () => {
    while (queue.length) {
      const id = queue.shift();
      try {
        runtimes.set(id, await fetchOne(id));
      } catch {
        // Unknown runtime: the film stays in the main row.
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
  return runtimes;
}

/** Is this film kept off the main row until asked for? */
export function isHiddenFilm (film) {
  return Boolean(film?.extra || film?.short);
}

/** The link under the row: names only the kinds actually hidden. */
export function hiddenFilmsLabel (films, showing) {
  const hidden = (films || []).filter(isHiddenFilm);
  const one = hidden.length === 1;
  const kinds = [
    hidden.some((film) => film.short) ? (one ? 'short' : 'shorts') : null,
    hidden.some((film) => film.extra) ? (one ? 'appearance and extras' : 'appearances and extras') : null
  ].filter(Boolean).join(', ');
  return showing ? `Hide ${kinds}` : `Show ${hidden.length} ${kinds}`;
}
