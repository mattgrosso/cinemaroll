// The Film Club page for Newsprinted (Matt, 2026-10-27: "I would love to get
// Letterboxd reviews in there. That's fun. And awards. I think there's a lot
// of stuff in Cinema Roll that we could probably bring over"): one JSON Feed
// of what the reader's friends have been up to, served by newsletter.js at
// /club/<FEED_TOKEN> for the account FEED_ACCOUNT names (never "the first
// account": a feed of personal data has to say whose it is).
//
// Four kinds of item, each with a stable id so the reader shows it once:
//   log      a Cinema Roll friend rated a film (their movieLog; the keys of
//            that node start with the entry's creation time, so a shallow
//            read finds the new entries without downloading the library —
//            a rewatch added to an old entry is the one thing this misses)
//   review   a friend's Letterboxd review (their synced letterboxd/reviews,
//            only entries with words)
//   awards   a friend's awards board for a year, when they last touched it
//   external a Movie Log friend's log (their film-club feed, read only when
//            its revision changed, and remembered under paper/club so the
//            friend's Firebase bill isn't charged for every reader fetch)
//
// Pure builders take data and hand back items; `buildClubFeed` does the I/O
// through the handles it is given, so the tests need no network.

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 21;
const MAX_ITEMS = 40;
const EXTERNAL_RECHECK_MS = 60 * 60 * 1000;
const SKIP_ACCOUNTS = new Set(['cinemaroll-tester-example-com']);

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const firstName = (name) => String(name || '').trim().split(/\s+/)[0] || 'A friend';
const iso = (ms) => new Date(ms).toISOString();
const stars = (n) => {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '';
  return `${'★'.repeat(Math.floor(v))}${v % 1 >= 0.5 ? '½' : ''}`;
};
const CATEGORY_LABEL = {
  bestPicture: 'Best Picture', bestDirector: 'Best Director', bestActor: 'Best Actor', bestActress: 'Best Actress',
  bestSupportingActor: 'Best Supporting Actor', bestSupportingActress: 'Best Supporting Actress', bestScreenplay: 'Best Screenplay',
  bestCinematography: 'Best Cinematography', bestEditing: 'Best Editing', bestScore: 'Best Score', bestVisualEffects: 'Best Visual Effects',
  bestAnimatedFeature: 'Best Animated Feature', bestDocumentaryFeature: 'Best Documentary', bestInternationalFeature: 'Best International Feature',
  mostImportantMovie: 'Most Important Movie'
};
const categoryLabel = (key) => CATEGORY_LABEL[key] || key.replace(/^best/, 'Best ').replace(/([a-z])([A-Z])/g, '$1 $2');
const movieUrl = (tmdbId) => (Number.isFinite(Number(tmdbId)) && Number(tmdbId) > 0 ? `https://www.cinemaroll.org/movie/${Number(tmdbId)}` : 'https://www.cinemaroll.org/film-club');

/** A friend's Cinema Roll log entries rated since `since`: one item per viewing. Pure. */
function logItems ({ key, name, entries }, since) {
  const out = [];
  for (const [entryKey, entry] of Object.entries(entries || {})) {
    const movie = entry?.movie || {};
    (entry?.ratings || []).forEach((r, index) => {
      const at = Number(r?.date);
      if (!Number.isFinite(at) || at < since) return;
      const title = r.title || movie.title || 'a film';
      const year = r.year || (movie.release_date || '').slice(0, 4);
      const score = Number(r.rating);
      const bits = [];
      if (r.medium) bits.push(`On ${esc(r.medium)}.`);
      if (Number.isFinite(score)) bits.push(`Rated it ${score.toFixed(1)} out of 10.`);
      const tags = (r.tags || []).map((t) => t?.title).filter(Boolean);
      if (tags.length) bits.push(`Tagged ${esc(tags.join(', '))}.`);
      out.push({
        id: `log-${key}-${entryKey}-${index}`,
        url: movieUrl(r.id || movie.id),
        title: `${firstName(name)} watched ${title}${year ? ` (${year})` : ''}`,
        content_html: `<p>${bits.join(' ') || 'Logged it.'}</p>`,
        date_published: iso(at),
        image: movie.poster_path ? `https://image.tmdb.org/t/p/w500${movie.poster_path}` : undefined
      });
    });
  }
  return out;
}

/** A friend's Letterboxd reviews with words, since `since`. Pure. */
function reviewItems ({ key, name, reviews }, since) {
  const out = [];
  for (const [tmdbId, byDate] of Object.entries(reviews || {})) {
    for (const [entryKey, e] of Object.entries(byDate || {})) {
      if (!e?.review) continue;
      const at = Date.parse(e.publishedAt || `${e.watchedDate || ''}T12:00:00Z`);
      if (!Number.isFinite(at) || at < since) continue;
      const rating = stars(e.rating);
      const paras = String(e.review).split(/\n\s*\n/).map((p) => `<p>${esc(p)}</p>`).join('');
      out.push({
        id: `review-${key}-${tmdbId}-${entryKey}`,
        url: e.url || movieUrl(tmdbId),
        title: `${firstName(name)} on ${e.title || 'a film'}${e.year ? ` (${e.year})` : ''}${rating ? `: ${rating}` : ''}`,
        content_html: `${e.spoilers ? '<p><i>Spoilers.</i></p>' : ''}${paras}`,
        date_published: iso(at)
      });
    }
  }
  return out;
}

/** A friend's awards board for one year, as touched at `lastUpdated`. `titleOf` names a TMDB id. Pure. */
function awardsItem ({ key, name, year, board }, titleOf) {
  const at = Number(board?.lastUpdated);
  if (!Number.isFinite(at)) return null;
  const lines = [];
  let picture = null;
  for (const [cat, c] of Object.entries(board.categories || {})) {
    const w = c?.winner;
    if (!w || c.noNominees) continue;
    const film = titleOf(w.movieId) || null;
    const who = w.type === 'person' || w.name ? `${esc(w.name || w.id)}${film ? ` <i>(${esc(film)})</i>` : ''}` : film ? esc(film) : null;
    if (!who) continue;
    if (cat === 'bestPicture') picture = film;
    lines.push(`<p><b>${esc(categoryLabel(cat))}</b> · ${who}</p>`);
  }
  if (!lines.length) return null;
  return {
    id: `awards-${key}-${year}-${at}`,
    url: `https://www.cinemaroll.org/awards?year=${encodeURIComponent(year)}`,
    title: `${firstName(name)}'s ${year} awards${picture ? `: ${picture} for Best Picture` : ''}${board.completed ? '' : ' (so far)'}`,
    content_html: lines.join(''),
    date_published: iso(at)
  };
}

/** A Movie Log friend's recent logs from their film-club feed watches. Pure. */
function externalItems ({ id, name, watches }, since) {
  return (watches || []).filter((w) => Number.isFinite(Number(w.watchedAt)) && Number(w.watchedAt) >= since).map((w) => ({
    id: `external-${id}-${w.tmdbId || w.title}-${w.watchedAt}`,
    url: movieUrl(w.tmdbId),
    title: `${firstName(name)} logged ${w.title}`,
    content_html: `<p>${Number.isFinite(Number(w.score)) ? `Rated it ${Number(w.score).toFixed(2)} out of 10.` : 'Logged it.'}</p>`,
    date_published: iso(Number(w.watchedAt))
  }));
}

const sortNewest = (items) => items.sort((a, b) => String(b.date_published).localeCompare(String(a.date_published)));

/**
 * The whole feed for one account. `db` is { get(path), set(path, value) };
 * `readExternal(feedUrl, cached)` returns { revision, watches } or null;
 * `titleOf(tmdbId)` is async and may return null.
 */
async function buildClubFeed ({ topKey, db, readExternal, titleOf, now = Date.now(), log = () => {} }) {
  const since = now - WINDOW_DAYS * DAY;
  const items = [];
  const friendKeys = Object.keys((await db.get(`social/friends/${topKey}`).catch(() => null)) || {}).filter((k) => !SKIP_ACCOUNTS.has(k));
  const names = {};
  for (const key of friendKeys) {
    names[key] = (await db.get(`social/directory/${key}/name`).catch(() => null)) || (await db.get(`${key}/settings/social/displayName`).catch(() => null)) || 'A friend';
  }

  // Logs: shallow keys first, the entries that may be new second.
  for (const key of friendKeys) {
    try {
      const keys = Object.keys((await db.get(`${key}/movieLog`, 'shallow=true')) || {});
      const fresh = keys.filter((k) => Number(k.split('-')[0]) >= since);
      const entries = {};
      for (const k of fresh) entries[k] = await db.get(`${key}/movieLog/${k}`);
      items.push(...logItems({ key, name: names[key], entries }, since));
    } catch (error) {
      log(`club paper: ${key} log read failed: ${error.message}`);
    }
  }

  // Letterboxd reviews of the friends who connected an account.
  for (const key of friendKeys) {
    try {
      const username = await db.get(`${key}/settings/letterboxdUsername`);
      if (!username) continue;
      items.push(...reviewItems({ key, name: names[key], reviews: await db.get(`${key}/letterboxd/reviews`) }, since));
    } catch (error) {
      log(`club paper: ${key} reviews read failed: ${error.message}`);
    }
  }

  // Awards boards touched in the window.
  const titles = {};
  const nameOf = async (id) => {
    if (!Number.isFinite(Number(id))) return null;
    if (!(id in titles)) titles[id] = await titleOf(Number(id)).catch(() => null);
    return titles[id];
  };
  for (const key of friendKeys) {
    try {
      const years = Object.keys((await db.get(`${key}/personalAwards`, 'shallow=true')) || {});
      for (const year of years) {
        const at = Number(await db.get(`${key}/personalAwards/${year}/lastUpdated`));
        if (!Number.isFinite(at) || at < since) continue;
        const board = await db.get(`${key}/personalAwards/${year}`);
        const ids = new Set(Object.values(board?.categories || {}).map((c) => c?.winner?.movieId).filter((v) => Number.isFinite(Number(v))));
        const resolved = {};
        for (const id of ids) resolved[id] = await nameOf(id);
        const item = awardsItem({ key, name: names[key], year, board }, (id) => resolved[id] || null);
        if (item) items.push(item);
      }
    } catch (error) {
      log(`club paper: ${key} awards read failed: ${error.message}`);
    }
  }

  // Movie Log friends: their feed, read when its revision moved, remembered.
  const external = (await db.get(`${topKey}/settings/externalFriends`).catch(() => null)) || {};
  for (const [id, friend] of Object.entries(external)) {
    if (!friend?.feedUrl) continue;
    try {
      const cachePath = `${topKey}/paper/club/external/${id}`;
      const cached = (await db.get(cachePath).catch(() => null)) || null;
      let watches = cached?.watches || [];
      if (!cached || now - Number(cached.checkedAt || 0) > EXTERNAL_RECHECK_MS) {
        const read = await readExternal(friend.feedUrl, cached);
        if (read) {
          watches = read.watches;
          await db.set(cachePath, { revision: read.revision || null, watches: watches.slice(0, 40), checkedAt: now });
        } else if (cached) {
          await db.set(`${cachePath}/checkedAt`, now);
        }
      }
      items.push(...externalItems({ id, name: friend.name, watches }, since));
    } catch (error) {
      log(`club paper: external ${id} failed: ${error.message}`);
    }
  }

  return {
    version: 'https://jsonfeed.org/version/1.1',
    title: 'Film Club',
    home_page_url: 'https://www.cinemaroll.org/film-club',
    items: sortNewest(items).slice(0, MAX_ITEMS)
  };
}

module.exports = { buildClubFeed, logItems, reviewItems, awardsItem, externalItems, WINDOW_DAYS };
