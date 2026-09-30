// Letterboxd, read the polite way (2026-09-29). Pure and dependency-free
// CommonJS, like pushCadence.js — everything here is testable from vitest and
// nothing here touches the network or the database.
//
// Two public sources, both allowed by letterboxd.com/robots.txt for any
// crawler, both fetched with an honest User-Agent and a pause between calls:
//
//   1. The member's own RSS feed, letterboxd.com/<username>/rss/ — the last
//      ~50 diary entries with watched date, star rating, rewatch flag, the
//      REVIEW TEXT and the TMDB id. This is how "my reviews" reach Cinema Roll.
//      It carries only recent entries; the backfill is the CSV export the
//      client imports (letterboxdFormat.js).
//   2. A film page's structured data: letterboxd.com/tmdb/<id>/ redirects to
//      the film, whose <script type="application/ld+json"> holds the weighted
//      average rating and rating count, and whose header shows the fan count.
//      Watch/list/like counts and the histogram load from a fragment behind
//      Cloudflare's JS challenge and are out of reach — don't try.
//
// The official API is partner-only; the stub in src/services/LetterboxdService.js
// never got keys and this is the replacement. Matt (2026-09-29): "I don't want
// to get in trouble. But I don't mind if it just fails at some point." So the
// sweep stops after three consecutive failures and never retries hot.

const decodeEntities = (text) => String(text || '')
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&quot;/g, '"')
  .replace(/&apos;/g, "'")
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&');

const tagText = (block, tag) => {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(block);
  if (!match) return null;
  return decodeEntities(match[1].replace(/^\s*<!\[CDATA\[/, '').replace(/\]\]>\s*$/, '')).trim();
};

const SPOILER_NOTICE = /this review may contain spoilers/i;
// A plain watch (no review) carries one boilerplate paragraph, "Watched on
// Monday September 21, 2026." — that's the date we already have, not a review.
const WATCHED_ON_NOTICE = /^Watched on [A-Za-z]+,? [A-Za-z]+ \d{1,2},? \d{4}\.?$/;

// The description is HTML: a poster paragraph, then the review paragraphs,
// with Letterboxd's spoiler notice as its own paragraph when the member set
// the flag. Returns plain text with a blank line between paragraphs.
const reviewFromDescription = (description) => {
  const html = String(description || '');
  const paragraphs = [];
  let spoilers = false;
  const paragraphPattern = /<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g;
  let match;
  while ((match = paragraphPattern.exec(html)) !== null) {
    const inner = match[1];
    if (/<img\b/i.test(inner) && !inner.replace(/<img\b[^>]*>/gi, '').trim()) continue;
    const text = decodeEntities(inner.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')).trim();
    if (!text) continue;
    if (SPOILER_NOTICE.test(text)) { spoilers = true; continue; }
    if (WATCHED_ON_NOTICE.test(text)) continue;
    paragraphs.push(text);
  }
  return { review: paragraphs.join('\n\n'), spoilers };
};

const parseGuid = (guid) => {
  const match = /^letterboxd-(review|watch|list)-(\d+)$/.exec(String(guid || '').trim());
  return match ? { kind: match[1], id: match[2] } : null;
};

// Diary entries only (reviews and plain watches); lists are in the same feed
// and carry no film. Every returned item has a tmdbId.
const parseRss = (xml) => {
  const items = [];
  const itemPattern = /<item>([\s\S]*?)<\/item>/g;
  let match;
  while ((match = itemPattern.exec(String(xml || ''))) !== null) {
    const block = match[1];
    const guid = parseGuid(tagText(block, 'guid'));
    if (!guid || guid.kind === 'list') continue;
    const tmdbId = Number(tagText(block, 'tmdb:movieId'));
    if (!tmdbId) continue;

    const ratingText = tagText(block, 'letterboxd:memberRating');
    const rating = ratingText === null || ratingText === '' ? null : Number(ratingText);
    const pubDate = tagText(block, 'pubDate');
    const publishedAt = pubDate ? Date.parse(pubDate) : NaN;
    const { review, spoilers } = reviewFromDescription(tagText(block, 'description'));

    items.push({
      reviewId: `${guid.kind}-${guid.id}`,
      kind: guid.kind,
      tmdbId,
      title: tagText(block, 'letterboxd:filmTitle') || '',
      year: Number(tagText(block, 'letterboxd:filmYear')) || null,
      rating: Number.isFinite(rating) ? rating : null,
      watchedDate: tagText(block, 'letterboxd:watchedDate') || null,
      rewatch: /^yes$/i.test(tagText(block, 'letterboxd:rewatch') || ''),
      liked: /^yes$/i.test(tagText(block, 'letterboxd:memberLike') || ''),
      review,
      spoilers,
      url: tagText(block, 'link') || null,
      publishedAt: Number.isFinite(publishedAt) ? publishedAt : null
    });
  }
  return items;
};

// One RTDB multi-path PATCH body for `<topKey>/letterboxd/reviews`: keys are
// "<tmdbId>/<reviewId>", so a re-run rewrites the same nodes and nothing is
// duplicated. Firebase drops nulls, which is what we want for absent fields.
const reviewsUpdate = (items, now) => {
  const update = {};
  for (const item of items) {
    const value = {
      source: 'rss',
      kind: item.kind,
      title: item.title,
      year: item.year,
      rating: item.rating,
      watchedDate: item.watchedDate,
      rewatch: item.rewatch || null,
      liked: item.liked || null,
      review: item.review || null,
      spoilers: item.spoilers || null,
      url: item.url,
      publishedAt: item.publishedAt,
      syncedAt: now
    };
    for (const key of Object.keys(value)) if (value[key] === null || value[key] === undefined) delete value[key];
    update[`${item.tmdbId}/${item.reviewId}`] = value;
  }
  return update;
};

// "61K fans" -> 61000. Letterboxd rounds; we keep the rounding.
const parseCompactCount = (text) => {
  const match = /^([\d.,]+)\s*([KM])?$/i.exec(String(text || '').trim());
  if (!match) return null;
  const base = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(base)) return null;
  const unit = (match[2] || '').toUpperCase();
  return Math.round(base * (unit === 'M' ? 1e6 : unit === 'K' ? 1e3 : 1));
};

// The film page's structured data. Returns null when the page isn't a film
// page (a Cloudflare interstitial, a 404 body) so the caller records a miss
// rather than a film with no rating.
const parseFilmPage = (html) => {
  const page = String(html || '');
  const url = /<meta property="og:url" content="https:\/\/letterboxd\.com\/film\/([^/"]+)\/"/.exec(page);
  if (!url) return null;
  const slug = url[1];
  const title = /<meta property="og:title" content="([^"]*)"/.exec(page);
  const ld = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page);
  let rating = null;
  let ratingCount = null;
  if (ld) {
    const ratingMatch = /"ratingValue":\s*([\d.]+)/.exec(ld[1]);
    const countMatch = /"ratingCount":\s*(\d+)/.exec(ld[1]);
    if (ratingMatch) rating = Number(ratingMatch[1]);
    if (countMatch) ratingCount = Number(countMatch[1]);
  }
  const fansMatch = /([\d.,]+[KM]?)\s+fans\s*<\/a>/i.exec(page);
  return {
    slug,
    title: title ? decodeEntities(title[1]) : null,
    rating: Number.isFinite(rating) ? rating : null,
    ratingCount: Number.isFinite(ratingCount) ? ratingCount : null,
    fans: fansMatch ? parseCompactCount(fansMatch[1]) : null
  };
};

const DAY_MS = 24 * 60 * 60 * 1000;
const FILM_MAX_AGE_MS = 30 * DAY_MS;
const FILM_RETRY_MS = 7 * DAY_MS;

// Which films to (re)fetch this run: never-fetched first, then the stalest,
// capped. A film that failed (blocked, missing) waits FILM_RETRY_MS before
// another try, so a block never turns into a hammering.
const filmsDue = (tmdbIds, existing, now, { cap = 50, maxAge = FILM_MAX_AGE_MS, retry = FILM_RETRY_MS } = {}) => {
  const seen = new Set();
  const due = [];
  for (const raw of tmdbIds || []) {
    const id = Number(raw);
    if (!Number.isInteger(id) || id <= 0 || seen.has(id)) continue;
    seen.add(id);
    const film = (existing || {})[id];
    if (!film) { due.push({ id, at: 0 }); continue; }
    if (film.failedAt && now - film.failedAt < retry) continue;
    if (film.fetchedAt && now - film.fetchedAt < maxAge) continue;
    due.push({ id, at: film.fetchedAt || film.failedAt || 0 });
  }
  return due.sort((a, b) => a.at - b.at).slice(0, cap).map((entry) => entry.id);
};

// The TMDB ids a library holds. Placeholders (negative / non-numeric ids) are
// not films Letterboxd knows.
const libraryTmdbIds = (movieLog) => {
  const ids = new Set();
  for (const entry of Object.values(movieLog || {})) {
    const id = Number(entry?.movie?.id);
    if (Number.isInteger(id) && id > 0) ids.add(id);
  }
  return [...ids];
};

module.exports = {
  parseRss,
  reviewsUpdate,
  parseFilmPage,
  parseCompactCount,
  filmsDue,
  libraryTmdbIds,
  reviewFromDescription,
  FILM_MAX_AGE_MS,
  FILM_RETRY_MS
};
