// The Letterboxd sync — the half of letterboxdSync.js that talks to the
// network and the database. Lives inside the newsletter Lambda
// (cinemaroll-newsletter) rather than a function of its own: that Lambda
// already holds the service-account key and the account sweep, and a new
// function would have needed the key copied by hand (2026-09-29).
//
// Three entry points, all called from newsletter.js's handler:
//
//   sweep({ mode: 'reviews' })  every 6 hours: every connected account's RSS
//                               feed -> <topKey>/letterboxd/reviews, plus film
//                               stats for the films in those feeds.
//   sweep({ mode: 'films' })    daily: the same, then a capped backfill of
//                               letterboxdFilms/<tmdbId> across each connected
//                               library (never-fetched first, then stalest).
//   syncAccount / filmOnDemand  the HTTP routes: "Sync now" in Settings, and a
//                               film page asking for one film's stats.
//
// Manners: an identifying User-Agent, one request at a time, a pause between
// film pages, a stop after three consecutive failures, and a week before a
// failed film is tried again (filmsDue). Matt: "I don't want to get in
// trouble. But I don't mind if it just fails at some point."

const {
  parseRss,
  reviewsUpdate,
  parseFilmPage,
  filmsDue,
  libraryTmdbIds,
  FILM_MAX_AGE_MS
} = require('./letterboxdSync.js');

const USER_AGENT = 'CinemaRoll/1.0 (+https://www.cinemaroll.org; syncs a member\'s own public feed and film ratings)';
const PAUSE_MS = 1200;
const CONSECUTIVE_FAILURE_LIMIT = 3;
const DEADLINE_MARGIN_MS = 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchPage = async (url) => {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'text/html,application/rss+xml,application/xml;q=0.9,*/*;q=0.8' },
    redirect: 'follow'
  });
  return { status: res.status, url: res.url, text: res.ok ? await res.text() : '' };
};

// --- the member's own feed ----------------------------------------------------

const syncAccount = async ({ topKey, username, db, now, log = () => {} }) => {
  const handle = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_]{1,40}$/i.test(handle)) {
    await db.set(`${topKey}/letterboxd/sync`, { lastAt: now, username: handle, error: 'That does not look like a Letterboxd username' });
    return { topKey, error: 'bad username' };
  }

  const feed = await fetchPage(`https://letterboxd.com/${encodeURIComponent(handle)}/rss/`);
  if (feed.status !== 200 || !/<rss/i.test(feed.text)) {
    const error = feed.status === 404 ? `No Letterboxd member called ${handle}` : `Feed unavailable (${feed.status})`;
    await db.set(`${topKey}/letterboxd/sync`, { lastAt: now, username: handle, error });
    log(`Letterboxd feed for ${topKey} (${handle}): ${error}`);
    return { topKey, error };
  }

  const items = parseRss(feed.text);
  const update = reviewsUpdate(items, now);
  if (Object.keys(update).length) await db.patch(`${topKey}/letterboxd/reviews`, update);
  await db.set(`${topKey}/letterboxd/sync`, {
    lastAt: now,
    username: handle,
    count: items.length,
    reviews: items.filter((item) => item.review).length
  });
  return { topKey, count: items.length, tmdbIds: [...new Set(items.map((item) => item.tmdbId))] };
};

// --- film pages ---------------------------------------------------------------

// One film's public stats. Throws on a block or a network failure (so the
// caller can count failures and stop); resolves { missing: true } when
// Letterboxd simply has no film for that TMDB id.
const fetchFilm = async (tmdbId) => {
  const page = await fetchPage(`https://letterboxd.com/tmdb/${Number(tmdbId)}/`);
  if (page.status === 404) return { missing: true };
  if (page.status !== 200) throw new Error(`Letterboxd answered ${page.status}`);
  // An unknown TMDB id answers 200 at the /tmdb/ URL itself — no redirect to
  // a film page — so the final URL, not the status, says whether it exists.
  if (!/\/film\//.test(page.url)) return { missing: true };
  const stats = parseFilmPage(page.text);
  if (!stats) throw new Error('Not a film page (challenge or layout change)');
  return stats;
};

const filmRecord = (stats, now) => {
  if (stats.missing) return { missing: true, fetchedAt: now };
  return {
    slug: stats.slug,
    title: stats.title || null,
    rating: stats.rating,
    ratingCount: stats.ratingCount,
    fans: stats.fans,
    fetchedAt: now
  };
};

// Fetch what's due among `tmdbIds`, politely, until the cap, the deadline or
// three failures in a row. `existing` is the letterboxdFilms map (or the
// subset the caller has); pass a `deadline` (ms epoch) from the Lambda's
// remaining time so a long backfill ends cleanly instead of being killed.
const refreshFilms = async ({ tmdbIds, existing, db, now, cap, deadline = Infinity, log = () => {} }) => {
  const due = filmsDue(tmdbIds, existing, now, { cap });
  const result = { due: due.length, fetched: 0, missing: 0, failed: 0, stopped: null };
  let consecutiveFailures = 0;

  for (let index = 0; index < due.length; index += 1) {
    if (Date.now() > deadline - DEADLINE_MARGIN_MS) { result.stopped = 'deadline'; break; }
    const tmdbId = due[index];
    try {
      const stats = await fetchFilm(tmdbId);
      await db.set(`letterboxdFilms/${tmdbId}`, filmRecord(stats, Date.now()));
      if (stats.missing) result.missing += 1; else result.fetched += 1;
      consecutiveFailures = 0;
    } catch (error) {
      result.failed += 1;
      consecutiveFailures += 1;
      log(`Letterboxd film ${tmdbId} failed: ${error.message}`);
      const previous = (existing || {})[tmdbId] || {};
      await db.set(`letterboxdFilms/${tmdbId}`, { ...previous, failedAt: Date.now(), failure: String(error.message).slice(0, 120) });
      if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT) { result.stopped = 'failures'; break; }
    }
    if (index < due.length - 1) await sleep(PAUSE_MS);
  }
  return result;
};

// The HTTP route behind a film page: answer from the cache when it's fresh,
// otherwise fetch one film now. Never throws — a page must render without it.
const filmOnDemand = async ({ tmdbId, db, now, log = () => {} }) => {
  const id = Number(tmdbId);
  if (!Number.isInteger(id) || id <= 0) return { film: null, error: 'bad tmdbId' };
  const cached = await db.get(`letterboxdFilms/${id}`).catch(() => null);
  if (cached?.fetchedAt && now - cached.fetchedAt < FILM_MAX_AGE_MS) return { film: cached, cached: true };
  if (cached?.failedAt && now - cached.failedAt < 6 * 60 * 60 * 1000) return { film: cached, cached: true };
  try {
    const record = filmRecord(await fetchFilm(id), now);
    await db.set(`letterboxdFilms/${id}`, record);
    return { film: record, cached: false };
  } catch (error) {
    log(`Letterboxd film ${id} on demand failed: ${error.message}`);
    await db.set(`letterboxdFilms/${id}`, { ...(cached || {}), failedAt: now, failure: String(error.message).slice(0, 120) }).catch(() => {});
    return { film: cached || null, error: error.message };
  }
};

// --- the sweep ----------------------------------------------------------------

const REVIEW_MODE_FILM_CAP = 40;
const FILM_MODE_CAP = 180;

const sweep = async ({ mode = 'reviews', accounts, db, now = Date.now(), deadline = Infinity, log = console.log }) => {
  const results = [];
  const feedFilmIds = new Set();
  const connected = [];

  for (const topKey of accounts) {
    const username = await db.get(`${topKey}/settings/letterboxdUsername`).catch(() => null);
    if (!username) continue;
    connected.push(topKey);
    try {
      const result = await syncAccount({ topKey, username, db, now, log });
      results.push(result);
      for (const id of result.tmdbIds || []) feedFilmIds.add(id);
    } catch (error) {
      log(`Letterboxd sync for ${topKey} failed: ${error.message}`);
      results.push({ topKey, error: error.message });
    }
    await sleep(PAUSE_MS);
  }

  const existing = (await db.get('letterboxdFilms').catch(() => null)) || {};
  const films = { feed: null, library: null };
  films.feed = await refreshFilms({ tmdbIds: [...feedFilmIds], existing, db, now, cap: REVIEW_MODE_FILM_CAP, deadline, log });

  if (mode === 'films') {
    const libraryIds = new Set();
    for (const topKey of connected) {
      const movieLog = await db.get(`${topKey}/movieLog`).catch(() => null);
      for (const id of libraryTmdbIds(movieLog)) libraryIds.add(id);
    }
    films.library = await refreshFilms({ tmdbIds: [...libraryIds], existing, db, now, cap: FILM_MODE_CAP, deadline, log });
  }

  return { mode, accounts: results, films };
};

module.exports = { sweep, syncAccount, refreshFilms, filmOnDemand, fetchFilm, USER_AGENT };
