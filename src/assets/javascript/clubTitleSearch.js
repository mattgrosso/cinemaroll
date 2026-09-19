// "Has anybody seen this?"
//
// Bug report -P1lQnAdARMxUpPScybv (2026-09-17): "It would be cool to be able
// to search my film club to see if anybody has watched a specific movie. I
// could search for the movie with and then have it filter to show me who's
// seen it and who hasn't. I don't know exactly how."
//
// FriendsWhoSaw already answers this for the film you happen to be looking
// at, by lookup. What's missing is the other direction: start from a title.
//
// THE HARD PART IS "WHO HASN'T". Sharing ratings is its own opt-in tier
// (social.js): a shelf-only sharer publishes no `ratings` map at all, only a
// top ten and a recent forty. `friendsWhoRated` is careful to make no claim
// about anybody it leaves out, precisely because absence there means either
// "hasn't seen it" or "doesn't tell us". A screen that answers Matt's
// question has to split those apart, or it will confidently report that a
// friend hasn't seen a film they rated five stars last week.
//
// So there are three answers, not two: seen it, hasn't seen it, and no way to
// know. The third one is small and says why.
//
// Pure and store-free. `friends` is the shape the `filmClubFriends` getter
// produces: [{ key, name, profile }].

/** Every title this friend is known to have seen, as [id, { t, p }] pairs. */
function knownTitles (profile) {
  const out = new Map();
  const add = (id, item) => {
    if (id == null) return;
    const key = String(id);
    if (!out.has(key)) out.set(key, { title: item?.t || '', poster: item?.p || null });
  };

  // The full map, when they share it.
  Object.entries(profile?.ratings || {}).forEach(([id, rating]) => add(id, rating));
  // And the two lists everybody publishes — a shelf-only sharer's ONLY
  // evidence, and worth reading even for someone who shares everything.
  (profile?.recent || []).forEach((item) => add(item?.id, item));
  (profile?.topShelf || []).forEach((item) => add(item?.id, item));

  return out;
}

/**
 * Does this friend tell us about everything they've watched? Only someone
 * publishing a `ratings` map does; for anyone else, "not in the list" is not
 * evidence of anything.
 */
export function sharesWholeLibrary (profile) {
  return Boolean(profile?.ratings && typeof profile.ratings === 'object');
}

/**
 * Every film the club knows about — the user's own library plus everything
 * any friend has published — as [{ id, title, poster }], deduped by TMDB id
 * and sorted by title.
 *
 * This is deliberately NOT a TMDB search. The question is about the club, and
 * every film the club has an answer for is in here by construction. A film
 * nobody has ever logged has only one possible answer, and the empty state
 * says it in a sentence rather than costing a network round trip.
 */
export function clubTitleIndex (myEntries, friends) {
  const byId = new Map();

  (myEntries || []).forEach((entry) => {
    const movie = entry?.movie;
    if (!movie?.id) return;
    byId.set(String(movie.id), {
      id: String(movie.id),
      title: movie.title || '',
      poster: movie.poster_path || null
    });
  });

  (friends || []).forEach((friend) => {
    knownTitles(friend?.profile).forEach((item, id) => {
      const existing = byId.get(id);
      if (existing) {
        // My own library's copy wins on title, but a friend may carry a
        // poster for a film mine has none for.
        if (!existing.poster && item.poster) existing.poster = item.poster;
        return;
      }
      byId.set(id, { id, title: item.title, poster: item.poster });
    });
  });

  return [...byId.values()]
    .filter((item) => item.title)
    .sort((a, b) => a.title.localeCompare(b.title));
}

/**
 * Titles matching `query`. A title that STARTS with what was typed comes
 * first — typing "the" should offer The Thing before Breathless.
 */
export function searchClubTitles (index, query, { limit = 12 } = {}) {
  const term = String(query || '').trim().toLowerCase();
  if (term.length < 2) return [];

  return (index || [])
    .map((item) => {
      const title = item.title.toLowerCase();
      if (title.startsWith(term)) return { item, rank: 0 };
      if (title.includes(term)) return { item, rank: 1 };
      return null;
    })
    .filter(Boolean)
    .sort((a, b) => a.rank - b.rank || a.item.title.localeCompare(b.item.title))
    .slice(0, limit)
    .map((match) => match.item);
}

/**
 * Who in the club has seen `tmdbId`, split three ways.
 *
 * `youveSeen` is answered from the user's own library and is the one certain
 * fact on the screen, so it's separate rather than being a row in a list.
 *
 * Each person appears in exactly one of `seen` / `notSeen` / `unknown`:
 *  - seen    — a published rating, or the film on their shelf/recent list
 *  - notSeen — they publish their whole library and it isn't in it
 *  - unknown — they don't publish it, so silence means nothing
 */
export function clubSeenBreakdown (friends, tmdbId, { myRatedIds = null } = {}) {
  const id = tmdbId == null || tmdbId === '' ? null : String(tmdbId);
  const seen = [];
  const notSeen = [];
  const unknown = [];

  if (id) {
    (friends || []).forEach((friend) => {
      const profile = friend?.profile;
      const person = { key: friend?.key ?? friend?.name, name: friend?.name || 'A friend' };

      // No profile fetched yet is its own kind of not-knowing, and looks the
      // same to the reader as a private one.
      if (!profile) {
        unknown.push({ ...person, why: 'their list hasn’t loaded' });
        return;
      }

      const rating = profile.ratings?.[id];
      if (rating && Number.isFinite(rating.r)) {
        seen.push({
          ...person,
          score: rating.r,
          stars: Number.isFinite(rating.s) ? rating.s : null
        });
        return;
      }

      // A shelf-only sharer can still prove they've seen it.
      const onShelf = [...(profile.recent || []), ...(profile.topShelf || [])]
        .some((item) => item && String(item.id) === id);
      if (onShelf) {
        seen.push({ ...person, score: null, stars: null });
        return;
      }

      if (sharesWholeLibrary(profile)) notSeen.push(person);
      else unknown.push({ ...person, why: 'they don’t share their ratings' });
    });
  }

  // Loudest opinion first, then anyone who's seen it but published no score,
  // then alphabetical so the order doesn't shuffle between renders.
  seen.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.name.localeCompare(b.name));
  notSeen.sort((a, b) => a.name.localeCompare(b.name));
  unknown.sort((a, b) => a.name.localeCompare(b.name));

  return {
    seen,
    notSeen,
    unknown,
    youveSeen: Boolean(id && myRatedIds && myRatedIds.has(id))
  };
}
