// CommonJS twin of src/assets/javascript/feedRevision.js — keep identical.
// The end-of-day copy filters viewings, so its body differs from the live
// feed and needs its own revision.
const SEEDS = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x7f4a7c15];

function fnv1a (text, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function revisionSubject (feed) {
  // The ceremony name (2026-10-08) only when there is one, so a feed without
  // it keeps exactly the token it always had.
  const awardsName = typeof feed?.awardsName === 'string' && feed.awardsName ? { awardsName: feed.awardsName } : {};
  return JSON.stringify({ source: feed?.source ?? null, name: feed?.name ?? null, ...awardsName, movies: feed?.movies ?? [] });
}

function contentRevision (feed) {
  const text = revisionSubject(feed);
  return SEEDS.map((seed) => fnv1a(text, seed).toString(16).padStart(8, '0')).join('');
}

module.exports = { contentRevision, revisionSubject };
