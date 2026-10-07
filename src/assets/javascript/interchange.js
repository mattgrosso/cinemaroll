// Film Club Interchange — letting a friend on a different app appear in
// your Film Club as an ordinary friend (Matt, 2026-08-16).
//
// Cinema Roll and Brian's Movie Log descend from the same code, so they
// record the SAME eight criteria per viewing. Movie Log calls stickiness
// "impression" (Cinema Roll's own legacy name for it, still honoured in
// GetRating.js) and nests everything under movie.tmdb; otherwise the data
// lines up almost field for field.
//
// This module defines one small, versioned, NAMED format both apps can
// publish and consume, plus an adapter that reads Movie Log's raw records
// directly — so the other app doesn't have to implement anything for us to
// consume it. Everything here is pure; fetching and storage live elsewhere.

import { normalizedRatingToStars } from './starRating.js';
import { contentRevision, REVISION_PATTERN } from './feedRevision.js';
import { validAwards } from './awardsShare.js';

export const INTERCHANGE_FORMAT = 'film-club/1';

// Deliberately named rather than positional: an interop payload should be
// readable by a stranger without consulting our source.
export const CRITERIA_KEYS = ['love', 'overall', 'stickiness', 'story', 'direction', 'imagery', 'performance', 'soundtrack'];

// Movie Log's field name for stickiness.
const FOREIGN_STICKINESS = 'impression';

function num (value) {
  const parsed = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

function timestamp (value) {
  const ms = new Date(value ?? NaN).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function criteriaFrom (source, { stickinessKey = 'stickiness' } = {}) {
  if (!source) return null;
  const out = {};
  CRITERIA_KEYS.forEach((key) => {
    const raw = key === 'stickiness' ? source[stickinessKey] ?? source.stickiness : source[key];
    const value = num(raw);
    if (value !== null) out[key] = value;
  });
  return Object.keys(out).length ? out : null;
}

// ---------------------------------------------------------------------------
// PUBLISH: our library -> the interchange format.
export function toInterchange (entries, getRatingFn, { name, source = 'cinemaroll', now = Date.now(), awards = null, awardsName = null } = {}) {
  const movies = [];

  (entries || []).forEach((entry) => {
    const tmdbId = entry?.movie?.id;
    const scored = getRatingFn(entry);
    const rating = num(scored?.calculatedTotal);
    if (tmdbId == null || rating === null) return;

    // Stars are the source-assigned presentation of the NORMALIZED rating
    // (library-relative, curve-adjusted — see starRating.js), never a
    // rescaling of the composite. Optional: omitted when the entry has no
    // normalized rating or it falls below half a star.
    const starRating = normalizedRatingToStars(scored?.normalizedRating);

    const viewings = (entry.ratings || [])
      .map((row) => ({ watchedAt: timestamp(row?.date), medium: row?.medium || null }))
      .filter((viewing) => viewing.watchedAt !== null)
      .sort((a, b) => b.watchedAt - a.watchedAt)
      .map((viewing) => (viewing.medium ? viewing : { watchedAt: viewing.watchedAt }));

    const latest = [...(entry.ratings || [])]
      .sort((a, b) => (timestamp(b?.date) || 0) - (timestamp(a?.date) || 0))[0];

    const movie = {
      tmdbId: Number(tmdbId),
      title: entry.movie.title || '',
      posterPath: entry.movie.poster_path || null,
      year: new Date(entry.movie.release_date ?? NaN).getFullYear() || null,
      rating: Math.round(rating * 100) / 100
    };
    if (starRating !== null) movie.starRating = starRating;
    const criteria = criteriaFrom(latest);
    if (criteria) movie.criteria = criteria;
    if (viewings.length) movie.viewings = viewings;
    // Personal awards (2026-10-06): [{ year, category, label, result, name? }]
    const movieAwards = validAwards(awards?.[movie.tmdbId]);
    if (movieAwards) movie.awards = movieAwards;
    movies.push(movie);
  });

  const feed = {
    format: INTERCHANGE_FORMAT,
    source,
    name: name || 'A friend',
    ...(awardsName ? { awardsName: String(awardsName).slice(0, 80) } : {}),
    // Cheap change detection: a subscriber that has seen this marker can
    // stop without parsing the rest.
    marker: now,
    movieCount: movies.length,
    movies
  };
  // Brian's sync guide (2026-10-06): a 32-hex token that moves with the body
  // and only the body, readable on its own at /revision.json, so an
  // unchanged refresh costs a few bytes instead of the whole feed.
  feed.revision = contentRevision(feed);
  return feed;
}

// ---------------------------------------------------------------------------
// CONSUME: any supported payload -> the profile shape Film Club renders
// (the same shape social.js publishes), so an external friend is
// indistinguishable from a Cinema Roll one.
export function detectFormat (payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.format === 'string' && payload.format.startsWith('film-club/')) return 'interchange';
  // Movie Log: either the raw record map/array, or an object of them.
  const sample = Array.isArray(payload) ? payload[0] : Object.values(payload)[0];
  if (sample && typeof sample === 'object' && sample.movie && Array.isArray(sample.movie.viewings)) return 'movielog';
  if (payload.movie && Array.isArray(payload.movie.viewings)) return 'movielog';
  return null;
}

function profileFromMovies (movies, { name, source, marker, revision = null, awardsName = null }) {
  const withRatings = movies.filter((movie) => Number.isFinite(movie.rating));
  const byRating = [...withRatings].sort((a, b) => b.rating - a.rating);
  const lastWatched = (movie) => movie.viewings?.[0]?.watchedAt ?? null;
  const byRecency = withRatings.filter(lastWatched).sort((a, b) => lastWatched(b) - lastWatched(a));

  const ratings = {};
  withRatings.forEach((movie) => {
    const row = {
      r: movie.rating,
      at: lastWatched(movie),
      t: movie.title,
      p: movie.posterPath || null
    };
    // `s` is optional throughout: a feed in the raw Movie Log format carries
    // no stars and none can be derived, so readers must cope with its absence
    // rather than treating it as a zero.
    if (Number.isFinite(movie.starRating)) row.s = movie.starRating;
    if (movie.criteria) row.c = CRITERIA_KEYS.map((key) => (Number.isFinite(movie.criteria[key]) ? movie.criteria[key] : -1));
    const awards = validAwards(movie.awards);
    if (awards) row.a = awards;
    if (movie.viewings?.length) {
      row.v = movie.viewings.map((viewing) => (viewing.medium ? { at: viewing.watchedAt, m: viewing.medium } : { at: viewing.watchedAt }));
    }
    ratings[movie.tmdbId] = row;
  });

  const shelf = (movie) => ({ id: movie.tmdbId, t: movie.title, p: movie.posterPath || null, r: movie.rating });

  return {
    name: name || 'A friend',
    source: source || 'external',
    // The feed's revision when it had one: the reader's preflight compares
    // /revision.json to this and skips the body when they match.
    revision: typeof revision === 'string' && REVISION_PATTERN.test(revision) ? revision : null,
    awardsName: typeof awardsName === 'string' && awardsName ? awardsName.slice(0, 80) : null,
    updatedAt: marker || Date.now(),
    counts: {
      titles: withRatings.length,
      viewings: withRatings.reduce((sum, movie) => sum + Math.max(1, movie.viewings?.length || 1), 0)
    },
    topShelf: byRating.slice(0, 10).map(shelf),
    recent: byRecency.slice(0, 20).map((movie) => ({
      ...shelf(movie),
      at: lastWatched(movie),
      ...(movie.viewings?.[0]?.medium ? { m: movie.viewings[0].medium } : {})
    })),
    crown: null,
    ratings
  };
}

export function fromInterchange (payload) {
  if (!payload || !Array.isArray(payload.movies)) return null;
  const movies = payload.movies
    .map((movie) => ({
      tmdbId: Number(movie?.tmdbId),
      title: movie?.title || '',
      posterPath: movie?.posterPath || null,
      rating: num(movie?.rating),
      // The sender's OWN star rating. Never recomputed from `rating` here:
      // stars are a presentation of the normalized, library-relative,
      // curve-adjusted score (see starRating.js), and we have neither their
      // library nor their curve. Only the source can assign them.
      starRating: num(movie?.starRating),
      criteria: movie?.criteria || null,
      awards: validAwards(movie?.awards),
      viewings: Array.isArray(movie?.viewings)
        ? movie.viewings
          .map((viewing) => ({ watchedAt: timestamp(viewing?.watchedAt), medium: viewing?.medium || null }))
          .filter((viewing) => viewing.watchedAt !== null)
          .sort((a, b) => b.watchedAt - a.watchedAt)
        : []
    }))
    .filter((movie) => Number.isFinite(movie.tmdbId));

  return profileFromMovies(movies, { name: payload.name, source: payload.source, marker: payload.marker, revision: payload.revision, awardsName: payload.awardsName });
}

// Movie Log's own records, unmodified — so Brian only has to expose data,
// not transform it. Records look like:
//   { movieId, movie: { title, year, tmdb: { id, poster_path },
//                       viewings: [{ date, medium, rating, love, impression, … }] } }
export function fromMovieLog (payload, { name = 'A Movie Log friend' } = {}) {
  const records = Array.isArray(payload)
    ? payload
    : Object.values(payload || {}).filter((value) => value && typeof value === 'object');

  const movies = records.map((record) => {
    const inner = record?.movie || record;
    const tmdbId = Number(record?.movieId ?? inner?.tmdb?.id);
    if (!Number.isFinite(tmdbId)) return null;

    const viewings = (inner?.viewings || [])
      .map((viewing) => ({ watchedAt: timestamp(viewing?.date), medium: viewing?.medium || null, raw: viewing }))
      .filter((viewing) => viewing.watchedAt !== null)
      .sort((a, b) => b.watchedAt - a.watchedAt);

    const latest = viewings[0]?.raw || (inner?.viewings || [])[0] || null;
    const rating = num(latest?.rating);
    if (rating === null) return null;

    return {
      tmdbId,
      title: inner?.title || '',
      posterPath: inner?.tmdb?.poster_path || null,
      rating,
      criteria: criteriaFrom(latest, { stickinessKey: FOREIGN_STICKINESS }),
      viewings: viewings.map(({ watchedAt, medium }) => ({ watchedAt, medium }))
    };
  }).filter(Boolean);

  return profileFromMovies(movies, { name, source: 'movielog', marker: Date.now() });
}

// One entry point for a subscriber: hand it whatever a friend's feed
// returned and get a renderable profile, or null if it isn't recognisable.
export function profileFromFeed (payload, { fallbackName } = {}) {
  const format = detectFormat(payload);
  if (format === 'interchange') {
    const profile = fromInterchange(payload);
    if (profile && fallbackName && !payload.name) profile.name = fallbackName;
    return profile;
  }
  if (format === 'movielog') return fromMovieLog(payload, { name: fallbackName });
  return null;
}

// ---------------------------------------------------------------------------
// CONNECT: a cross-app friend request. Cinema Roll's own friendships are a
// two-edge handshake, but another app can't write into our database and we
// can't write into theirs — so a request is a small message dropped into an
// inbox whose URL the recipient handed out. Accepting stores the sender's
// feed URL; from then on both sides simply pull.

export const CONNECT_APP = 'cinemaroll';

// The link you send someone on another app. Everything they need to both
// subscribe to you AND ask you to subscribe to them.
/**
 * Are these two subscription URLs the same feed?
 *
 * Bug report -P-H-twP5kUjwuEanKMm (2026-08-17): "I appear to have doubled
 * the amount of Brian's feed that I'm receiving... I see all of his movies
 * twice." He was subscribed to one identical URL under two ids, added
 * twelve hours apart — accepting a connect request and accepting an invite
 * both call addExternalFriend, and each minted a fresh `ext-<time>` id
 * without ever checking whether that feed was already in the club.
 *
 * Compared loosely on purpose: the same feed reached by a link that
 * happens to carry a trailing slash, different capitalisation of the host,
 * or a cache-busting query is still the same friend.
 */
export function sameFeedUrl (a, b) {
  const normalize = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    try {
      const url = new URL(raw);
      return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
    } catch {
      return raw.toLowerCase().replace(/\/+$/, '');
    }
  };

  const left = normalize(a);
  return Boolean(left) && left === normalize(b);
}

/**
 * The id of an already-subscribed friend with this feed, or null.
 * `friends` is the settings/externalFriends map.
 */
export function findSubscription (friends, feedUrl) {
  const match = Object.entries(friends || {})
    .find(([, friend]) => sameFeedUrl(friend?.feedUrl, feedUrl));
  return match ? match[0] : null;
}

/**
 * Collapse a friends map that already contains duplicates, keeping the
 * entry that was added first. Repairs a club that got doubled before the
 * check above existed, without needing anybody to go tidy their settings.
 */
export function dedupeExternalFriends (friends) {
  const byFeed = new Map();

  Object.entries(friends || {})
    .sort(([, a], [, b]) => (a?.addedAt || 0) - (b?.addedAt || 0))
    .forEach(([id, friend]) => {
      const key = friend?.feedUrl ? `feed:${normalizeForKey(friend.feedUrl)}` : `id:${id}`;
      if (!byFeed.has(key)) byFeed.set(key, [id, friend]);
    });

  return Object.fromEntries(byFeed.values());
}

function normalizeForKey (feedUrl) {
  try {
    const url = new URL(String(feedUrl).trim());
    return `${url.protocol}//${url.host.toLowerCase()}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return String(feedUrl).trim().toLowerCase().replace(/\/+$/, '');
  }
}

export function buildInvite ({ accountKey, inviteCode, feedUrl, name, databaseUrl }) {
  if (!accountKey || !inviteCode || !feedUrl) return null;
  return {
    format: INTERCHANGE_FORMAT,
    name: name || 'A Cinema Roll user',
    app: CONNECT_APP,
    // Subscribe to me here.
    feedUrl,
    // Ask to be added here: PUT/POST a request as a new child of this path.
    inboxUrl: `${databaseUrl}/clubInbox/${accountKey}/${inviteCode}.json`
  };
}

export function parseInvite (raw) {
  let payload = raw;
  if (typeof raw === 'string') {
    const text = raw.trim();
    if (!text) return null;
    try {
      payload = JSON.parse(text);
    } catch {
      // A bare feed URL is a perfectly good invite: we can subscribe, we
      // just can't ask them to subscribe back.
      return /^https?:\/\//i.test(text) ? { feedUrl: text } : null;
    }
  }
  if (!payload || typeof payload !== 'object' || !payload.feedUrl) return null;
  return {
    name: payload.name || null,
    app: payload.app || null,
    feedUrl: payload.feedUrl,
    inboxUrl: payload.inboxUrl || null
  };
}

// A request as it sits in an inbox. Kept deliberately small and boring so
// another app can produce one with a single HTTP call.
export function buildConnectRequest ({ name, feedUrl, replyInboxUrl, app = CONNECT_APP, now = Date.now() }) {
  if (!name || !feedUrl) return null;
  const request = { name: String(name).slice(0, 120), app, feedUrl: String(feedUrl).slice(0, 500), at: now };
  if (replyInboxUrl) request.replyInboxUrl = String(replyInboxUrl).slice(0, 500);
  return request;
}

// Anyone who knows the invite link can write here, so nothing from an inbox
// is trusted until it has been through this.
export function normalizeInboxRequests (raw, { now = Date.now(), maxAgeDays = 60 } = {}) {
  const cutoff = now - maxAgeDays * 24 * 60 * 60 * 1000;
  return Object.entries(raw || {})
    .map(([id, request]) => {
      const feedUrl = typeof request?.feedUrl === 'string' ? request.feedUrl.trim() : '';
      if (!/^https:\/\//i.test(feedUrl)) return null;      // https only
      const at = Number(request?.at) || 0;
      if (at && at < cutoff) return null;
      return {
        id,
        name: String(request?.name || 'Someone').slice(0, 120),
        app: String(request?.app || 'another app').slice(0, 60),
        feedUrl,
        replyInboxUrl: typeof request?.replyInboxUrl === 'string' && /^https:\/\//i.test(request.replyInboxUrl)
          ? request.replyInboxUrl
          : null,
        at
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.at - a.at);
}

// ---------------------------------------------------------------------------
// DISCOVERY: a public directory per app, so friends can be found and added
// without anyone copying links around.
//
// The directory deliberately does NOT contain feed URLs. A feed URL is a
// capability — anyone holding it can read that library — so feeds are
// exchanged only between two people who have agreed. The directory carries
// just enough to find someone and knock on their door.

// Apps Cinema Roll knows how to browse. Adding one is a two-line change.
export const FEDERATED_APPS = Object.freeze([
  {
    id: 'movielog',
    name: 'Movie Log',
    directoryUrl: 'https://movie-log-ae673-default-rtdb.firebaseio.com/clubDirectory.json'
  }
]);

export function buildDirectoryEntry ({ handle, name, inboxUrl, app = CONNECT_APP, avatarUrl = null }) {
  if (!handle || !name || !inboxUrl) return null;
  const entry = { handle: String(handle).slice(0, 40), name: String(name).slice(0, 120), app, inboxUrl };
  if (avatarUrl) entry.avatarUrl = String(avatarUrl).slice(0, 500);
  return entry;
}

// Another app's directory, treated as hostile input: an object map or an
// array, entries missing required fields dropped, https-only inbox URLs.
export function normalizeDirectory (payload, { app } = {}) {
  const rows = Array.isArray(payload)
    ? payload
    : Object.entries(payload || {}).map(([key, value]) => ({ key, ...(value || {}) }));

  const seen = new Set();
  return rows
    .map((row) => {
      const inboxUrl = typeof row?.inboxUrl === 'string' ? row.inboxUrl.trim() : '';
      if (!/^https:\/\//i.test(inboxUrl)) return null;
      const handle = String(row?.handle || row?.key || '').trim();
      if (!handle || seen.has(handle)) return null;
      seen.add(handle);
      return {
        handle: handle.slice(0, 40),
        name: String(row?.name || handle).slice(0, 120),
        app: row?.app || app || 'another app',
        avatarUrl: typeof row?.avatarUrl === 'string' && /^https:\/\//i.test(row.avatarUrl) ? row.avatarUrl : null,
        inboxUrl
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Hide people already connected or already asked, so the list only shows
// people you could actually add.
export function filterDirectory (entries, { search = '', excludeInboxUrls = [], excludeHandles = [] } = {}) {
  const term = search.trim().toLowerCase();
  const inboxes = new Set(excludeInboxUrls.filter(Boolean));
  const handles = new Set(excludeHandles.filter(Boolean));
  return (entries || []).filter((entry) => {
    if (inboxes.has(entry.inboxUrl) || handles.has(entry.handle)) return false;
    if (!term) return true;
    return entry.name.toLowerCase().includes(term) || entry.handle.toLowerCase().includes(term);
  });
}
