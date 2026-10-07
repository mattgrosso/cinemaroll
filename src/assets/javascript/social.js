// Social layer — pure logic (design session 2026-08-15). Cinema Roll users
// only; the Brian-app translation layer will publish INTO this same shape
// later. Everything privacy-relevant is opt-in by construction: nothing
// exists under social/ until a user's own app publishes it, and profiles
// are readable only when BOTH friend edges exist (enforced in the database
// rules, not app etiquette).
//
// Published profile shape (social/profiles/<userKey>):
//   { name, updatedAt, counts: {titles, viewings},
//     topShelf: [{id,t,p,r} x10], crown: {t,p,r,year}|null,
//     recent: [{id,t,p,r,at,s?,m?} x40],
//     ratings: { [tmdbId]: {r, at, t, p, s?, c?} } }
// `s` is the star rating — half-star steps, a presentation of the NORMALIZED
// score, and the only number in here that means the same thing across people
// (starRating.js). Optional on both: a profile published before 2026-08-31
// carries none in `recent`, and a rating below half a star has none at all.
// `c` is the eight-criterion breakdown as a fixed-order array (see CRITERIA)
// and is published ONLY behind its own opt-in (shareCriteria) — the default
// profile carries composite scores only.

import { logScore } from './logScore.js';
import { normalizedRatingToStars } from './starRating.js';

// Fixed publishing order for the compact criteria array. Index-coupled with
// anything reading `c` — append, never reorder.
export const CRITERIA = ['love', 'overall', 'stickiness', 'story', 'direction', 'imagery', 'performance', 'soundtrack'];

// Missing criteria become -1, never null — Firebase silently drops null
// array slots and returns a SPARSE array, which would shift every index in
// a fixed-order array. Readers must treat negatives as absent.
// Where and when, per viewing — Matt, 2026-08-16: club friends could see
// WHAT you rated but not that you saw it in a theatre in 2019 and on
// Blu-ray in 2024. Compact keys: at (timestamp), m (medium).
function viewingsFrom (entry) {
  return (entry?.ratings || [])
    .map((rating) => ({
      at: new Date(rating?.date ?? NaN).getTime(),
      m: rating?.medium || null
    }))
    .filter((viewing) => Number.isFinite(viewing.at))
    .sort((a, b) => b.at - a.at)
    .map((viewing) => (viewing.m ? { at: viewing.at, m: viewing.m } : { at: viewing.at }));
}

export function criteriaArrayFrom (rating) {
  if (!rating) return null;
  const values = CRITERIA.map((key) => {
    let raw = rating[key];
    // Same legacy fallback GetRating.js applies: old entries stored
    // stickiness as `impression`, sometimes on a >5 scale.
    if (key === 'stickiness' && (!raw || raw > 5) && raw !== 0) raw = rating.impression;
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : -1;
  });
  return values.some((v) => v >= 0) ? values : null;
}

// ---------------------------------------------------------------------------
// Sharing defaults (Matt, 2026-08-15): ON by default, no settings trip
// required — the friendship handshake is the real consent gate, and the
// database rules make an unfriended profile unreadable regardless. The
// settings card is the opt-OUT. Only an explicit `false` turns a tier off.
//
// `realName` is what the sign-in provider calls the account holder. Bug
// report, 2026-08-20: "It would be nice if we could use someone's real name
// when we mention them in film club." Nobody had ever typed a display name,
// so every mention fell through to the email's local part — "mattgrosso"
// rather than "Matt Grosso". The real name now sits between the two: an
// explicitly-typed display name still wins, and the email is still there for
// a provider that returns no name at all.
export function socialSettingsWithDefaults (raw, userEmail, realName) {
  const social = raw || {};
  const emailName = (userEmail || '').split('@')[0];
  return {
    enabled: social.enabled !== false,
    shareRatings: social.shareRatings !== false,
    shareCriteria: social.shareCriteria !== false,
    displayName: social.displayName || (realName || '').trim() || emailName || 'A Cinema Roll user'
  };
}

// ---------------------------------------------------------------------------
// Publishing: shape a profile from the user's own library, respecting the
// share toggles. Compact keys (t/p/r/at) keep ~1,400 ratings around 100KB.
export function buildSocialProfile (entries, getRatingFn, { name, shareRatings = false, shareCriteria = false, now = Date.now() } = {}) {
  const rated = [];
  let viewings = 0;

  (entries || []).forEach((entry) => {
    const scored = getRatingFn(entry);
    const rating = scored?.calculatedTotal;
    const id = entry?.movie?.id;
    if (!Number.isFinite(rating) || id == null) return;
    // Stars can ONLY be assigned here, by the person's own app. They are a
    // presentation of the normalized rating -- library-relative and
    // curve-adjusted (starRating.js) -- so a reader holding nothing but our
    // `r` cannot work them out: they have neither our library's range nor
    // our normalization tweak and anchors. Publishing the composite alone is
    // what left friends' pills showing a raw score on a scale that isn't
    // comparable between people (2026-08-25).
    const stars = normalizedRatingToStars(scored?.normalizedRating);
    const times = (entry.ratings || [])
      .map((r) => new Date(r?.date ?? NaN).getTime())
      .filter(Number.isFinite);
    viewings += Math.max(1, entry.ratings?.length || 0);
    const mostRecent = [...(entry.ratings || [])].sort((a, b) =>
      (new Date(b?.date ?? 0).getTime() || 0) - (new Date(a?.date ?? 0).getTime() || 0)
    )[0];
    rated.push({
      id,
      t: entry.movie.title || '',
      p: entry.movie.poster_path || null,
      r: Math.round(rating * 100) / 100,
      s: stars,
      at: times.length ? Math.max(...times) : null,
      c: shareCriteria ? criteriaArrayFrom(mostRecent) : null,
      v: viewingsFrom(entry),
      releaseYear: new Date(entry.movie.release_date ?? NaN).getFullYear() || null
    });
  });

  const byRating = [...rated].sort((a, b) => b.r - a.r);
  const byRecency = [...rated].filter((m) => m.at).sort((a, b) => b.at - a.at);

  // The Crown's current holder: walking release years oldest-first, the
  // final all-time high (same rule as Deep Stats).
  let crown = null;
  let high = -Infinity;
  [...rated].filter((m) => m.releaseYear).sort((a, b) => a.releaseYear - b.releaseYear).forEach((m) => {
    if (m.r > high) {
      high = m.r;
      crown = { t: m.t, p: m.p, r: m.r, year: m.releaseYear };
    }
  });

  const profile = {
    name: name || 'A Cinema Roll user',
    updatedAt: now,
    counts: { titles: rated.length, viewings },
    topShelf: byRating.slice(0, 10).map(({ id, t, p, r }) => ({ id, t, p, r })),
    // 40, not 20: "the recent feed on my film club could be larger"
    // (2026-08-17). Each item is a handful of fields, so the profile stays a
    // few KB. Friends only get the longer feed once they republish.
    //
    // `s` rides along for the same reason FriendsWhoSaw needs it: the feed
    // shows stars, and only this app can assign them (see the note above
    // `stars`). It is NOT behind shareRatings — `r` is already published here
    // unconditionally, and stars are a coarser view of the same opinion, so
    // withholding them would hide the more comparable of the two numbers
    // while publishing the less comparable one.
    recent: byRecency.slice(0, 40).map(({ id, t, p, r, s, at, v }) => ({
      id, t, p, r, at, ...(Number.isFinite(s) ? { s } : {}), ...(v?.[0]?.m ? { m: v[0].m } : {})
    })),
    crown
  };

  if (shareRatings) {
    const ratings = {};
    rated.forEach(({ id, t, p, r, s: stars, at, c, v }) => {
      ratings[id] = { r, at, t, p };
      // Optional: a rating below half a star, or one with no normalized value
      // yet, has no stars to publish. Absent rather than zero.
      if (Number.isFinite(stars)) ratings[id].s = stars;
      if (shareCriteria && c) ratings[id].c = c;
      if (v?.length) ratings[id].v = v;   // where and when, per viewing
    });
    profile.ratings = ratings;
  }

  return profile;
}

// ---------------------------------------------------------------------------
// Per-friend comparison: my entries vs their PUBLISHED ratings map.
export function compareWithFriend (myEntries, getRatingFn, friendProfile, { globalAvg = null, weights = {} } = {}) {
  const theirs = friendProfile?.ratings || {};
  const mine = new Map();
  (myEntries || []).forEach((entry) => {
    const rating = getRatingFn(entry)?.calculatedTotal;
    const id = entry?.movie?.id;
    if (Number.isFinite(rating) && id != null) mine.set(id, { entry, rating });
  });

  const shared = [];
  Object.entries(theirs).forEach(([id, their]) => {
    const my = mine.get(Number(id));
    if (my && Number.isFinite(their?.r)) {
      const mostRecent = [...(my.entry.ratings || [])].sort((a, b) =>
        (new Date(b?.date ?? 0).getTime() || 0) - (new Date(a?.date ?? 0).getTime() || 0)
      )[0];
      shared.push({
        entry: my.entry,
        mine: my.rating,
        theirs: their.r,
        gap: my.rating - their.r,
        myCriteria: criteriaArrayFrom(mostRecent),
        theirCriteria: Array.isArray(their.c) ? their.c : null,
        myViewings: viewingsFrom(my.entry),
        theirViewings: Array.isArray(their.v) ? their.v : []
      });
    }
  });

  if (!shared.length) {
    return { sharedCount: 0, theyLoveUnseen: pickUnseenLoves(theirs, mine), criterionGaps: null };
  }

  const myScores = shared.map((s) => s.mine);
  const theirScores = shared.map((s) => s.theirs);
  const avgGap = shared.reduce((sum, s) => sum + Math.abs(s.gap), 0) / shared.length;

  return {
    sharedCount: shared.length,
    myAverage: round2(myScores.reduce((a, b) => a + b, 0) / shared.length),
    theirAverage: round2(theirScores.reduce((a, b) => a + b, 0) / shared.length),
    myLogScore: Number.isFinite(globalAvg) ? logScore(myScores, globalAvg, weights) : null,
    theirLogScore: Number.isFinite(globalAvg) ? logScore(theirScores, globalAvg, weights) : null,
    averageGap: round2(avgGap),
    // Honest, explainable alignment: 10 - average absolute disagreement.
    alignment: round2(Math.max(0, 10 - avgGap)),
    biggestDisagreements: [...shared].sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)).slice(0, 12),
    sharedLoves: [...shared].filter((s) => s.mine >= 8 && s.theirs >= 8).sort((a, b) => (b.mine + b.theirs) - (a.mine + a.theirs)).slice(0, 12),
    theyLoveUnseen: pickUnseenLoves(theirs, mine),
    // Per-criterion tendencies across the overlap — only meaningful when the
    // friend opted into sharing their breakdown (theirCriteria present).
    criterionGaps: criterionGapsAcross(shared)
  };
}

// For each of the eight criteria: mean(mine - theirs) over every shared movie
// where BOTH sides have that criterion. null when no movie qualifies at all.
function criterionGapsAcross (shared) {
  const withBoth = shared.filter((s) => s.myCriteria && s.theirCriteria);
  if (!withBoth.length) return null;
  const gaps = CRITERIA.map((key, i) => {
    const pairs = withBoth
      .map((s) => [s.myCriteria[i], s.theirCriteria[i]])
      .filter(([a, b]) => Number.isFinite(a) && a >= 0 && Number.isFinite(b) && b >= 0);
    if (!pairs.length) return null;
    return {
      criterion: key,
      gap: round2(pairs.reduce((sum, [a, b]) => sum + (a - b), 0) / pairs.length),
      count: pairs.length
    };
  }).filter(Boolean);
  return gaps.length ? gaps.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap)) : null;
}

/**
 * What the club made of ONE film — `[{ name, rating }]`, best first.
 *
 * The counterpart to friendsLoveUnseen, which asks the same question across
 * the whole library. This is for MoviePreview: when you are deciding whether
 * to bother with a film nobody has rated for you, the people you actually
 * know having seen it is the most pertinent fact the app holds, and it costs
 * no request — the profiles are already in memory.
 *
 * Unrated-by-them is absent, not zero: a friend on the shelf-only sharing
 * tier publishes no `ratings` map at all and simply contributes nothing.
 */
export function friendRatingsFor (friendProfiles, tmdbId) {
  if (tmdbId == null) return [];
  const key = String(tmdbId);

  return Object.values(friendProfiles || {})
    .map((profile) => {
      const rating = profile?.ratings?.[key];
      if (!Number.isFinite(rating?.r)) return null;
      return { name: profile.name || 'A friend', rating: rating.r };
    })
    .filter(Boolean)
    .sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

// Across the whole Film Club: movies your friends rate highly that you
// have never rated. Agreement is the point — two friends at 9 is a much
// stronger recommendation than one, so consensus sorts above raw score.
// Requires friends who share their movie-by-movie scores; friends on the
// shelf-only tier simply contribute nothing here.
export function friendsLoveUnseen (myEntries, getRatingFn, friendProfiles, { minRating = 8, cap = 20 } = {}) {
  const mine = new Set();
  (myEntries || []).forEach((entry) => {
    const id = entry?.movie?.id;
    if (id != null && Number.isFinite(getRatingFn(entry)?.calculatedTotal)) mine.add(String(id));
  });

  const byMovie = new Map();
  Object.values(friendProfiles || {}).forEach((profile) => {
    if (!profile?.ratings) return;
    Object.entries(profile.ratings).forEach(([tmdbId, rating]) => {
      if (mine.has(String(tmdbId))) return;
      if (!Number.isFinite(rating?.r) || rating.r < minRating) return;
      const existing = byMovie.get(String(tmdbId)) || {
        id: Number(tmdbId),
        title: rating.t || '',
        poster_path: rating.p || null,
        fans: []
      };
      existing.fans.push({ name: profile.name || 'A friend', rating: rating.r });
      byMovie.set(String(tmdbId), existing);
    });
  });

  return [...byMovie.values()]
    .map((movie) => ({
      ...movie,
      fans: [...movie.fans].sort((a, b) => b.rating - a.rating),
      fanCount: movie.fans.length,
      average: Math.round((movie.fans.reduce((sum, fan) => sum + fan.rating, 0) / movie.fans.length) * 100) / 100
    }))
    .sort((a, b) => (b.fanCount - a.fanCount) || (b.average - a.average) || a.title.localeCompare(b.title))
    .slice(0, cap);
}

function pickUnseenLoves (theirRatings, mineMap, { minRating = 8, cap = 12 } = {}) {
  return Object.entries(theirRatings || {})
    .filter(([id, their]) => !mineMap.has(Number(id)) && Number.isFinite(their?.r) && their.r >= minRating)
    .map(([id, their]) => ({ id: Number(id), t: their.t, p: their.p, r: their.r }))
    .sort((a, b) => b.r - a.r)
    .slice(0, cap);
}

function round2 (n) {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// The rainbow badge: how many friend ratings have landed since the user
// last opened the Film Club. Counts items in each friend's published
// `recent` feed newer than lastSeen.
export function countNewFriendUpdates (friendProfiles, lastSeen) {
  const since = Number(lastSeen) || 0;
  return Object.values(friendProfiles || {}).reduce((count, profile) => {
    // An end-of-day copy's `at` is a date (noon UTC), so it would read as
    // already seen; `pub` is the midnight it was released to this reader.
    const fresh = (profile?.recent || []).filter((item) => Number(item?.pub ?? item?.at) > since);
    return count + fresh.length;
  }, 0);
}

// A friend's published stars for one title, or null. The `ratings` map is
// keyed by TMDB id and comes back from Firebase as an object, so its keys are
// strings while a feed item's id is a number — comparing the two directly
// finds nobody (the same trap friendViewings.js documents).
function starsFromRatings (profile, id) {
  if (id == null || id === '') return null;
  const stars = profile?.ratings?.[String(id)]?.s;
  return Number.isFinite(stars) ? stars : null;
}

// ---------------------------------------------------------------------------
// The Film Club summary: every friend's profile combined.
export function filmClubSummary (myEntries, getRatingFn, friendProfiles) {
  const profiles = Object.entries(friendProfiles || {}).filter(([, p]) => p);
  if (!profiles.length) return null;

  // Merged recent-activity feed, newest first.
  //
  // Stars come from the feed item when the friend's app published them, and
  // otherwise from their `ratings` map, which has carried `s` since 2026-08-25.
  // That second path is what makes the feed show stars TODAY: a profile only
  // gains `s` in `recent` when its owner's app next republishes, and waiting
  // for every friend to do that would leave the feed showing raw scores for
  // days. Still null for a shelf-only sharer or a raw Movie Log feed — the
  // screen falls back to the score there, exactly as the pills do.
  const feed = profiles.flatMap(([key, profile]) =>
    (profile.recent || []).map((item) => ({
      ...item,
      s: Number.isFinite(item.s) ? item.s : starsFromRatings(profile, item.id),
      friendKey: key,
      friendName: profile.name
    }))
  ).filter((item) => item.at).sort((a, b) => b.at - a.at).slice(0, 60);

  // Club favorites: movies rated by 2+ people (me included), by average.
  const mine = new Map();
  (myEntries || []).forEach((entry) => {
    const rating = getRatingFn(entry)?.calculatedTotal;
    const id = entry?.movie?.id;
    if (Number.isFinite(rating) && id != null) {
      mine.set(id, { id, t: entry.movie.title, p: entry.movie.poster_path, scores: [{ who: 'You', r: rating }] });
    }
  });
  const pool = new Map(mine);
  profiles.forEach(([, profile]) => {
    Object.entries(profile.ratings || {}).forEach(([id, their]) => {
      if (!Number.isFinite(their?.r)) return;
      const key = Number(id);
      const existing = pool.get(key) || { id: key, t: their.t, p: their.p, scores: [] };
      existing.scores.push({ who: profile.name, r: their.r });
      pool.set(key, existing);
    });
  });

  // Chips read highest score first (Matt, 2026-09-07: "everyone who likes it
  // with their ratings, we should sort them by rating"). Insertion order was
  // "You" then friends in profile order, which put the numbers in no order
  // at all.
  const multi = [...pool.values()].filter((movie) => movie.scores.length >= 2)
    .map((movie) => ({
      ...movie,
      scores: [...movie.scores].sort((a, b) => b.r - a.r),
      average: round2(movie.scores.reduce((sum, s) => sum + s.r, 0) / movie.scores.length),
      spread: round2(Math.max(...movie.scores.map((s) => s.r)) - Math.min(...movie.scores.map((s) => s.r)))
    }));

  return {
    friendCount: profiles.length,
    feed,
    clubFavorites: [...multi].sort((a, b) => (b.average - a.average) || (b.scores.length - a.scores.length)).slice(0, 12),
    biggestDivides: [...multi].filter((m) => m.spread >= 2).sort((a, b) => b.spread - a.spread).slice(0, 12)
  };
}

// ---------------------------------------------------------------------------
// A friend row on the Film Club screen. "The list of friends in my film club
// is a bit sparse. Can we spruce it up a bit?" (2026-08-17) — it was a name,
// a title count and a chevron.
//
// Deliberately NOT compareWithFriend: that returns twelve-item disagreement
// and shared-love lists and per-criterion gaps, all of it thrown away here.
// This walks the overlap once for the two numbers a row actually shows.
// `recentCount` defaults to everything the published profile carries (40 —
// see the `recent` writer above). It used to default to 4, which is what the
// friend rows showed: "In film club, we show lists of each friend's recent
// movies but they seem to be limited to just four movies" (2026-08-22). How
// many of those actually render is now the screen's business, not this
// function's — FilmClubScreen scrolls the row and pages images in.
export function friendSnapshot (myRatingsById, profile, { recentCount = Infinity } = {}) {
  const theirs = profile?.ratings || {};
  let shared = 0;
  let gapTotal = 0;

  Object.entries(theirs).forEach(([id, their]) => {
    const mine = myRatingsById?.get(Number(id));
    if (!Number.isFinite(mine) || !Number.isFinite(their?.r)) return;
    shared += 1;
    gapTotal += Math.abs(mine - their.r);
  });

  const recent = (profile?.recent || []).filter((item) => item?.at)
    .sort((a, b) => b.at - a.at);

  return {
    titles: profile?.counts?.titles ?? null,
    viewings: profile?.counts?.viewings ?? null,
    sharedCount: shared,
    // Same definition the comparison page uses, so a row and the page it
    // opens can't disagree: 10 minus the average absolute disagreement.
    alignment: shared ? round2(Math.max(0, 10 - gapTotal / shared)) : null,
    lastWatchedAt: recent[0]?.at ?? null,
    // True for a friend's end-of-day copy: show a day, never "3h ago".
    lastWatchedDayOnly: Boolean(recent[0]?.d),
    recent: recent.slice(0, recentCount)
  };
}

/** Ratings keyed by TMDB id, built once and shared across every friend row. */
export function myRatingsById (myEntries, getRatingFn) {
  const map = new Map();
  (myEntries || []).forEach((entry) => {
    const rating = getRatingFn(entry)?.calculatedTotal;
    const id = entry?.movie?.id;
    if (Number.isFinite(rating) && id != null) map.set(id, rating);
  });
  return map;
}

// ---------------------------------------------------------------------------
// What the club still needs fetched, given what's already in memory.
//
// The screens that load club data (Home, Film Club, Watchlist, Comparison)
// all fetch on MOUNT — reading settings/externalFriends and the friend edges
// before either has necessarily arrived on a cold start. That race left a
// whole session with no external profiles: three Movie Log friends had rated
// I Love Boosters and not one pill showed on its page (report
// -P0EQt6w7iKdJziMXHTi, 2026-08-29). This is the decision half of the store's
// re-runnable `ensureClubData`: it answers only from what's missing, so
// dispatching it again (a watcher firing as membership arrives, another
// detail page opening) fetches nothing that's already here.
//
// External ids come from the RAW settings map, matching what
// syncExternalFriends iterates; an errored feed counts as missing so a
// transient failure heals on the next surface that asks, rather than staying
// blank until the next full app launch.
//
// STALENESS (bug report, 2026-09-06): profiles are fetched with a one-shot
// `get`, never a listener, so an app that has been open since breakfast still
// holds the snapshot it fetched at breakfast. Seth logged a film at 3:14pm;
// Matt's phone buzzed; the push steered his already-running app to that
// film's page, and the pills showed nothing — his copy of Seth's profile was
// hours old and nothing here asked for a newer one, because "already here"
// was the only test. So a caller that is about to SHOW club data may name a
// `maxAgeMs`; a fetch older than that counts as missing. Profiles are ~100KB
// each, which is why this is opt-in per surface rather than the default.
// External feeds are someone else's Firebase bill (Brian, 2026-10-06: Movie
// Log was "running out of Firebase download space because we're giving him
// so much data" — every Cinema Roll refresh of his feed is a download billed
// to his project). While a refresh meant a full download this was an hour;
// with the v2 sync an unchanged refresh is two reads of a few hundred bytes,
// so it is five minutes again, the same as friends on this app (Matt, later
// the same night). The last result is kept across launches either way.
export const EXTERNAL_FEED_MAX_AGE_MS = 5 * 60 * 1000;

/** Whether an external sync should run at all right now. */
export function externalSyncDue ({ friends = {}, profiles = {}, syncedAt = 0, maxAgeMs = EXTERNAL_FEED_MAX_AGE_MS, now = Date.now(), force = false } = {}) {
  const ids = Object.keys(friends || {});
  if (!ids.length) return false;
  if (force) return true;
  if (ids.some((id) => !profiles?.[id])) return true;
  return (now - (Number(syncedAt) || 0)) > maxAgeMs;
}

/**
 * After the preflight: is the body download needed? Only when the feed we
 * hold carries no revision, the head could not be read, or it moved.
 */
export function feedBodyNeeded ({ cached, headRevision } = {}) {
  if (!cached?.revision) return true;
  if (typeof headRevision !== 'string' || !headRevision) return true;
  return headRevision !== cached.revision;
}

export function clubFetchesNeeded ({
  friendKeys = [], nativeProfiles = {}, externalFriends = {}, externalProfiles = {},
  fetchedAt = 0, maxAgeMs = Infinity, now = Date.now()
} = {}) {
  const stale = (now - (Number(fetchedAt) || 0)) > maxAgeMs;
  const nativeKeys = friendKeys || [];
  const externalIds = Object.keys(externalFriends || {});
  return {
    native: nativeKeys.some((key) => !nativeProfiles?.[key]) || (stale && nativeKeys.length > 0),
    external: externalIds.some((id) => !externalProfiles?.[id]) || (stale && externalIds.length > 0)
  };
}
