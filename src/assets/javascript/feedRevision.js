// The Film Club feed's `revision`: a 32-character lowercase hex token that
// changes whenever the published body changes and stays put when it does not
// (Brian's Movie Log sync guide, 2026-10-06). A reader fetches the tiny
// `/revision.json` child first and downloads the body only when it moved.
//
// Derived from the content rather than drawn at random so an identical
// republish keeps the same token — otherwise every open of the app would
// cost every friend a full download. Four FNV-1a passes with different
// seeds; not cryptographic, and it doesn't need to be: it only has to move
// when the body moves. Twin of aws-lambda/feedRevision.js (CommonJS) — keep
// them identical; feedRevision.test.js checks they agree.
const SEEDS = [0x811c9dc5, 0x01000193, 0x9e3779b9, 0x7f4a7c15];

function fnv1a (text, seed) {
  let hash = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** What the revision covers: who, from where, and the movies — not the marker. */
export function revisionSubject (feed) {
  return JSON.stringify({ source: feed?.source ?? null, name: feed?.name ?? null, movies: feed?.movies ?? [] });
}

export function contentRevision (feed) {
  const text = revisionSubject(feed);
  return SEEDS.map((seed) => fnv1a(text, seed).toString(16).padStart(8, '0')).join('');
}

export const REVISION_PATTERN = /^[0-9a-f]{32}$/;

/** `.../clubFeed/OWNER/SECRET.json[?q]` → `.../clubFeed/OWNER/SECRET/revision.json[?q]`, else null. */
export function revisionUrlFor (feedUrl) {
  const match = /^(https:\/\/[^?#]+)\.json(\?[^#]*)?$/.exec(String(feedUrl || ''));
  return match ? `${match[1]}/revision.json${match[2] || ''}` : null;
}
