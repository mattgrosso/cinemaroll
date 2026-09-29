// WHEN the push Lambda is allowed to send, and what it's allowed to say.
// Pure and dependency-free (plain CommonJS) so it ships inside the Lambda zip
// AND is unit-tested from src/test/pushCadence.test.js — the decision here is
// far too fiddly to leave untested, and it is the difference between a useful
// nudge and an app that nags.
//
// Matt, 2026-08-28: "is this only gonna notify me once a day? It'll be nice
// if it just happened more regularly, you know, as the prompts come in."
//
// THE TRAP, and the reason this file exists: "check more often" naively
// implemented means re-reading the same standing backlog every few hours.
// Thirteen films have been waiting on stickiness for a month; pinging about
// them at 9am, noon, and 3pm is the same notification three times. So the
// rule is NEWS, not STATE — a send needs something that wasn't true last
// time we sent:
//
//   * more films past their stickiness boundary than we've mentioned
//   * a tiebreak where there wasn't one
//   * an award year we haven't named
//
// A BASELINE (stored at {topKey}/push/state/baseline) is what we've already
// told them. It ratchets DOWN freely as chores get done — clearing work must
// never itself look like news, and must re-arm the same chore for next time —
// and jumps UP only when we actually send.
//
// Three more guards, each earning its place:
//   * a waking-hours window, because a film maturing at 3am can wait
//   * spacing across that window, the same "N a day, evenly spaced" shape
//     settings/promptQuota.js already uses for the on-screen prompts
//   * silence while the app is OPEN — the prompts are on screen; a push
//     about what someone is already looking at is pure noise. `digestUpdatedAt`
//     is the signal: the app republishes its digest on every launch.
//
// Plus a staleness backstop: if something is still waiting a full day later,
// say so again. Otherwise ignoring one notification means never hearing
// about that chore again.

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

// The app was open this recently ⇒ they are looking at the prompts already.
const ACTIVE_IN_APP_MS = 30 * 60 * 1000;

// Re-mention a still-unfinished chore after this long, even with no news.
const STALE_REMINDER_MS = ONE_DAY_MS;

// 'daily' keeps the original single-nudge-per-day behaviour.
const DEFAULT_CADENCE = 'asTheyCome';
const DEFAULT_WINDOW_START = 9;
const DEFAULT_WINDOW_END = 21;
const DEFAULT_PER_DAY = 4;
const DAILY_MIN_GAP_MS = 20 * HOUR_MS;

const EMPTY_BASELINE = { stickinessCount: 0, tiebreak: false, awardYears: [] };

// The games reminder (Matt, 2026-09-07: "an optional notification, one that
// defaults to off ... that reminds you to play the games every day, maybe
// even you can choose per game"). A different animal from the chores above:
// not news, a fixed daily hour — but it still only names games NOT YET
// PLAYED that day, and a day with everything played sends nothing.
const DEFAULT_GAMES_HOUR = 20;

/**
 * What's due right now, honouring per-category opt-outs.
 *
 * `dueTimes` is why the digest carries future boundary timestamps: films
 * mature into stickiness candidacy while the app is closed, and counting them
 * here is what makes "as the prompts come in" work at all without the client
 * ever running.
 */
function dueFromDigest (digest, prefs, now) {
  // A chore that is due in the DATA can still be one the app refuses to put
  // on screen, because Home.vue gates every prompt behind a per-prompt daily
  // quota. `eligibleAt` is when that gate opens (0 = no limit), published by
  // pushDigest.js precisely so this decision can respect it.
  //
  // Bug, 2026-08-28: without this, a push announced two chores that were
  // suppressed until 10:14am and 6pm — so tapping it landed on an empty
  // screen. A notification must only ever name work you can actually do the
  // moment you arrive.
  const open = (section) => {
    const at = Number(section?.eligibleAt);
    return !Number.isFinite(at) || at <= now;
  };

  // A tournament under way pins the screen to the tiebreak prompt; nothing
  // else can appear, so nothing else may be promised.
  const pinned = Boolean(digest?.tiebreak?.pinned) && prefs.tiebreak !== false;

  const stickinessCount = (prefs.stickiness === false || pinned || !open(digest?.stickiness))
    ? 0
    : (digest?.stickiness?.count || 0) +
      (digest?.stickiness?.dueTimes || []).filter((time) => time <= now).length;

  const tiebreak = (prefs.tiebreak === false || !open(digest?.tiebreak))
    ? null
    : (digest?.tiebreak?.due ? digest.tiebreak : null);

  const awardYears = (prefs.awards === false || pinned || !open(digest?.awards))
    ? []
    : (digest?.awards?.years || []);

  return { stickinessCount, tiebreak, awardYears };
}

function normalizeBaseline (baseline) {
  return {
    stickinessCount: Number(baseline?.stickinessCount) || 0,
    tiebreak: Boolean(baseline?.tiebreak),
    awardYears: Array.isArray(baseline?.awardYears) ? baseline.awardYears.map(Number) : []
  };
}

/** What's true now that we haven't already said. */
function newsIn (due, baseline) {
  const base = normalizeBaseline(baseline);
  const known = new Set(base.awardYears);
  const newAwardYears = due.awardYears.filter((year) => !known.has(Number(year)));
  const newStickiness = due.stickinessCount > base.stickinessCount;
  const newTiebreak = Boolean(due.tiebreak) && !base.tiebreak;

  return {
    newStickiness,
    newTiebreak,
    newAwardYears,
    any: newStickiness || newTiebreak || newAwardYears.length > 0
  };
}

function anythingDue (due) {
  return due.stickinessCount > 0 || Boolean(due.tiebreak) || due.awardYears.length > 0;
}

/**
 * The baseline to store after a sweep.
 *
 * Sent ⇒ everything currently due is now "said". Didn't send ⇒ ratchet DOWN
 * only, so finished chores re-arm (do all your stickiness, and the next film
 * to mature is news again) while a standing backlog stays quiet.
 */
function nextBaseline (due, baseline, sent) {
  if (sent) {
    return {
      stickinessCount: due.stickinessCount,
      tiebreak: Boolean(due.tiebreak),
      awardYears: due.awardYears.map(Number)
    };
  }

  const base = normalizeBaseline(baseline);
  const stillDue = new Set(due.awardYears.map(Number));
  return {
    stickinessCount: Math.min(base.stickinessCount, due.stickinessCount),
    tiebreak: base.tiebreak && Boolean(due.tiebreak),
    awardYears: base.awardYears.filter((year) => stillDue.has(year))
  };
}

function windowFor (prefs) {
  const start = Number.isFinite(Number(prefs?.windowStart)) ? Number(prefs.windowStart) : DEFAULT_WINDOW_START;
  const end = Number.isFinite(Number(prefs?.windowEnd)) ? Number(prefs.windowEnd) : DEFAULT_WINDOW_END;
  // A window that doesn't span at least an hour would silence pushes
  // entirely; fall back rather than going mysteriously quiet.
  if (!(end > start)) return { start: DEFAULT_WINDOW_START, end: DEFAULT_WINDOW_END };
  return { start, end };
}

/**
 * Minimum gap between sends: the waking window divided by the allowance, so
 * "4 a day" across a 12-hour window really is every 3 hours. (Dividing a full
 * 24h by the allowance — the shape promptQuota.js uses for on-screen prompts,
 * where there is no window — would silently deliver about half the stated
 * number.)
 */
function spacingMs (prefs) {
  const { start, end } = windowFor(prefs);
  const perDay = Number(prefs?.pushesPerDay);
  const allowance = Number.isFinite(perDay) && perDay > 0 ? perDay : DEFAULT_PER_DAY;
  return ((end - start) * HOUR_MS) / allowance;
}

/**
 * Should a notification go out right now?
 *
 * `localHour` is the user's own wall-clock hour; `digestUpdatedAt` is when
 * their app last published (i.e. was last open).
 */
function shouldSend ({ due, prefs = {}, baseline, now, localHour, lastSentAt = 0, digestUpdatedAt = 0 }) {
  if (prefs.enabled === false) return { send: false, reason: 'disabled' };
  if (!anythingDue(due)) return { send: false, reason: 'nothing-due' };

  const cadence = prefs.cadence || DEFAULT_CADENCE;

  if (cadence === 'daily') {
    const hour = Number.isFinite(Number(prefs.hour)) ? Number(prefs.hour) : 19;
    if (localHour !== hour) return { send: false, reason: 'wrong-hour' };
    if (now - lastSentAt < DAILY_MIN_GAP_MS) return { send: false, reason: 'too-soon' };
    return { send: true, reason: 'daily' };
  }

  const { start, end } = windowFor(prefs);
  if (localHour < start || localHour >= end) return { send: false, reason: 'outside-window' };

  // They have the app open — the prompts are already on screen.
  if (now - digestUpdatedAt < ACTIVE_IN_APP_MS) return { send: false, reason: 'in-app' };

  if (now - lastSentAt < spacingMs(prefs)) return { send: false, reason: 'too-soon' };

  const news = newsIn(due, baseline);
  if (news.any) return { send: true, reason: 'news', news };
  if (now - lastSentAt >= STALE_REMINDER_MS) return { send: true, reason: 'stale', news };

  return { send: false, reason: 'no-news' };
}

/**
 * The film the stickiness prompt will actually lead with when they arrive.
 *
 * NOT simply `nextTitle`. Bug report (Natalie, 2026-09-01): "all my pushing
 * notification, it said that Picture 06 needed a stickiness, even though it
 * was actually Coraline that needed stickiness." `nextTitle` is the head of
 * the prompt's list at the moment the app PUBLISHED the digest. A film that
 * crosses its boundary afterwards is counted here through `dueTimes`, and
 * because the prompt sorts most-recently-rated first, a film that has just
 * matured usually leads it - so the push named the film that had been
 * waiting, and the app opened on the one that had just arrived.
 *
 * The digest now carries `upcoming` (each boundary with its film's title and
 * rating date). The lead is whichever due film was rated most recently, the
 * prompt's own order. If films have matured that we cannot name (a digest
 * published before `upcoming` existed), say nothing rather than the wrong
 * name.
 */
function stickinessLead (digest, now) {
  const section = digest?.stickiness || {};
  const maturedCount = (section.dueTimes || []).filter((time) => time <= now).length;
  const matured = (section.upcoming || [])
    .filter((item) => item && Number(item.at) <= now && item.title);
  if (maturedCount > matured.length) return null;

  const candidates = matured.slice();
  if (section.nextTitle) {
    candidates.push({ title: section.nextTitle, ratedAt: Number(section.nextRatedAt) || 0 });
  }
  if (!candidates.length) return null;
  return candidates.reduce((best, item) => (
    (Number(item.ratedAt) || 0) > (Number(best.ratedAt) || 0) ? item : best
  )).title;
}

/**
 * The notification text. Leads with what's NEW when this send was triggered
 * by news, since that's the part they haven't heard. The film named is the
 * one the prompt will put in front of them - see stickinessLead.
 */
// Which chore the headline is about, so the app can open THAT prompt when
// the notification is tapped (bug report, 2026-09-13: "it would be nice if
// when I tapped on a notification, it didn't just take me to the home
// screen, but took me to the home screen with the applicable notification
// already opened"). `kinds` runs parallel to `parts`; the first is the one
// the title names and the one Home's own priority order would show first.
function composeMessage (due, digest, news, now = Date.now()) {
  const leadWithNew = Boolean(news?.any);
  const parts = [];
  const kinds = [];

  if (due.stickinessCount > 0) {
    const title = stickinessLead(digest, now);
    const justOne = leadWithNew
      ? news.newStickiness && due.stickinessCount - 1 <= 0
      : due.stickinessCount === 1;

    if (title && (justOne || (leadWithNew && news.newStickiness))) {
      parts.push(due.stickinessCount > 1
        ? `${title} is ready for its stickiness rating (+${due.stickinessCount - 1} more)`
        : `${title} is ready for its stickiness rating`);
    } else {
      parts.push(due.stickinessCount === 1
        ? 'A film is ready for its stickiness rating'
        : `${due.stickinessCount} films are ready for a stickiness check`);
    }
    kinds.push('stickiness');
  }

  if (due.tiebreak) {
    parts.push(due.tiebreak.count >= 2 ? `${due.tiebreak.count} films are tied` : 'A tiebreak is waiting');
    kinds.push('tiebreak');
  }

  // Always NAME a year, never count them. Bug report (Matt, 2026-08-28):
  // "The notification told me that I had three [award] years to deal with,
  // but really since we only deal with one at a time it should not give me a
  // number. I should just say you have a movie here. Maybe you could tell me
  // the year."
  //
  // He's right that the count was answering the wrong question: the awards
  // prompt hands you exactly one year and there is no screen anywhere that
  // shows you three. `awardYears` arrives sorted ascending
  // (yearsMeetingAwardsThreshold) and the modal works the earliest first, so
  // [0] is genuinely the year you are about to be given - the notification
  // now names that and says nothing about the queue behind it.
  if (due.awardYears.length) {
    parts.push(`${due.awardYears[0]} needs its personal awards`);
    kinds.push('awards');
  }

  if (!parts.length) return null;
  return {
    title: parts[0],
    body: parts.length > 1 ? parts.slice(1).join(' · ') : 'Tap to knock it out.',
    open: kinds[0]
  };
}

// --- The games reminder -----------------------------------------------------

/** 'YYYY-MM-DD' in the user's own timezone — "today" is theirs, not UTC's. */
function localDateKey (tz, at) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(at));
  } catch {
    return new Date(at).toISOString().slice(0, 10);
  }
}

/**
 * The games still unplayed today, honouring the per-game picks. Mirrors
 * pushPrefs.js's gameReminderOn: `gamePicks[key] === false` mutes a game,
 * anything else (including no picks at all) leaves it in.
 *
 * `digest.games.list` is published by the app (pushDigest.js gamesDigest)
 * with each game's name and last-played time; a digest from before it
 * existed has no list, and an empty list sends nothing.
 */
function gamesDue (digest, prefs, now, tz) {
  const today = localDateKey(tz, now);
  return (digest?.games?.list || []).filter((game) => {
    if (!game || !game.key || !game.name) return false;
    if (prefs?.gamePicks?.[game.key] === false) return false;
    const playedAt = Number(game.lastPlayedAt);
    if (!Number.isFinite(playedAt) || playedAt <= 0) return true;
    return localDateKey(tz, playedAt) !== today;
  });
}

/**
 * Should the games reminder go out right now? Off unless opted in; at the
 * chosen hour only; once a day; and — like the chores — not while the app
 * is open, where the Games button is already on screen.
 */
function shouldSendGames ({ prefs = {}, now, localHour, lastGamesSentAt = 0, digestUpdatedAt = 0 }) {
  if (prefs.enabled === false) return { send: false, reason: 'disabled' };
  if (prefs.games !== true) return { send: false, reason: 'games-off' };

  const hour = Number.isFinite(Number(prefs.gamesHour)) ? Number(prefs.gamesHour) : DEFAULT_GAMES_HOUR;
  if (localHour !== hour) return { send: false, reason: 'wrong-hour' };
  if (now - lastGamesSentAt < DAILY_MIN_GAP_MS) return { send: false, reason: 'too-soon' };
  if (now - digestUpdatedAt < ACTIVE_IN_APP_MS) return { send: false, reason: 'in-app' };
  return { send: true, reason: 'games' };
}

/**
 * The reminder text. Names the unplayed games — up to four, then a count —
 * and deep-links a lone game straight to itself.
 */
function composeGamesMessage (unplayed, total = unplayed.length) {
  if (!unplayed.length) return null;
  if (unplayed.length === 1) {
    return {
      title: `${unplayed[0].name} is waiting for you today`,
      body: 'Tap to play.',
      navigate: `/games/${unplayed[0].key}`
    };
  }
  const names = unplayed.map((game) => game.name);
  const shown = names.slice(0, 4);
  const rest = names.length - shown.length;
  return {
    title: unplayed.length >= total ? "Today's games are waiting" : `${unplayed.length} games still to play today`,
    body: rest > 0 ? `${shown.join(', ')} and ${rest} more.` : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}.`,
    navigate: '/games'
  };
}

// The body of a friend-log push. `scoreLine` is null when the rater doesn't
// share ratings (their tier, decided client-side); `prefs.friendLogScores`
// is the RECIPIENT's choice to hear about the film without the number
// (2026-09-06: "turn off the score so you see that they watched it, but you
// don't see their score"). Default on, so an account that has never seen the
// toggle keeps the notification it already had.
function friendLogBody (scoreLine, prefs) {
  const quiet = 'Tap to see it in their library.';
  if (!scoreLine) return quiet;
  return prefs && prefs.friendLogScores === false ? quiet : scoreLine;
}

// --- Friends on other apps --------------------------------------------------
//
// A Cinema Roll friend's log reaches you because THEIR client announces it
// (POST /push/friend-logged). A Movie Log friend has no Cinema Roll client to
// do that - their library arrives as a published feed that our app only reads
// while it is open, which is exactly why Matt got the club entry but never the
// notification (report -P1jvQ2VY03wwbsTEwD-). So for external friends the
// sweep has to notice the new viewing itself.
//
// Everything below is pure: the Lambda fetches, these functions decide.

const EXTERNAL_MAX_AGE_MS = 7 * ONE_DAY_MS;
const EXTERNAL_MAX_PER_FRIEND = 3;

function externalMs (value) {
  const ms = new Date(value == null ? NaN : value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function externalNum (value) {
  const parsed = typeof value === 'string' ? parseFloat(value) : value;
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Newest-first viewings from either feed format, reduced to just what a push
 * needs. Mirrors `detectFormat` in src/assets/javascript/interchange.js - the
 * Lambda cannot import that ES module, and a full port would be the "prompt
 * logic in the Lambda" this file exists to prevent, so only the two shapes are
 * read here and the client stays the source of truth for rendering.
 */
function externalWatches (payload) {
  if (!payload || typeof payload !== 'object') return [];

  const out = [];
  const add = (tmdbId, title, watchedAt, score) => {
    if (!title || typeof title !== 'string' || watchedAt === null) return;
    out.push({
      tmdbId: Number.isFinite(tmdbId) ? tmdbId : null,
      title,
      watchedAt,
      score: score === undefined ? null : score
    });
  };

  if (typeof payload.format === 'string' && payload.format.startsWith('film-club/')) {
    (payload.movies || []).forEach((movie) => {
      const viewings = (movie && movie.viewings) || [];
      // toInterchange already sorts viewings newest-first.
      const watchedAt = viewings.length ? externalMs(viewings[0].watchedAt) : null;
      add(Number(movie && movie.tmdbId), movie && movie.title, watchedAt, externalNum(movie && movie.rating));
    });
  } else {
    const records = Array.isArray(payload)
      ? payload
      : Object.values(payload).filter((value) => value && typeof value === 'object');
    records.forEach((record) => {
      const inner = (record && record.movie) || record;
      if (!inner || !Array.isArray(inner.viewings)) return;
      const viewings = inner.viewings
        .map((viewing) => ({ at: externalMs(viewing && viewing.date), raw: viewing }))
        .filter((viewing) => viewing.at !== null)
        .sort((a, b) => b.at - a.at);
      if (!viewings.length) return;
      const rawId = (record && record.movieId) != null ? record.movieId : inner.tmdb && inner.tmdb.id;
      add(Number(rawId), inner.title, viewings[0].at, externalNum(viewings[0].raw && viewings[0].raw.rating));
    });
  }

  return out.sort((a, b) => b.watchedAt - a.watchedAt);
}

/**
 * What to announce for ONE external friend, and the marker to store next.
 *
 * News, not state, the same as every other stream here:
 *  - the FIRST sight of a friend announces nothing and just records where
 *    their feed had got to. Subscribing to someone with a decade of viewings
 *    must not fire a decade of notifications.
 *  - only viewings newer than the stored marker count, so re-reading an
 *    unchanged feed every 15 minutes is silent.
 *  - a viewing older than maxAgeMs is never announced: a friend backfilling
 *    their history is not news. It DOES move the marker, so the backfill
 *    stays silent on later sweeps too.
 *  - at most EXTERNAL_MAX_PER_FRIEND per sweep, newest first - a friend who
 *    logs eight films at once gets three notifications, not eight.
 */
function externalLogsDue ({ watches, seenAt = 0, now = Date.now(), maxAgeMs = EXTERNAL_MAX_AGE_MS }) {
  const all = (watches || []).filter((watch) => watch && Number.isFinite(watch.watchedAt));
  const newest = all.reduce((max, watch) => Math.max(max, watch.watchedAt), 0);
  const marker = Number(seenAt) || 0;

  // Never seen this friend before: seed the marker, say nothing.
  if (!marker) return { announce: [], nextSeenAt: newest, seeded: true };

  const announce = all
    .filter((watch) => watch.watchedAt > marker && now - watch.watchedAt <= maxAgeMs)
    .slice(0, EXTERNAL_MAX_PER_FRIEND);

  return { announce, nextSeenAt: Math.max(marker, newest), seeded: false };
}

// --- New sign-ups (Matt, 2026-09-28) -----------------------------------------
//
// "It would be cool if I knew when someone signed up for this app." The sweep
// already shallow-lists every account, so a sign-up is simply an account key
// that wasn't there last time. Only the owner is told.

const SIGNUP_MAX_PER_SWEEP = 3;

/**
 * Which accounts are new since the stored list, and the list to store next.
 *
 * The FIRST run (no stored list) announces nobody - it records everyone
 * already here, so turning this on doesn't announce the whole user base.
 * The stored list only ever grows: an account whose node briefly vanishes
 * and comes back is not a new person. More than SIGNUP_MAX_PER_SWEEP at once
 * collapses into one summary rather than a burst of pushes.
 */
function signupsDue ({ known, current, now = Date.now() }) {
  const keys = (current || []).filter((key) => typeof key === 'string' && key);
  if (!known || typeof known !== 'object') {
    const seededKnown = {};
    keys.forEach((key) => { seededKnown[key] = now; });
    return { fresh: [], nextKnown: seededKnown, seeded: true };
  }
  const fresh = keys.filter((key) => !(key in known)).sort();
  const nextKnown = { ...known };
  fresh.forEach((key) => { nextKnown[key] = now; });
  return { fresh, nextKnown, seeded: false };
}

// Account keys are the email with every unsafe character turned into '-', so
// the address can't be recovered in general. For the common providers the
// domain is certain, which is enough to make the key readable.
const KNOWN_EMAIL_DOMAINS = [
  'gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'mac.com', 'yahoo.com',
  'hotmail.com', 'outlook.com', 'live.com', 'aol.com', 'privaterelay.appleid.com'
];

function emailGuessFromKey (key) {
  if (typeof key !== 'string' || !key) return '';
  for (const domain of KNOWN_EMAIL_DOMAINS) {
    const suffix = `-${domain.replace(/\./g, '-')}`;
    if (key.endsWith(suffix) && key.length > suffix.length) {
      return `${key.slice(0, -suffix.length)}@${domain}`;
    }
  }
  return key;
}

/** fresh: [{ key, name }] - the notifications to send, owner-only. */
function composeSignupMessages (fresh) {
  const list = (fresh || []).filter((entry) => entry && entry.key);
  if (!list.length) return [];
  const label = ({ key, name }) => {
    const email = emailGuessFromKey(key);
    return name ? `${name} (${email})` : email;
  };
  if (list.length > SIGNUP_MAX_PER_SWEEP) {
    return [{
      title: `${list.length} new Cinema Roll sign-ups`,
      body: list.map(label).join(', '),
      tag: 'signup-batch'
    }];
  }
  return list.map((entry) => ({
    title: 'New Cinema Roll sign-up',
    body: label(entry),
    tag: `signup-${entry.key}`
  }));
}

// --- New theater listings (Matt, 2026-09-28) --------------------------------
//
// "I find myself often going there and refreshing their showtimes listing so
// that I can get tickets for movies that are upcoming." The sweep reads each
// theater's public feed and tells the owner about presentations it hasn't
// seen before. Same shape as sign-ups - silent first run, remembered list -
// with one difference: a listing that leaves the schedule is forgotten after
// LISTINGS_FORGET_MS, so next October's Halloween (1978) is news again, while
// one feed hiccup (a presentation missing for a sweep) is not.

const LISTINGS_MAX_PER_SWEEP = 3;
const LISTINGS_FORGET_MS = 14 * ONE_DAY_MS;

/**
 * Alamo's market feed -> the presentations with at least one session at ONE
 * cinema, each with the earliest local show time. A presentation is one
 * bookable thing (Dune: Part Three, and separately its Big Show advance
 * screening), which is exactly the unit tickets go on sale in.
 */
function alamoListings (feed, cinemaId) {
  const data = (feed && feed.data) || feed || {};
  const sessions = (data.sessions || []).filter((s) => s && s.cinemaId === cinemaId && s.presentationSlug);
  const first = {};
  sessions.forEach((s) => {
    const when = typeof s.showTimeClt === 'string' ? s.showTimeClt : '';
    if (!(s.presentationSlug in first) || (when && when < first[s.presentationSlug])) first[s.presentationSlug] = when;
  });
  const presentations = new Map((data.presentations || []).filter((p) => p && p.slug).map((p) => [p.slug, p]));
  return Object.keys(first).sort().map((slug) => {
    const p = presentations.get(slug);
    const show = (p && p.show) || {};
    const eventLabel = p && p.eventType && typeof p.eventType.title === 'string' ? p.eventType.title.trim() : '';
    const title = typeof show.title === 'string' && show.title.trim() ? show.title.trim() : slug;
    // The feed's poster is 1080x1620; the grid shows it at ~120px wide, and
    // its imgix-style params take a smaller size (19KB instead of 100KB).
    const rawPoster = Array.isArray(show.posterImages) && show.posterImages[0] && typeof show.posterImages[0].uri === 'string' ? show.posterImages[0].uri : null;
    const poster = rawPoster ? rawPoster.replace(/([?&])h=\d+/, '$1h=513').replace(/([?&])w=\d+/, '$1w=342').replace(/([?&])q=\d+/, '$1q=70') : null;
    return {
      slug,
      title: eventLabel && slug !== show.slug ? `${title} (${eventLabel})` : title,
      firstShowTime: first[slug] || null,
      url: `https://drafthouse.com/dc/show/${slug}`,
      poster
    };
  });
}

/**
 * Which listings are new since the stored map, and the map to store next.
 *
 * known: { [slug]: { f: firstSeenAt, l: lastSeenAt } } (a bare number is an
 * older row and counts as both). The first run (nothing stored) announces
 * nothing and records everything on the board. Every listing on the board
 * is re-stamped; one that has been off the board for LISTINGS_FORGET_MS is
 * dropped, so it can be news when it returns.
 */
const seenStamp = (value) => (value && typeof value === 'object' ? { f: Number(value.f) || 0, l: Number(value.l) || 0 } : { f: Number(value) || 0, l: Number(value) || 0 });

function listingsDue ({ known, current, now = Date.now() }) {
  const list = (current || []).filter((entry) => entry && typeof entry.slug === 'string' && entry.slug);
  if (!known || typeof known !== 'object') {
    const seededKnown = {};
    list.forEach(({ slug }) => { seededKnown[slug] = { f: now, l: now }; });
    return { fresh: [], nextKnown: seededKnown, seeded: true };
  }
  const fresh = list.filter(({ slug }) => !(slug in known));
  const nextKnown = {};
  Object.entries(known).forEach(([slug, value]) => {
    const stamp = seenStamp(value);
    if (stamp.l > now - LISTINGS_FORGET_MS) nextKnown[slug] = stamp;
  });
  list.forEach(({ slug }) => { nextKnown[slug] = { f: nextKnown[slug] ? nextKnown[slug].f : now, l: now }; });
  return { fresh, nextKnown, seeded: false };
}

// "2026-12-15T18:00:00" (the cinema's own clock) -> "Tue Dec 15, 6:00 PM".
// String arithmetic on purpose: the feed already speaks local time, and
// Date would re-interpret it in the Lambda's zone.
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function showTimeLabel (clt) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(clt || '');
  if (!m) return '';
  const [y, mo, d] = m.slice(1, 4).map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  const day = `${weekday} ${MONTHS[mo - 1]} ${d}`;
  if (m[4] === undefined) return day;
  const [h, min] = [Number(m[4]), Number(m[5])];
  const hour12 = h % 12 || 12;
  return `${day}, ${hour12}:${String(min).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

// The other theaters have no JSON feed; their public pages are parsed here
// with regexes (no DOM in the Lambda). Each parser is pure: page text in,
// [{ slug, title, firstShowTime, url }] out, same shape as alamoListings.

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '\u2013', mdash: '\u2014', hellip: '\u2026',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
  eacute: 'é', egrave: 'è', euml: 'ë', ecirc: 'ê', aacute: 'á', agrave: 'à', auml: 'ä', acirc: 'â', iacute: 'í', iuml: 'ï',
  oacute: 'ó', ouml: 'ö', ocirc: 'ô', uacute: 'ú', uuml: 'ü', ntilde: 'ñ', ccedil: 'ç'
};
function decodeEntities (text) {
  return String(text || '')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (m, name) => (name.toLowerCase() in NAMED_ENTITIES ? NAMED_ENTITIES[name.toLowerCase()] : m));
}
const stripTags = (html) => decodeEntities(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const MONTH_INDEX = Object.fromEntries(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'].map((name, i) => [name, i + 1]));
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * "Friday 2, October" + "7:00 PM" (Veezi's date labels carry no year) ->
 * "YYYY-MM-DDT19:00:00". The year is the one that puts the date within a
 * week before `now` or any time after; a January listing seen in December
 * is next year, a "yesterday" is this year.
 */
function veeziDateTime (dateLabel, timeLabel, now = Date.now()) {
  const dm = /(\d{1,2}),?\s+([A-Za-z]+)/.exec(dateLabel || '');
  if (!dm) return null;
  const day = Number(dm[1]);
  const month = MONTH_INDEX[dm[2].toLowerCase()];
  if (!month) return null;
  const tm = /(\d{1,2}):(\d{2})\s*([AP]M)/i.exec(timeLabel || '');
  let hour = 0; let minute = 0;
  if (tm) {
    hour = Number(tm[1]) % 12 + (tm[3].toUpperCase() === 'PM' ? 12 : 0);
    minute = Number(tm[2]);
  }
  const nowDate = new Date(now);
  let year = nowDate.getUTCFullYear();
  if (Date.UTC(year, month - 1, day) < now - 7 * ONE_DAY_MS) year += 1;
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}:00`;
}

/**
 * A Veezi "Show Times" page (the Miracle Theatre's ticketing). Films are
 * keyed by Veezi's film code (from the poster URL), which survives a title
 * edit. The page lists every film under every date and again by film, so
 * the same code appears several times: keep the earliest showing and the
 * first ticket link seen for it.
 */
function veeziListings (html, { now = Date.now(), fallbackUrl = null } = {}) {
  const films = new Map();
  const blocks = String(html || '').split(/<div\s+class="film[\s"]/).slice(1);
  for (const block of blocks) {
    const code = (/\bcode=(\d+)/.exec(block) || [])[1];
    const title = stripTags((/<h3 class="title">([\s\S]*?)<\/h3>/.exec(block) || [])[1]);
    if (!code || !title) continue;
    const purchase = (/href="(https?:\/\/[^"]*\/purchase\/[^"]+)"/.exec(block) || [])[1];
    const posterPath = (/src="(\/Media\/Poster\?[^"]+)"/.exec(block) || [])[1];
    const entry = films.get(code) || {
      slug: code,
      title,
      firstShowTime: null,
      url: purchase ? decodeEntities(purchase) : fallbackUrl,
      poster: posterPath ? `https://ticketing.useast.veezi.com${decodeEntities(posterPath)}` : null
    };
    const re = /<h4 class="date">([^<]+)<\/h4>[\s\S]*?<time>([^<]+)<\/time>/g;
    let m;
    while ((m = re.exec(block))) {
      const when = veeziDateTime(m[1], m[2], now);
      if (when && (!entry.firstShowTime || when < entry.firstShowTime)) entry.firstShowTime = when;
    }
    films.set(code, entry);
  }
  return [...films.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * AFI Silver's "Now Playing" page: one `movie_item` per film, linking to
 * movies/detail/<Vista film id>. The page carries no dates, so
 * firstShowTime is null and the push simply names the film.
 */
function afiListings (html) {
  const out = new Map();
  const re = /<div class="movie_item[^"]*">([\s\S]*?)<h3 class="item-title">\s*<a href="https?:\/\/silver\.afi\.com\/movies\/detail\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const [, , id, rawTitle] = m;
    const title = stripTags(rawTitle);
    if (!title || out.has(id)) continue;
    out.set(id, {
      slug: id,
      title,
      firstShowTime: null,
      url: `https://silver.afi.com/movies/detail/${id}`,
      poster: `https://vista.afi.com/CDN/media/entity/get/FilmPosterGraphic/f-${id}?referenceScheme=HeadOffice&allowPlaceHolder=true`
    });
  }
  return [...out.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

/**
 * A Webedia/Boxoffice cinema site (Cinema Arts Theatre): the live
 * `scheduledMovies` call says which movie ids have showtimes and on which
 * days; the site's static movie list supplies titles and paths. A scheduled
 * id missing from the static list still counts - the site rebuilds later
 * than its schedule updates - it just gets its id as a title.
 */
function boxofficeListings (scheduled, movies, siteUrl) {
  const days = (scheduled && scheduled.scheduledDays) || {};
  const byId = new Map(((movies && movies.nodes) || movies || []).filter((m) => m && m.id).map((m) => [String(m.id), m]));
  const base = String(siteUrl || '').replace(/\/$/, '');
  return Object.keys(days).sort().map((id) => {
    const movie = byId.get(id);
    const dates = (days[id] || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return {
      slug: id,
      title: movie && typeof movie.title === 'string' && movie.title.trim() ? movie.title.trim() : `Movie ${id}`,
      firstShowTime: dates[0] || null,
      url: movie && movie.path ? `${base}${movie.path}` : base,
      poster: movie && typeof movie.poster === 'string' && movie.poster ? movie.poster : null
    };
  });
}

/**
 * AFI Silver's film detail page carries the showtimes the grid doesn't:
 * "<p>Monday, September 28, 2026</p> ... <span>9:00 p.m.<span>". Earliest
 * one, as the cinema's local clock. Only fetched for a listing that is
 * about to be announced - 97 detail pages a sweep would be silly.
 */
function afiFirstShowtime (html) {
  let earliest = null;
  const re = /<div class="show_wrap">\s*<p>([^<]+)<\/p>([\s\S]*?)<\/div>/g;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const dm = /([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})/.exec(m[1]);
    if (!dm) continue;
    const month = MONTH_INDEX[dm[1].toLowerCase()];
    if (!month) continue;
    const times = [...m[2].matchAll(/(\d{1,2}):(\d{2})\s*([ap])\.?m\.?/gi)];
    for (const t of times) {
      const hour = Number(t[1]) % 12 + (t[3].toLowerCase() === 'p' ? 12 : 0);
      const when = `${dm[3]}-${pad2(month)}-${pad2(Number(dm[2]))}T${pad2(hour)}:${pad2(Number(t[2]))}:00`;
      if (!earliest || when < earliest) earliest = when;
    }
  }
  return earliest;
}

/**
 * A CinemaClock theater page (cinemaclock.com/movie-theaters/<slug>) - the
 * one readable source for the chains: Regal, AMC and imax.com all answer
 * 403 to a plain fetch, and www.si.edu is bot-walled. Each film block has a
 * showtimes button carrying its id (`btntim aw<id>`); below it, one
 * section per format (`<div data-earliest-date="YYYYMMDD" class="... fie<id>">`)
 * with `filimax` marking the IMAX screen and the day's times as
 * `data-time="HHMM"`. With imaxOnly, only IMAX sections count - Matt wants
 * "what's playing at the IMAX". Without it every screen counts and `imax`
 * says whether the film has an IMAX showing (2026-09-28, later: "I'd be
 * interested in the non-IMAX screens at these other theaters as well"). A section
 * with no times at all is a film on the books but not scheduled (the
 * Smithsonian pages list their documentaries this way) and is skipped.
 */
function cinemaclockListings (html, { imaxOnly = false, url = null } = {}) {
  const text = String(html || '');
  const titles = new Map();
  const blockRe = /<h3 class=['"]movietitle[^'"]*['"][^>]*>([\s\S]*?)<\/h3>([\s\S]*?)(?=<h3 class=['"]movietitle|$)/g;
  let m;
  const years = new Map();
  while ((m = blockRe.exec(text))) {
    const id = (/btntim aw(\d+)/.exec(m[2]) || [])[1];
    const title = stripTags(m[1]);
    if (id && title && !titles.has(id)) titles.set(id, title);
    const genre = (/<p class=['"]moviegenre['"]>([\s\S]*?)<\/p>/.exec(m[2]) || [])[1];
    const year = (/\b((?:19|20)\d{2})\b/.exec(stripTags(genre)) || [])[1];
    if (id && year && !years.has(id)) years.set(id, Number(year));
  }
  const films = new Map();
  const sectionRe = /<div data-earliest-date="(\d{4})(\d{2})(\d{2})" class="([^"]*)">([\s\S]*?)(?=<div data-earliest-date=|<!--MoBl-->|<h3 class=['"]movietitle|$)/g;
  while ((m = sectionRe.exec(text))) {
    const [, y, mo, d, cls, body] = m;
    if (imaxOnly && !/\bfilimax\b/.test(cls)) continue;
    const id = (/\bfie(\d+)/.exec(cls) || [])[1];
    const time = (/data-time="(\d{2})(\d{2})"/.exec(body) || []);
    if (!id || !time[1]) continue;
    const when = `${y}-${mo}-${d}T${time[1]}:${time[2]}:00`;
    const entry = films.get(id) || { slug: id, title: titles.get(id) || `Film ${id}`, firstShowTime: when, url, imax: false, year: years.get(id) || null };
    if (when < entry.firstShowTime) entry.firstShowTime = when;
    if (/\bfilimax\b/.test(cls)) entry.imax = true;
    films.set(id, entry);
  }
  return [...films.values()].sort((a, b) => a.slug.localeCompare(b.slug));
}

// --- The pecking order (Matt, 2026-09-28) ------------------------------------
//
// "If a movie is showing at more than one theater, there's sort of a hierarchy
// of theaters that I care about … I don't really need to know if a movie is
// showing at the Cinema Arts Theater if it's also showing at the Alamo … if
// a movie is showing at one of the IMAXs but is also showing at Alamo, I'm
// still going to go to the Alamo." So a new listing is only news at the best
// theater that has it: THEATERS is ordered, and a fresh listing is dropped
// when any earlier theater's CURRENT board carries the same title.

/**
 * The same film as different theaters spell it. Case, punctuation, a year
 * in brackets, format notes ("in 35mm", "- New Restoration") and Alamo's
 * event suffix all go; "HALLOWEEN (1978) in 35mm" and "Halloween (1978)"
 * meet in the middle. False negatives cost one extra push, so this errs
 * towards matching.
 */
function titleKey (title) {
  return String(title || '')
    .toLowerCase()
    .replace(/\((?:[^()]*)\)/g, ' ')
    .replace(/\b(?:in|on)\s+(?:35|70|16)\s*mm\b/g, ' ')
    .replace(/\b(?:new\s+)?(?:4k\s+)?restoration\b/g, ' ')
    .replace(/\b(?:dubbed|subtitled|encore|advance screening|the big show|insider screening)\b/g, ' ')
    .replace(/[‘’'"`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * fresh: this theater's new listings; betterBoards: the current listings of
 * every theater ranked above it. Returns what is still worth saying, and
 * what was covered (kept for the log).
 */
function uncovered (fresh, betterBoards) {
  const covered = new Set();
  (betterBoards || []).forEach((board) => (board || []).forEach((l) => { const k = titleKey(l && l.title); if (k) covered.add(k); }));
  const keep = []; const dropped = [];
  (fresh || []).forEach((l) => (covered.has(titleKey(l && l.title)) ? dropped : keep).push(l));
  return { keep, dropped };
}

/**
 * What the app shows (2026-09-28: "it would also be great if I could see this
 * somewhere on Cinemaroll, besides just the push notification"). One
 * document, theaters in pecking order, every listing with when it was first
 * seen and which better theater (if any) also has the film. boards:
 * [{ theater: { key, name, url }, listings|null }]; knownByKey: the stored
 * seen-maps AFTER this sweep. Firebase rejects undefined, so nulls.
 */
function boardForApp (boards, knownByKey, now = Date.now()) {
  const better = [];
  const theaters = (boards || []).map(({ theater, listings }) => {
    const known = (knownByKey && knownByKey[theater.key]) || {};
    const rows = (listings || []).map((l) => {
      const key = titleKey(l.title);
      const cover = better.find((b) => b.keys.has(key));
      return {
        slug: l.slug,
        title: l.title,
        firstShowTime: l.firstShowTime || null,
        url: l.url || theater.url || null,
        imax: Boolean(l.imax),
        poster: typeof l.poster === 'string' && l.poster ? l.poster : null,
        year: Number.isInteger(l.year) ? l.year : null,
        firstSeenAt: seenStamp(known[l.slug]).f || now,
        coveredBy: cover ? cover.key : null
      };
    });
    if (listings) better.push({ key: theater.key, keys: new Set(rows.map((r) => titleKey(r.title)).filter(Boolean)) });
    return { key: theater.key, name: theater.name, url: theater.url || null, ok: Boolean(listings), listings: rows };
  });
  return { updatedAt: now, theaters };
}

/**
 * fresh: alamoListings entries. theater: { key, name, url }. Up to
 * LISTINGS_MAX_PER_SWEEP separate pushes, each tapping through to that
 * listing's ticket page; more than that is one summary that opens the
 * theater's schedule. Tags carry the slug so two listings never replace each
 * other in Notification Center.
 */
function composeListingMessages (fresh, theater) {
  const list = (fresh || []).filter((entry) => entry && entry.slug);
  if (!list.length) return [];
  const name = (theater && theater.name) || 'the theater';
  const key = (theater && theater.key) || 'theater';
  if (list.length > LISTINGS_MAX_PER_SWEEP) {
    return [{
      title: `${list.length} new listings at ${name}`,
      body: list.map((entry) => entry.title).join(', '),
      tag: `listing-${key}-batch-${list[0].slug}`,
      navigate: (theater && theater.url) || '/'
    }];
  }
  return list.map((entry) => {
    const when = showTimeLabel(entry.firstShowTime);
    const title = entry.imax ? `${entry.title} (IMAX)` : entry.title;
    return {
      title: `New at ${name}`,
      body: when ? `${title} · ${/,/.test(when) ? 'first showing' : 'from'} ${when}` : title,
      tag: `listing-${key}-${entry.slug}`,
      navigate: entry.url || (theater && theater.url) || '/'
    };
  });
}

module.exports = {
  LISTINGS_MAX_PER_SWEEP,
  LISTINGS_FORGET_MS,
  alamoListings,
  listingsDue,
  showTimeLabel,
  decodeEntities,
  veeziDateTime,
  veeziListings,
  afiListings,
  boxofficeListings,
  afiFirstShowtime,
  cinemaclockListings,
  titleKey,
  uncovered,
  boardForApp,
  composeListingMessages,
  SIGNUP_MAX_PER_SWEEP,
  signupsDue,
  emailGuessFromKey,
  composeSignupMessages,
  friendLogBody,
  EXTERNAL_MAX_AGE_MS,
  EXTERNAL_MAX_PER_FRIEND,
  externalWatches,
  externalLogsDue,
  ONE_DAY_MS,
  ACTIVE_IN_APP_MS,
  STALE_REMINDER_MS,
  DEFAULT_CADENCE,
  DEFAULT_WINDOW_START,
  DEFAULT_WINDOW_END,
  DEFAULT_PER_DAY,
  EMPTY_BASELINE,
  dueFromDigest,
  newsIn,
  anythingDue,
  nextBaseline,
  spacingMs,
  shouldSend,
  composeMessage,
  stickinessLead,
  DEFAULT_GAMES_HOUR,
  localDateKey,
  gamesDue,
  shouldSendGames,
  composeGamesMessage
};
