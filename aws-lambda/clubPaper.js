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
//   awards   a friend's awards board for a year, when they last touched it:
//            every category in the app's order, winner and nominees, under
//            the name they gave their awards (Natalie's Roses)
//   external a Movie Log friend's log (their film-club feed, read only when
//            its revision changed, and remembered under paper/club so the
//            friend's Firebase bill isn't charged for every reader fetch),
//            and their awards: a year whose board changed is told like ours
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
// The app's own categories, in the order its awards page shows them. A copy of
// PERSONAL_AWARD_CATEGORIES (src/assets/javascript/personalAwardsCategories.js);
// clubPaper.test.js fails if the two drift.
const CATEGORIES = [
  ['bestPicture', 'Best Picture', 'movie'], ['bestDirector', 'Best Director', 'person'], ['bestActor', 'Best Actor', 'person'],
  ['bestActress', 'Best Actress', 'person'], ['bestSupportingActor', 'Best Supporting Actor', 'person'],
  ['bestSupportingActress', 'Best Supporting Actress', 'person'], ['bestScreenplay', 'Best Screenplay or Writing', 'movie'],
  ['bestCinematography', 'Best Cinematography', 'movie'], ['bestEditing', 'Best Editing', 'movie'], ['bestScore', 'Best Score or Music', 'movie'],
  ['bestVisualEffects', 'Best Visual Effects or Production Design', 'movie'], ['bestAnimatedFeature', 'Best Animated Feature', 'movie'],
  ['bestDocumentaryFeature', 'Best Documentary Feature', 'movie'], ['bestInternationalFeature', 'Best International Feature', 'movie'],
  ['mostImportantMovie', 'Most Important Movie', 'movie']
].map(([key, name, type]) => ({ key, name, type }));
const CATEGORY_LABEL = Object.fromEntries(CATEGORIES.map((c) => [c.key, c.name]));
const categoryLabel = (key) => CATEGORY_LABEL[key] || key.replace(/^custom-/, '').replace(/^best/, 'Best ').replace(/([a-z])([A-Z])/g, '$1 $2');

// Another app's label onto the house order: a copy of categoryMatchKey and
// houseCategoryRank in src/assets/javascript/awardsShare.js (tested together).
const ALIASES = [
  [/^best (film|motion picture|feature film)$/, 'best picture'],
  [/^best (screenplay|writing)( or (writing|screenplay))?$/, 'best screenplay'],
  [/^best (film )?editing$/, 'best editing'],
  [/^best (original )?(score|music)( or music)?$/, 'best score'],
  [/^best visual effects( or production design)?$/, 'best visual effects'],
  [/^best animated( feature| film| feature film)?$/, 'best animated feature'],
  [/^best documentary( feature| film)?$/, 'best documentary'],
  [/^best (foreign( language)?|international)( feature)?( film)?$/, 'best international feature'],
  [/^best (actor|actress) in a (leading|supporting) role$/, (m, who, role) => `best ${role === 'supporting' ? 'supporting ' : ''}${who}`],
  [/^(best )?(directing|director)$/, 'best director']
];
function categoryMatchKey (label) {
  const base = String(label || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [pattern, replacement] of ALIASES) {
    const match = base.match(pattern);
    if (match) return typeof replacement === 'function' ? replacement(...match) : replacement;
  }
  return base;
}
const HOUSE_ORDER = CATEGORIES.map((c) => categoryMatchKey(c.name));
function houseCategoryRank (label) {
  const key = categoryMatchKey(label);
  if (/^best (picture|motion picture|film)\b/.test(key)) return -1;
  const index = HOUSE_ORDER.indexOf(key);
  return index === -1 ? HOUSE_ORDER.length : index;
}
const PERSON_LABEL = /actor|actress|performance|director|directing|honorary|humanitarian|memorial|special award|breakthrough|newcomer|debut|star of/i;
const HOUSE_KIND = Object.fromEntries(CATEGORIES.map((c) => [categoryMatchKey(c.name), c.type]));
const labelKind = (label) => HOUSE_KIND[categoryMatchKey(label)] || (PERSON_LABEL.test(String(label || '')) ? 'person' : 'movie');

// What a friend calls their awards (Natalie's are "The Roses"): "Roses" for
// "Natalie's 1999 Roses". Placeholders and nothing at all read "awards".
const PLACEHOLDER_CEREMONY = /^(the |my )?(personal )?(awards?|oscars?)$/i;
function ceremonyWord (name) {
  const text = typeof name === 'string' ? name.trim().slice(0, 80) : '';
  if (!text || PLACEHOLDER_CEREMONY.test(text)) return 'awards';
  return text.replace(/^the\s+/i, '');
}

// Each story looks up at most this many film titles (winners first).
const MAX_TITLE_LOOKUPS = 40;

// A year's awards are still being decided until the next March (Matt,
// 2026-11-11: "only see those awards maybe starting in March of the following
// year"): a board for <year> is held until 1 March <year + 1>, midnight
// Eastern (always EST then, so 05:00 UTC). A year that isn't a number is never held.
function awardsReleaseAt (year) {
  const y = Number(year);
  return Number.isInteger(y) ? Date.UTC(y + 1, 2, 1, 5) : 0;
}

// The awards a story shows posters for, in order: Best Picture, then director
// and the four acting awards (house ranks -1..5), at most this many posters.
const MAX_POSTERS = 6;
const isMainAward = (label) => houseCategoryRank(label) <= 5;

/**
 * The poster grid that opens an awards story: one captioned poster a winning
 * film (a film winning several shares one poster, its awards listed). `picks`
 * is [{ label, text, posterUrl }], `text` already escaped. Feeds lays two or
 * more captioned pictures in a row out three across. Pure.
 */
function posterGrid (picks) {
  const byPoster = new Map();
  for (const p of picks || []) {
    if (!p?.posterUrl || !/^https:\/\//.test(p.posterUrl)) continue;
    const seen = byPoster.get(p.posterUrl);
    if (seen) { seen.lines.push(p); continue; }
    if (byPoster.size >= MAX_POSTERS) continue;
    byPoster.set(p.posterUrl, { lines: [p] });
  }
  if (!byPoster.size) return '';
  const figures = [...byPoster].map(([src, { lines }]) => {
    const film = lines[0].film || '';
    const caption = lines.map((l) => `<b>${esc(l.label)}</b>${l.person ? `<br>${l.person}` : ''}`).join('<br>');
    return `<figure><img src="${esc(src)}" alt="${esc(film)}" loading="lazy"><figcaption>${caption}</figcaption></figure>`;
  });
  return `<div>${figures.join('')}</div>`;
}

/**
 * One year's board as HTML: categories in order, the winner after the name,
 * the other nominees on a line beneath. `categories` is
 * [{ label, winners: [text], nominees: [text] }], texts already escaped.
 */
function boardHtml (categories) {
  return categories.map((c) => {
    const won = c.winners.join(', ');
    const rest = c.nominees.filter((n) => !c.winners.includes(n));
    const head = `<b>${esc(c.label)}</b>${won ? ` · ${won}` : ''}`;
    const nominated = rest.length ? `<br><small>${won ? 'Also nominated' : 'Nominees'}: ${rest.join(', ')}</small>` : '';
    return `<p>${head}${nominated}</p>`;
  }).join('');
}
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
      // publishedAt is epoch milliseconds from the sync (a string in older rows).
      const at = Number.isFinite(Number(e.publishedAt)) && Number(e.publishedAt) > 0 ? Number(e.publishedAt) : Date.parse(e.publishedAt || `${e.watchedDate || ''}T12:00:00Z`);
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

/** A board's categories in the app's order: the standard ones, then the year's own (oldest first). Pure. */
function boardCategories (board) {
  const cats = board?.categories || {};
  const custom = Object.entries(board?.customCategories || {}).filter(([, c]) => c?.name)
    .sort(([, x], [, y]) => (Number(x.createdAt) || 0) - (Number(y.createdAt) || 0) || String(x.name).localeCompare(String(y.name)));
  const order = [...CATEGORIES.map((c) => c.key), ...custom.map(([key]) => key)];
  const names = Object.fromEntries(custom.map(([key, c]) => [key, String(c.name)]));
  const rest = Object.keys(cats).filter((k) => !order.includes(k)).sort();
  return [...order, ...rest].filter((k) => cats[k]).map((key) => ({ key, label: names[key] || categoryLabel(key), data: cats[key] }));
}

const listOf = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []).filter((x) => x && typeof x === 'object');

/** The TMDB ids a board names, winners first, at most MAX_TITLE_LOOKUPS. Pure. */
function boardMovieIds (board) {
  const winners = [];
  const nominees = [];
  for (const { data } of boardCategories(board)) {
    if (data.noNominees) continue;
    if (data.winner) winners.push(data.winner.movieId);
    listOf(data.nominees).forEach((n) => nominees.push(n.movieId));
  }
  return [...new Set([...winners, ...nominees].filter((v) => Number.isFinite(Number(v))).map(Number))].slice(0, MAX_TITLE_LOOKUPS);
}

/**
 * A friend's awards board for one year, as touched at `lastUpdated`: every
 * category in the app's order, the winner and the other nominees.
 * `titleOf` names a TMDB id; `awardsName` is what the friend calls them. Pure.
 */
function awardsItem ({ key, name, year, board, awardsName, now = Date.now() }, titleOf, posterOf = () => null) {
  const touched = Number(board?.lastUpdated);
  if (!Number.isFinite(touched)) return null;
  // Held until the March after; a board last touched before then is told as of then.
  const release = awardsReleaseAt(year);
  if (now < release) return null;
  const at = Math.max(touched, release);
  const pickText = (p) => {
    if (!p) return null;
    const film = titleOf(p.movieId) || null;
    if (p.type === 'person' || p.name) return p.name || p.id ? `${esc(p.name || p.id)}${film ? ` <i>(${esc(film)})</i>` : ''}` : null;
    return film ? esc(film) : null;
  };
  const categories = [];
  const picks = [];
  let picture = null;
  let pictureId = null;
  for (const { key: cat, label, data } of boardCategories(board)) {
    if (data.noNominees) continue;
    const winner = pickText(data.winner);
    const nominees = [...new Set(listOf(data.nominees).map(pickText).filter(Boolean))];
    if (!winner && !nominees.length) continue;
    if (cat === 'bestPicture' && data.winner) { picture = titleOf(data.winner.movieId) || null; pictureId = data.winner.movieId; }
    if (winner && MAIN_KEYS.has(cat)) {
      const w = data.winner;
      const isPerson = w.type === 'person' || w.name;
      picks.push({ label, film: titleOf(w.movieId) || '', person: isPerson && (w.name || w.id) ? esc(w.name || w.id) : '', posterUrl: posterOf(w.movieId) });
    }
    categories.push({ label, winners: winner ? [winner] : [], nominees });
  }
  if (!categories.length) return null;
  const image = (pictureId != null && posterOf(pictureId)) || picks.map((p) => p.posterUrl).find(Boolean) || undefined;
  return {
    id: `awards-${key}-${year}-${at}`,
    url: `https://www.cinemaroll.org/awards?year=${encodeURIComponent(year)}`,
    title: `${firstName(name)}'s ${year} ${ceremonyWord(awardsName)}${picture ? `: ${picture} for Best Picture` : ''}${board.completed ? '' : ' (so far)'}`,
    content_html: posterGrid(picks) + boardHtml(categories),
    image,
    date_published: iso(at)
  };
}
const MAIN_KEYS = new Set(['bestPicture', 'bestDirector', 'bestActor', 'bestActress', 'bestSupportingActor', 'bestSupportingActress']);

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

// --- a Movie Log friend's awards -------------------------------------------
// Their feed carries each film's awards ({ year, category, label, result,
// name?, ceremony? }) and the ceremony's name. Folded into one board a
// ceremony and year; a short summary of each is remembered with the cached
// feed, and a board whose summary moved becomes a story. The first time a
// friend's awards are seen only their newest year is told, so a new friend
// doesn't arrive as a flood of every year they ever did.

/** The feed's ceremony: its awardsName, else a "Name: " prefix most labels share. Pure. */
function externalCeremony (awardsName, movies) {
  const named = typeof awardsName === 'string' ? awardsName.trim().slice(0, 80) : '';
  if (named && !PLACEHOLDER_CEREMONY.test(named)) return named;
  const counts = new Map();
  let total = 0;
  for (const m of movies || []) {
    for (const award of m.awards || []) {
      if (award.ceremony) continue;
      total += 1;
      const at = String(award.label || '').indexOf(': ');
      if (at > 0) { const p = award.label.slice(0, at).trim(); counts.set(p, (counts.get(p) || 0) + 1); }
    }
  }
  const [prefix, count] = [...counts].sort((x, y) => y[1] - x[1])[0] || [];
  return prefix && count * 2 > total ? prefix : null;
}

/**
 * Boards from a Movie Log feed's movies ([{ tmdbId, title, awards }]):
 * { '<ceremony>|<year>': { ceremony, year, categories: [{ label, winners, nominees }] } },
 * categories in the house order, texts escaped. Pure.
 */
function externalBoards (movies, awardsName) {
  const feedCeremony = externalCeremony(awardsName, movies);
  const boards = {};
  for (const m of movies || []) {
    const film = m?.title ? String(m.title) : null;
    if (!film) continue;
    for (const award of m.awards || []) {
      if (!Number.isInteger(award?.year) || !award.label || !['won', 'nominated'].includes(award.result)) continue;
      const ceremony = award.ceremony || feedCeremony || null;
      let label = String(award.label);
      if (ceremony && label.toLowerCase().startsWith(`${ceremony.toLowerCase()}: `)) label = label.slice(ceremony.length + 2).trim() || label;
      const boardKey = `${ceremony || ''}|${award.year}`;
      const board = boards[boardKey] || (boards[boardKey] = { ceremony, year: award.year, byLabel: {}, picks: [] });
      const cat = board.byLabel[award.category || label] || (board.byLabel[award.category || label] = { label, winners: [], nominees: [] });
      const text = labelKind(label) === 'person' && award.name ? `${esc(award.name)} <i>(${esc(film)})</i>` : esc(film);
      const list = award.result === 'won' ? cat.winners : cat.nominees;
      if (!list.includes(text)) list.push(text);
      if (award.result === 'won' && isMainAward(label) && Number(m.tmdbId) > 0 && !board.picks.some((p) => p.label === label)) {
        board.picks.push({ label, film, person: labelKind(label) === 'person' && award.name ? esc(award.name) : '', tmdbId: Number(m.tmdbId) });
      }
    }
  }
  for (const board of Object.values(boards)) {
    board.categories = Object.values(board.byLabel)
      .map((c) => ({ ...c, nominees: c.nominees.filter((n) => !c.winners.includes(n)) }))
      .sort((x, y) => houseCategoryRank(x.label) - houseCategoryRank(y.label) || x.label.localeCompare(y.label));
    delete board.byLabel;
    board.picks.sort((x, y) => houseCategoryRank(x.label) - houseCategoryRank(y.label));
  }
  return boards;
}

const shortHash = (text) => require('crypto').createHash('sha1').update(String(text)).digest('hex').slice(0, 12);
// A Firebase-safe key for a board: ceremony names may hold . # $ / [ ].
const boardSlot = (board) => `y${board.year}-${shortHash(board.ceremony || '')}`;

/**
 * The remembered summaries after a fresh read: a board whose summary moved is
 * stamped `at: now` and keeps its categories for the story; on the first
 * sighting (`prior` null) only the newest year is stamped. Pure.
 */
function externalAwardYears (boards, prior, now) {
  const next = {};
  const list = Object.values(boards || {});
  const released = (b) => now >= awardsReleaseAt(b.year);
  const newest = list.filter(released).reduce((top, b) => Math.max(top, b.year), -Infinity);
  for (const board of list) {
    const slot = boardSlot(board);
    // The hash covers the categories only (the posters came later and mustn't re-tell every board).
    const sig = shortHash(JSON.stringify(board.categories));
    const before = prior ? prior[slot] : null;
    const story = { ceremony: board.ceremony, year: board.year, sig, categories: board.categories, picks: board.picks || [] };
    // A year still under way waits, whole, until its March.
    if (!released(board)) { next[slot] = { ...story, held: true }; continue; }
    const told = prior ? !before || before.sig !== sig || Boolean(before.held) : board.year === newest && board.categories.some((c) => c.winners.length);
    if (told) next[slot] = { ...story, at: now };
    else if (before && before.at) next[slot] = { ...before, ...story, at: before.at };
    else next[slot] = { year: board.year, sig };
  }
  return next;
}

/**
 * The remembered boards on a check with no fresh read: a held year whose March
 * has come is told now (once); a told year not yet released (from before the
 * hold) is held. Hands back the same object when nothing changed. Pure.
 */
function releaseAwardYears (years, now) {
  if (!years) return years;
  let changed = false;
  const next = {};
  for (const [slot, y] of Object.entries(years)) {
    const due = now >= awardsReleaseAt(y?.year);
    if (y?.held && due) { const { held, ...rest } = y; next[slot] = { ...rest, at: now }; changed = true; } // eslint-disable-line no-unused-vars
    else if (!due && y?.at) { const { at, ...rest } = y; next[slot] = { ...rest, held: true }; changed = true; } // eslint-disable-line no-unused-vars
    else next[slot] = y;
  }
  return changed ? next : years;
}

/** Stories for a Movie Log friend's boards that moved in the window. Pure. */
function externalAwardItems ({ id, name, years }, since, posterOf = () => null) {
  const out = [];
  for (const [slot, y] of Object.entries(years || {})) {
    const at = Number(y?.at);
    if (y?.held || !Number.isFinite(at) || at < since || !Array.isArray(y.categories) || !y.categories.length) continue;
    const categories = y.categories.map((c) => ({ label: c.label, winners: c.winners || [], nominees: c.nominees || [] }));
    const best = categories.find((c) => houseCategoryRank(c.label) === -1 && c.winners.length);
    const picks = (Array.isArray(y.picks) ? y.picks : []).map((p) => ({ ...p, posterUrl: posterOf(p.tmdbId) }));
    const picture = best ? best.winners[0].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"') : null;
    out.push({
      id: `external-awards-${id}-${slot}-${at}`,
      url: 'https://www.cinemaroll.org/awards',
      title: `${firstName(name)}'s ${y.year} ${ceremonyWord(y.ceremony)}${picture ? `: ${picture} for ${best.label}` : ''}`,
      content_html: posterGrid(picks) + boardHtml(categories),
      image: picks.map((p) => p.posterUrl).find(Boolean) || undefined,
      date_published: iso(at)
    });
  }
  return out;
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
  // titleOf may answer a title or { title, poster }.
  const films = {};
  const awardsNames = {};
  const filmOf = async (id) => {
    if (!Number.isFinite(Number(id))) return null;
    if (!(id in films)) {
      const found = await titleOf(Number(id)).catch(() => null);
      films[id] = typeof found === 'string' ? { title: found } : found && typeof found === 'object' ? found : null;
    }
    return films[id];
  };
  const posterOf = (id) => films[id]?.poster || null;
  for (const key of friendKeys) {
    try {
      const years = Object.keys((await db.get(`${key}/personalAwards`, 'shallow=true')) || {});
      for (const year of years) {
        // Told as of the later of its last touch and its March (awardsReleaseAt).
        const release = awardsReleaseAt(year);
        if (now < release) continue;
        const at = Math.max(Number(await db.get(`${key}/personalAwards/${year}/lastUpdated`)), release);
        if (!Number.isFinite(at) || at < since) continue;
        const board = await db.get(`${key}/personalAwards/${year}`);
        for (const id of boardMovieIds(board)) await filmOf(id);
        if (awardsNames[key] === undefined) awardsNames[key] = (await db.get(`${key}/settings/personalAwardName`).catch(() => null)) || null;
        const item = awardsItem({ key, name: names[key], year, board, awardsName: awardsNames[key], now }, (id) => films[id]?.title || null, posterOf);
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
      let awardYears = cached?.awardYears || null;
      // A cache from before the awards were read is read afresh once.
      const awardsRead = Boolean(cached?.awardsRead);
      if (!cached || !awardsRead || now - Number(cached.checkedAt || 0) > EXTERNAL_RECHECK_MS) {
        const read = await readExternal(friend.feedUrl, awardsRead ? cached : null);
        if (read) {
          watches = read.watches;
          awardYears = externalAwardYears(externalBoards(read.awards || [], read.awardsName), awardsRead ? cached.awardYears || {} : null, now);
          await db.set(cachePath, { revision: read.revision || null, watches: watches.slice(0, 40), awardYears, awardsRead: true, checkedAt: now });
        } else if (cached) {
          await db.set(`${cachePath}/checkedAt`, now);
        }
      }
      // A held year whose March came (or a told one from before the hold) moves without a fresh read.
      const settled = releaseAwardYears(awardYears, now);
      if (settled !== awardYears) { awardYears = settled; await db.set(`${cachePath}/awardYears`, awardYears); }
      items.push(...externalItems({ id, name: friend.name, watches }, since));
      for (const y of Object.values(awardYears || {})) {
        if (!y?.held && Number(y?.at) >= since) for (const p of (y.picks || []).slice(0, MAX_POSTERS)) await filmOf(p.tmdbId);
      }
      items.push(...externalAwardItems({ id, name: friend.name, years: awardYears }, since, posterOf));
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

module.exports = { buildClubFeed, logItems, reviewItems, awardsItem, boardMovieIds, externalItems, externalBoards, externalAwardYears, externalAwardItems, releaseAwardYears, awardsReleaseAt, posterGrid, categoryMatchKey, houseCategoryRank, CATEGORIES, WINDOW_DAYS };
