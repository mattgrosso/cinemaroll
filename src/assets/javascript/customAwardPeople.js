// Who a person-type custom (honorary) award can go to, and which of them the
// page shows right now. Pure, so the modal stays a thin layer over it.
//
// The pool is every cast member and every stored crew member of the year's
// films. Showing all of it would be hundreds of tiles (cast is stored
// untrimmed), so each film starts at CUSTOM_AWARD_CAST_DEPTH billed actors
// and grows by CUSTOM_AWARD_CAST_STEP per "More cast" tap. A name search looks
// through the WHOLE pool regardless of depth: voice roles and small parts are
// billed low, and Natalie couldn't reach Finding Nemo's Crush or Bruce for her
// "Best Non-Human Character" (2026-10-31).

export const CUSTOM_AWARD_CAST_DEPTH = 10;
export const CUSTOM_AWARD_CAST_STEP = 10;

// Every person on these films. Cast options carry `castIndex` (their billing
// position); crew carry null. The same person on two films appears twice, on
// purpose — the unit is a person for a piece of work, as in the acting grids.
export function customAwardPool (entries) {
  const people = [];
  const seen = new Set();

  (entries || []).forEach((entry) => {
    const movie = entry?.movie || {};
    const add = (person, role, castIndex) => {
      if (!person?.name) return;
      const dedupeKey = `${person.name}|${movie.id}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
      people.push({
        id: person.id || person.name,
        name: person.name,
        role,
        movie,
        movieId: movie.id,
        castIndex,
        // No gender check: that belongs to the four acting categories.
        needsGenderCheck: false
      });
    };

    (movie.cast || []).forEach((person, index) => add(person, person.character || 'Cast', index));
    (movie.crew || []).forEach((person) => add(person, person.job || 'Crew', null));
  });

  return people;
}

// Case- and accent-blind, so "oneill" finds "O'Neill" and "zoe" finds "Zoë".
export function foldForSearch (text) {
  return String(text || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function matchesQuery (option, folded) {
  return foldForSearch(option.name).includes(folded) ||
    foldForSearch(option.role).includes(folded);
}

// The pool cut down to what the page shows, grouped by film in pool order
// (the pool arrives sorted by film score). Each group says whether its film
// has more cast to reveal.
//
// - `query`: when it has any letters, every match in the whole pool, by name
//   or by character/job; depth is ignored and no group offers more.
// - `depths`: { [movieId]: n } overriding the starting depth per film.
// - `isNominee(option)`: already-picked people always show, however deep they
//   were billed, or a nominee found by search would vanish when it's cleared.
export function visibleCustomAwardGroups (pool, { query = '', depths = {}, isNominee = () => false } = {}) {
  const folded = foldForSearch(query);
  const groups = [];
  const byMovie = new Map();

  (pool || []).forEach((option) => {
    const key = String(option.movieId);
    let group = byMovie.get(key);
    if (!group) {
      group = { movieId: option.movieId, movie: option.movie, people: [], hasMore: false };
      byMovie.set(key, group);
      groups.push(group);
    }

    const depth = depths[key] ?? CUSTOM_AWARD_CAST_DEPTH;
    const deep = option.castIndex != null && option.castIndex >= depth;

    if (folded) {
      if (matchesQuery(option, folded)) group.people.push(option);
      return;
    }

    if (!deep || isNominee(option)) {
      group.people.push(option);
    } else {
      group.hasMore = true;
    }
  });

  return groups.filter((group) => group.people.length > 0 || (!folded && group.hasMore));
}
