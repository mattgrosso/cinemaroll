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

module.exports = {
  friendLogBody,
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
