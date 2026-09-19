// Shared logic for reading back personal-awards data stored via
// PersonalAwardsModal.vue's convertNomineeToMinimal — used by
// PersonalAwardsModal.vue, Insights.vue, and TrophyCase.vue, all of which
// previously carried their own near-identical copy of this function.
//
// Converts a "minimal" stored nominee/winner (just movieId + a few role
// fields — see convertNomineeToMinimal in PersonalAwardsModal.vue for why
// it's stored this way, not as a full TMDB object) back into a displayable
// object by looking up the movie in the given entries library. Callers pass
// their own choice of library subset (e.g. Insights.vue's shorts-filtered
// list vs PersonalAwardsModal's full list) since that's a per-caller
// decision, not something this function should make.
export function expandNomineeFromMinimal (minimalNominee, entriesLibrary) {
  if (!minimalNominee) return null;

  // Handle legacy data - if it already has a movie object, it's not minimal
  if (minimalNominee.movie) {
    return minimalNominee; // Already expanded/legacy format
  }

  if (minimalNominee.type === 'person') {
    const movieEntry = entriesLibrary.find(entry => entry.movie.id === minimalNominee.movieId);

    if (!movieEntry) {
      console.warn('⚠️ Could not find movie for person nominee:', minimalNominee);
      return null;
    }

    const expanded = {
      id: minimalNominee.id,
      name: minimalNominee.name,
      movieId: minimalNominee.movieId,
      movie: movieEntry.movie
    };

    if (minimalNominee.character) {
      expanded.character = minimalNominee.character;
    }
    if (minimalNominee.directors) {
      expanded.directors = minimalNominee.directors;
    }
    if (minimalNominee.profilePath) {
      expanded.details = { profile_path: minimalNominee.profilePath };
    }

    return expanded;
  } else if (minimalNominee.type === 'movie') {
    const movieEntry = entriesLibrary.find(entry => entry.movie.id === minimalNominee.movieId);

    if (!movieEntry) {
      console.warn('⚠️ Could not find movie entry:', minimalNominee);
      return null;
    }

    return movieEntry;
  }

  // Fallback for unknown types or legacy data
  return minimalNominee;
}

// Grammar helpers for the user-configurable personal award name
// (settings.personalAwardName, e.g. "The Groskers" — see Home.vue's
// settings panel). Shared so MovieDetail.vue's "My Awards" heading agrees
// with Home.vue/PersonalAwardsModal.vue rather than hardcoding "Oscar".
/**
 * How many nominees a category has, counting a PERSON once however many
 * films they were nominated for.
 *
 * Bug report (2026-08-21): "somebody who was nominated for a specific role,
 * but has appeared in more than one movie... they get counted twice so even
 * though it's only five people it says there are six nominees." Nominations
 * are stored per person-per-movie on purpose - picking the same actor in two
 * films is how Matt acknowledges a great year - but the count on the category
 * row should read as people, because that is what "five nominees" means at a
 * real ceremony.
 *
 * A person's identity is their TMDB id when there is one, their name when
 * there isn't (convertNomineeToMinimal falls back to the name for the id, so
 * name-collisions across DIFFERENT people were already collapsed upstream and
 * nothing is lost here). Movie nominees count individually, as before.
 */
export function distinctNomineeCount (nominees) {
  const keys = new Set();
  for (const nominee of nominees || []) {
    if (!nominee) continue;
    const isPerson = nominee.type === 'person' || (nominee.name != null && nominee.movieId != null);
    if (isPerson) {
      keys.add(`person:${nominee.id ?? nominee.name}`);
    } else {
      // Movies: one nominee per entry. Fall back to object identity via an
      // ever-unique key rather than collapsing unknown shapes together.
      keys.add(`movie:${nominee.id ?? nominee.movieId ?? nominee.movie?.id ?? `#${keys.size}`}`);
    }
  }
  return keys.size;
}

export function awardNameWithThe (personalAwardName) {
  const name = personalAwardName || 'Oscar';
  return name.toLowerCase().startsWith('the ') ? name : `The ${name}`;
}

export function awardNameWithoutThe (personalAwardName) {
  const name = personalAwardName || 'Oscar';
  return name.toLowerCase().startsWith('the ') ? name.substring(4) : name;
}

export function awardNameSingular (personalAwardName) {
  const name = awardNameWithoutThe(personalAwardName);
  if (name.toLowerCase().endsWith('ies')) {
    return name.slice(0, -3) + 'y'; // e.g., "Smithies" -> "Smithy"
  } else if (name.toLowerCase().endsWith('s')) {
    return name.slice(0, -1); // e.g., "Oscars" -> "Oscar"
  }
  return name; // Already singular
}

// Lead <-> supporting sibling categories. The same person for the same
// movie/role must not be nominated in both (user feedback: "I've in a few
// places nominated somebody for both best actor and best supporting actor
// for the same role in the same movie. And I really shouldn't do that.").
// Cross-MOVIE double nominations stay legal — a busy year is a real thing.
export const ACTING_SIBLING_CATEGORIES = {
  bestActor: 'bestSupportingActor',
  bestSupportingActor: 'bestActor',
  bestActress: 'bestSupportingActress',
  bestSupportingActress: 'bestActress'
};

/**
 * ONE answer to "are these two records the same person?", used by every
 * awards comparison. Do not re-derive it inline.
 *
 * A person's stored `id` is NOT stable. `extractAndGroupPeopleByMovie`
 * builds cast options as `id: person.id || person.name`, so what got saved
 * depends entirely on what the movie's cached TMDB cast looked like on the
 * day the nomination was made. One real year (1993, report
 * -P1oV4wiVPs-5rAyJ9AN) holds all three shapes at once:
 *
 *   { id: 'Liam Neeson-424' }   ← cast entry whose own id was name-movieId
 *   { id: 1524 }                ← a real TMDB person id
 *   { id: 'Julia Roberts' }     ← the name fallback, cast had no id
 *
 * Re-fetching a film's cast changes which shape a FRESH grid option gets,
 * while the saved nominee keeps the old one — so `nom.id === option.id`
 * silently stops matching. The visible damage: the saved nominee has no lit
 * tile in the grid, no crown if they won, and the × on their poster does
 * nothing at all, because removal used to go looking for their grid tile.
 *
 * The name is the one field every shape carries and every shape agrees on,
 * so it is the primary key here, with the id as the fallback for a record
 * that somehow has no name. Two DIFFERENT people sharing a name inside a
 * single year would collapse together — `distinctNomineeCount` already
 * accepts that trade for the same reason, and a wrongly-merged namesake is
 * recoverable where an unremovable nominee is not.
 */
export function samePersonNominee (a, b) {
  if (!a || !b) return false;
  if (a.name && b.name) return a.name === b.name;
  if (a.id != null && b.id != null) return String(a.id) === String(b.id);
  return false;
}

/**
 * The same identity as a string, for grouping/Set membership. Two records
 * produce the same key exactly when `samePersonNominee` says they match.
 */
export function personNomineeKey (person) {
  if (!person) return 'unknown';
  if (person.name) return `name:${person.name}`;
  return `id:${person.id != null ? String(person.id) : 'unknown'}`;
}

/** Person identity AND the same film — a specific nominated role. */
export function samePersonRole (a, b) {
  if (!samePersonNominee(a, b)) return false;
  if (a.movieId == null || b.movieId == null) return false;
  return String(a.movieId) === String(b.movieId);
}

/**
 * The sibling category key that already holds this person for this movie,
 * or null. `person` needs { name?, id?, movieId }; nominees are the modal's
 * minimal shapes.
 */
export function actingSiblingConflict (categoryKey, person, awardsData) {
  const sibling = ACTING_SIBLING_CATEGORIES[categoryKey];
  if (!sibling || !person || person.movieId == null) return null;

  const nominees = awardsData?.[sibling]?.nominees || [];
  return nominees.some((nominee) => samePersonRole(nominee, person)) ? sibling : null;
}

// The minimum rated movies a year needs before the awards flow offers it.
// Was a hardcoded 10 — "an arbitrary number that I came up with for me"
// (bug report 2026-08-15); now a per-user setting with 10 as the default.
export function awardsYearThreshold (settings) {
  const value = Number(settings?.awardsYearThreshold);
  return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 10;
}

// How many awards-eligible films each release year has. Shorts (<=40min)
// don't compete, the same exclusion the modal applies.
export function awardsYearCounts (entries) {
  const counts = {};

  (entries || []).forEach((entry) => {
    const releaseDate = entry?.movie?.release_date;
    if (!releaseDate) return;
    if (entry.movie.runtime && entry.movie.runtime <= 40) return;

    const year = new Date(releaseDate).getFullYear();
    if (!Number.isFinite(year)) return;
    counts[year] = (counts[year] || 0) + 1;
  });

  return counts;
}

/**
 * Every year with enough rated films to enter the awards flow at all,
 * ascending. This is only the SIZE gate — whether a year still needs work is
 * a separate question each caller answers its own way.
 *
 * Bug report (2026-08-22, Natalie): "Yesterday I changed my personal award
 * number so that I only need three movies and I haven't gotten a pop-up even
 * though I know that for example 1997 has three movies." `awardsYearThreshold`
 * was honoured by the modal and by the /awards year strip, but Home's
 * `shouldShowAwardsModal` — the gate that decides whether the prompt appears
 * at ALL — carried its own hardcoded `>= 10`. Lowering the setting therefore
 * changed every screen except the one that offers you the work. One function,
 * so a fourth copy can't drift off again.
 */
export function yearsMeetingAwardsThreshold (entries, settings) {
  const threshold = awardsYearThreshold(settings);
  const counts = awardsYearCounts(entries);

  return Object.keys(counts)
    .map(Number)
    .filter((year) => Number.isFinite(year) && counts[year] >= threshold)
    .sort((a, b) => a - b);
}

// Every year the awards flow will offer, oldest first — the year strip on
// /awards.
//
// Deliberately NOT the same list as the modal's `yearsEligibleForAwards`,
// which drops finished years because it answers "what should I work on next".
// This answers "which years can I look at", so a completed year stays in it —
// that's the whole point of browsing back to one (Matt, 2026-08-16: "I'm not
// sure how to get to my awards view. If I wanna just look at a single year's
// awards").
//
// Ascending, matching the year scroller on the home screen.
export function awardsBrowsableYears (entries, settings) {
  return yearsMeetingAwardsThreshold(entries, settings);
}

/**
 * Which of the three reasons a year is sitting in the awards prompt.
 *
 * Bug report, 2026-08-19: "The language for the prompt that tells me to work
 * on a year for my personal awards needs to be specific to if I am doing
 * those awards for the first time because I've just rated my 10th movie or if
 * I'm doing those awards because I've just rated an additional movie. We
 * should make sure the language is appropriate to those situations."
 *
 * Matt named two, and there are in fact three — a year can also be part-way
 * through, which this codebase already treats as its own state (the modal must
 * keep offering years with partial progress; see .claude/rules/awards.md).
 * Telling someone a year "has enough films" when they are halfway through
 * picking its winners is the same wrongness he is reporting, one step along.
 *
 *   'first-time'  — no awards recorded for the year at all.
 *   'in-progress' — started, never marked complete.
 *   'new-films'   — completed, and films have been rated for it since.
 */
export function awardsPromptReason (existingAwards) {
  if (!existingAwards) return 'first-time';
  if (!existingAwards.completed) return 'in-progress';
  return 'new-films';
}

/**
 * The prompt's wording for a year, matched to why it is being offered.
 *
 * `newFilmCount` only colours the 'new-films' case; the others ignore it.
 */
export function awardsPromptCopy (year, existingAwards, newFilmCount = 0) {
  const reason = awardsPromptReason(existingAwards);

  if (reason === 'in-progress') {
    return { reason, text: `Your ${year} awards are part-way done.`, action: 'Finish picking' };
  }

  if (reason === 'new-films') {
    const films = newFilmCount === 1 ? 'another film' : `${newFilmCount} more films`;
    // A count of 0 shouldn't happen (the year wouldn't be offered), but read
    // it as the general case rather than printing "0 more films".
    const what = newFilmCount > 0 ? films : 'more films';
    return {
      reason,
      text: `You've rated ${what} from ${year} since handing out its awards.`,
      action: 'Take another look'
    };
  }

  return { reason, text: `${year} has enough films to hand out awards.`, action: 'Pick your winners' };
}
