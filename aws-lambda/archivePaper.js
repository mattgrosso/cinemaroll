// From the archive, for Newsprinted (Matt, 2026-10-28: "it'd be fun to get
// movie reviews for some of my favorite movies from the past, like
// contemporaneous reviews, just pop up as sort of archive entries", and then:
// "a large pool of possibilities to pull from … at a normal interval …
// like a newspaper would be publishing them").
//
// The pool is the critics' reviews the movie page already finds and stores
// (criticReviews.js, cinemaroll-film-reviews), kept to films he rated 8.5 or
// higher that are at least five years old. Each morning the newsletter Lambda
// asks the AI Lambda for what is stored for those films (and, when
// ARCHIVE_LOOKUPS is above 0, has it look up that many more), and every
// review not yet in the pool becomes one story at /archive/<FEED_TOKEN>. The
// paper holds the pool and lets out a few a day; this side only fills it.
//
// Pure: the Lambda wiring is in newsletter.js.

const MIN_RATING = 8.5;
const MIN_AGE_YEARS = 5;
const POOL_SIZE = 150; // the paper remembers 400 ids a feed, so the list stays well under
const TZ = 'America/New_York';

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** The films he loves, old enough to have an archive: [{ tmdbId, title, year, releaseDate, rating }], best first. */
function favorites (rows, now = Date.now()) {
  const thisYear = new Date(now).getFullYear();
  const byFilm = new Map();
  for (const r of rows) {
    const tmdbId = Number(r.movie?.id);
    if (!Number.isInteger(tmdbId) || tmdbId <= 0 || !r.year) continue;
    const have = byFilm.get(tmdbId);
    if (!have || r.rating > have.rating) byFilm.set(tmdbId, { tmdbId, title: r.title, year: r.year, releaseDate: r.movie?.release_date || '', rating: r.rating });
  }
  return [...byFilm.values()]
    .filter((f) => f.rating >= MIN_RATING && f.year <= thisYear - MIN_AGE_YEARS)
    .sort((a, b) => b.rating - a.rating || a.tmdbId - b.tmdbId);
}

const monthDay = (t) => new Date(t).toLocaleDateString('en-CA', { timeZone: TZ }).slice(5);
/** Whether the film's release date comes round in the next week. */
function anniversarySoon (film, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(film.releaseDate || '')) return false;
  const md = film.releaseDate.slice(5, 10);
  for (let d = 0; d < 7; d += 1) if (monthDay(now + d * 864e5) === md) return true;
  return false;
}

/** Which films without stored reviews to look up next: anniversaries this week, then the best rated. */
function lookupOrder (films, storedIds, now = Date.now()) {
  const missing = films.filter((f) => !storedIds.has(String(f.tmdbId)));
  return [...missing.filter((f) => anniversarySoon(f, now)), ...missing.filter((f) => !anniversarySoon(f, now))];
}

const ROLE_LEAD = { release: '', revisit: 'Looking back: ', dissent: 'Against the grain: ' };
const voiceOf = (review) => (review.critic && !/^staff/i.test(review.critic) ? review.critic : review.outlet || 'A critic');
const slug = (url) => String(url).replace(/^https?:\/\/(www\.)?/, '').replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 80);

/** One review as a story for the paper. */
function reviewItem (film, review, now = Date.now()) {
  const when = review.year ? `, ${review.year}` : '';
  const byline = [review.critic && !/^staff/i.test(review.critic) ? review.critic : '', review.outlet].filter(Boolean).join(', ');
  return {
    id: `archive-${film.tmdbId}-${slug(review.url)}`,
    url: review.url,
    title: `${ROLE_LEAD[review.role] || ''}${voiceOf(review)} on ${film.title}${when}`,
    content_html: `<p>${escapeHtml(review.summary)}</p>`
      + `<p><a href="${escapeHtml(review.url)}">Read the review${review.outlet ? ` at ${escapeHtml(review.outlet)}` : ''}${review.paywalled ? ' (paywalled)' : ''}</a></p>`
      + `<p><small>From the archive: ${escapeHtml(byline || voiceOf(review))}${when} · ${escapeHtml(film.title)} (${film.year}), which you rated ${film.rating}.</small></p>`,
    date_published: new Date(now).toISOString()
  };
}

/** The pool after adding every stored review not in it yet, newest first, capped. */
function addToPool (pool, films, storedById, now = Date.now()) {
  const have = new Set((pool || []).map((i) => i.id));
  const added = [];
  for (const film of films) {
    for (const review of storedById[String(film.tmdbId)] || []) {
      if (!review?.url || !review.summary) continue;
      const item = reviewItem(film, review, now);
      if (have.has(item.id)) continue;
      have.add(item.id);
      added.push(item);
    }
  }
  return { items: [...added, ...(pool || [])].slice(0, POOL_SIZE), added: added.length };
}

module.exports = { favorites, anniversarySoon, lookupOrder, reviewItem, addToPool, MIN_RATING, POOL_SIZE };
