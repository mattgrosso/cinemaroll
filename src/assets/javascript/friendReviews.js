// Friends' written Letterboxd reviews (2026-11-17). Report: "Is there any way
// to get my friends reviews from letterbox? I have their star ratings from
// their app, but ... is there any way to get their actual written reviews".
//
// The newsletter Lambda's Letterboxd sweep reads each friend's public feed
// and keeps the entries with words in the READER's own account (friends'
// branches are private, so nothing here ever reads one):
//
//   <topKey>/letterboxd/friends/<friendKey>
//     { username, source: 'account' | 'typed', syncedAt, error?,
//       reviews: { <tmdbId>: { <reviewId>: { review, watchedDate?, url?, spoilers?, rewatch? } } } }
//
// `source` says where the username came from: 'account' when a Cinema Roll
// friend connected their own, 'typed' when the reader set one on the friend's
// Film Club page (settings/friendLetterboxd/<friendKey>) — the only way for a
// friend on another app. Pure; the Lambda keeps a copy of the normalizer
// (aws-lambda/letterboxdSync.js) and friendReviews.test.js holds them together.
import { friendsWhoRated } from './friendViewings.js';

// "letterboxd.com/Name/", "@name" or "name" -> "name"; null when it can't be one.
export function normalizeLetterboxdUsername (text) {
  let value = String(text || '').trim();
  const fromUrl = /letterboxd\.com\/([^/?#\s]+)/i.exec(value);
  if (fromUrl) value = fromUrl[1];
  value = value.replace(/^@/, '').toLowerCase();
  return /^[a-z0-9_]{1,40}$/.test(value) ? value : null;
}

// One friend's reviews of one film, newest viewing first.
export function friendReviewsFor (friendLetterboxd, friendKey, tmdbId) {
  if (tmdbId == null || tmdbId === '') return [];
  const node = friendLetterboxd?.[friendKey]?.reviews?.[String(tmdbId)];
  if (!node || typeof node !== 'object') return [];
  return Object.entries(node)
    .filter(([, entry]) => entry && String(entry.review || '').trim())
    .map(([id, entry]) => ({
      id,
      review: String(entry.review).trim(),
      watchedDate: entry.watchedDate || null,
      url: entry.url || null,
      spoilers: Boolean(entry.spoilers),
      rewatch: Boolean(entry.rewatch)
    }))
    .sort((a, b) => String(b.watchedDate || '').localeCompare(String(a.watchedDate || '')) || a.id.localeCompare(b.id));
}

// The club's lines for a film page: everyone who rated it (friendsWhoRated's
// order and shape), each with their `reviews`, then anyone who reviewed it on
// Letterboxd without a rating here, with no score (stars null, score null).
export function clubLinesFor (friends, friendLetterboxd, tmdbId) {
  const rated = friendsWhoRated(friends, tmdbId)
    .map((line) => ({ ...line, reviews: friendReviewsFor(friendLetterboxd, line.key, tmdbId) }));
  const seen = new Set(rated.map((line) => line.key));
  const reviewedOnly = (friends || [])
    .map((friend) => ({ key: friend?.key ?? friend?.name, name: friend?.name || 'A friend' }))
    .filter((friend) => friend.key != null && !seen.has(friend.key))
    .map((friend) => ({ ...friend, score: null, stars: null, reviews: friendReviewsFor(friendLetterboxd, friend.key, tmdbId) }))
    .filter((line) => line.reviews.length)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...rated, ...reviewedOnly];
}

// What a friend's page says about their Letterboxd link.
export function friendLetterboxdStatus (friendLetterboxd, friendKey) {
  const node = friendLetterboxd?.[friendKey];
  if (!node) return null;
  let count = 0;
  for (const entries of Object.values(node.reviews || {})) count += Object.keys(entries || {}).length;
  return {
    username: node.username || null,
    source: node.source || null,
    count,
    error: node.error || null,
    syncedAt: node.syncedAt || null
  };
}
