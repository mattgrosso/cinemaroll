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

// --- Friend requests --------------------------------------------------------
//
// Matt, 2026-10-01: "I should get a notification so I know that they're in my
// film club now." Two moments, both announced by the client that made them
// and CHECKED here against the friend graph, so a caller can only ever
// trigger a push about something that is really true:
//   'request'  - I sent toKey a request: my edge to them exists, their inbox
//                holds it, and theirs to me doesn't (that would be a friendship).
//   'accepted' - I accepted toKey's request: both edges now exist.
// Returns { title, body, navigate, tag } or null. The tag is per sender, so a
// repeated announcement replaces the notification instead of stacking.
const FRIEND_REQUEST_KINDS = ['request', 'accepted'];

function friendRequestMessage ({ kind, myKey, toKey, edges, request, name }) {
  if (!FRIEND_REQUEST_KINDS.includes(kind) || !myKey || !toKey || myKey === toKey) return null;
  const mine = edges?.[myKey]?.[toKey];
  const theirs = edges?.[toKey]?.[myKey];
  const who = (typeof name === 'string' && name.trim()) || 'Someone';
  if (kind === 'request') {
    if (!mine || theirs || !request) return null;
    return {
      title: `${who} sent you a friend request`,
      body: 'Open Film Club to accept it.',
      navigate: '/film-club',
      tag: `friend-request-${myKey}`
    };
  }
  if (!mine || !theirs) return null;
  return {
    title: `${who} accepted your friend request`,
    body: "They're in your Film Club now.",
    navigate: '/film-club',
    tag: `friend-accepted-${myKey}`
  };
}

// --- End-of-day friends -----------------------------------------------------
//
// Matt, 2026-09-30: some of his Film Club are coworkers, and "I would rather
// not see exactly when I watch a movie, cause sometimes I watch it during the
// day". Each outgoing friend edge `social/friends/<owner>/<friend>` is `true`
// (right away) or 'day' (end of day). The database rules keep a 'day' friend
// out of `social/profiles/<owner>`; they read `social/dayProfiles/<owner>`
// instead — the copy built here, holding nothing watched since the owner's
// last midnight and no time of day on anything. Their friend-log pushes skip
// the instant fan-out and arrive as one push after midnight.

const DAY_FRIEND = 'day';

/** How far `tz`'s wall clock is ahead of UTC at `at`, in ms. */
function tzOffsetMs (tz, at) {
  try {
    const parts = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(new Date(at)).forEach((part) => { parts[part.type] = part.value; });
    const wall = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day),
      Number(parts.hour) % 24, Number(parts.minute), Number(parts.second));
    return wall - Math.floor(at / 1000) * 1000;
  } catch {
    return 0;
  }
}

/** Epoch ms of the local midnight that starts `at`'s day in `tz`. */
function localDayStart (tz, at) {
  const [y, m, d] = localDateKey(tz, at).split('-').map(Number);
  const wallMidnight = Date.UTC(y, m - 1, d);
  // Twice, so a DST change between midnight and `at` can't skew it.
  return wallMidnight - tzOffsetMs(tz, wallMidnight - tzOffsetMs(tz, at));
}

/** The midnight after `at` — when an end-of-day friend first sees it. */
function nextLocalMidnight (tz, at) {
  return localDayStart(tz, localDayStart(tz, at) + 26 * 60 * 60 * 1000);
}

// A viewing's time with the time of day taken out: noon UTC of the OWNER's
// local date, which is the same calendar date for any reader between UTC-11
// and UTC+11. Readers treat an item marked `d` as a date, never "3h ago".
function dayStamp (tz, at) {
  const [y, m, d] = localDateKey(tz, at).split('-').map(Number);
  return Date.UTC(y, m - 1, d, 12);
}

/**
 * The end-of-day copy of a published profile (social.js buildSocialProfile's
 * shape). `cutoff` is the owner's most recent midnight: anything watched at
 * or after it is withheld — a rewatch falls back to its previous viewing, a
 * first watch disappears (from the feed, the ratings map, the top shelf,
 * the crown and the counts). Every remaining time becomes a date.
 */
function dayProfileFrom (profile, { cutoff, tz }) {
  if (!profile) return null;
  const hidden = (at) => Number(at) >= cutoff;
  const dated = (views) => (Array.isArray(views) ? views : [])
    .filter((view) => view && Number.isFinite(Number(view.at)));

  // The last viewing before midnight, from the ratings map's per-viewing
  // list (only a ratings sharer publishes one).
  const earlierViewing = (id) => {
    const kept = dated(profile.ratings?.[String(id)]?.v).filter((view) => !hidden(view.at));
    return kept.sort((a, b) => b.at - a.at)[0] || null;
  };

  const withheld = new Set();   // ids that exist only because of today
  let withheldViewings = 0;

  let ratings;
  if (profile.ratings) {
    ratings = {};
    Object.entries(profile.ratings).forEach(([id, row]) => {
      if (!row) return;
      const views = dated(row.v);
      const kept = views.filter((view) => !hidden(view.at));
      withheldViewings += views.length - kept.length;
      let at = row.at;
      if (hidden(at)) {
        if (!kept.length) { withheld.add(String(id)); return; }
        at = Math.max(...kept.map((view) => Number(view.at)));
      }
      const next = { ...row, at: Number.isFinite(Number(at)) ? dayStamp(tz, at) : at };
      if (row.v) next.v = kept.map((view) => ({ ...view, at: dayStamp(tz, view.at) }));
      ratings[id] = next;
    });
  }

  const recent = [];
  (profile.recent || []).forEach((item) => {
    if (!item || !Number.isFinite(Number(item.at))) return;
    let at = item.at;
    let medium = item.m;
    if (hidden(at)) {
      const earlier = earlierViewing(item.id);
      if (!earlier) {
        if (!ratings) { withheld.add(String(item.id)); withheldViewings += 1; }
        return;
      }
      at = earlier.at;
      medium = earlier.m;
    }
    const { m, ...rest } = item;
    recent.push({
      ...rest,
      ...(medium ? { m: medium } : {}),
      at: dayStamp(tz, at),
      d: 1,
      // When an end-of-day reader first saw it: the Film Club badge counts
      // from here, since `at` (a date) would read as already seen.
      pub: nextLocalMidnight(tz, at)
    });
  });
  recent.sort((a, b) => b.at - a.at);

  const counts = profile.counts ? {
    titles: ratings ? Object.keys(ratings).length : Math.max(0, (profile.counts.titles || 0) - withheld.size),
    viewings: Math.max(0, (profile.counts.viewings || 0) - withheldViewings)
  } : profile.counts;

  const withheldTitles = new Set();
  (profile.recent || []).forEach((item) => {
    if (withheld.has(String(item?.id))) withheldTitles.add(`${item.t}|${item.p}`);
  });
  const crown = profile.crown && withheldTitles.has(`${profile.crown.t}|${profile.crown.p}`) ? null : (profile.crown || null);

  const copy = {
    ...profile,
    updatedAt: Math.min(Number(profile.updatedAt) || cutoff, cutoff),
    counts,
    topShelf: (profile.topShelf || []).filter((item) => !withheld.has(String(item?.id))),
    recent,
    crown,
    dayOnly: true,
    release: { cutoff, source: profile.updatedAt || null }
  };
  if (ratings) copy.ratings = ratings;
  else delete copy.ratings;
  return copy;
}

/**
 * Every owner with at least one MUTUAL end-of-day friend:
 * { [ownerKey]: [friendKey, ...] }. A one-sided 'day' edge is a pending
 * request, which grants nothing to hide from.
 */
function dayFriendsByOwner (edges) {
  const owners = {};
  Object.entries(edges || {}).forEach(([owner, outgoing]) => {
    const friends = Object.keys(outgoing || {}).filter((friend) =>
      friend !== owner && outgoing[friend] === DAY_FRIEND && edges?.[friend]?.[owner]);
    if (friends.length) owners[owner] = friends;
  });
  return owners;
}

/**
 * Should the sweep rebuild an owner's copy, and may it announce? Rebuilt when
 * the owner's midnight has passed or they republished; never announced on
 * the first copy (switching a friend to end of day is not news).
 */
function dayCopyDue ({ release, cutoff, source }) {
  if (!release) return { rebuild: true, announce: false };
  if (release.cutoff !== cutoff || release.source !== source) return { rebuild: true, announce: true };
  return { rebuild: false, announce: false };
}

/**
 * What an end-of-day friend hasn't been told about: feed items in the new
 * copy that weren't in the old one, oldest first. Keyed by film AND date, so
 * a rewatch released tonight is news even though the film was already there.
 * `since` bounds it, so a long-stale copy can't announce a backlog.
 */
function dayNews (previousRecent, nextRecent, { since = 0 } = {}) {
  const seen = new Set((previousRecent || []).filter(Boolean).map((item) => `${item.id}|${item.at}`));
  return (nextRecent || [])
    .filter((item) => item && !seen.has(`${item.id}|${item.at}`) && Number(item.pub || item.at) >= since)
    // The feed is newest first and a day's films share one date, so reverse
    // before the (stable) sort to keep the order they were watched in.
    .reverse()
    .sort((a, b) => a.at - b.at);
}

/** The one push an end-of-day friend gets, after the owner's midnight. */
function composeDayMessage (name, films) {
  if (!films || !films.length) return null;
  if (films.length === 1) {
    return {
      title: `${name} logged ${films[0].t}`,
      body: friendLogBody(null),
      navigate: films[0].id ? `/movie/${films[0].id}` : '/film-club'
    };
  }
  const titles = films.map((film) => film.t);
  const shown = titles.slice(0, 4);
  const rest = titles.length - shown.length;
  return {
    title: `${name} logged ${films.length} films`,
    body: rest > 0 ? `${shown.join(', ')} and ${rest} more.` : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}.`,
    navigate: '/film-club'
  };
}

// --- End of day for friends on other apps -----------------------------------
//
// Matt, 2026-10-01: he wanted the same Right away / End of day switch for his
// Movie Log friends, "so they all looked the same on my page". They read ONE
// public Interchange feed (clubFeed/<owner>/<secret>), and Movie Log treats a
// new feed link as a new person, so it is one switch for all of them, not one
// per friend. With it on, the app parks its live feed at the private
// social/clubFeedLive/<owner> and the sweep publishes this copy instead:
// nothing watched since the owner's last midnight, and every viewing a date.

/**
 * The end-of-day copy of an Interchange feed (interchange.js toInterchange's
 * shape). Viewings at or after `cutoff` are withheld — a rewatch keeps its
 * earlier viewings, a film first watched today leaves the feed — and the rest
 * become noon UTC of the owner's local date, like dayProfileFrom's. `marker`
 * is supplied by the caller: the feed's own is a publish time, and Movie Log
 * may read it as "something changed".
 */
function dayFeedFrom (feed, { cutoff, tz, marker }) {
  if (!feed || !Array.isArray(feed.movies)) return null;
  const movies = [];
  feed.movies.forEach((movie) => {
    if (!movie) return;
    const viewings = Array.isArray(movie.viewings) ? movie.viewings : [];
    const kept = viewings.filter((viewing) => viewing && Number.isFinite(Number(viewing.watchedAt)) && Number(viewing.watchedAt) < cutoff);
    if (viewings.length && !kept.length) return;
    const next = { ...movie };
    if (viewings.length) next.viewings = kept.map((viewing) => ({ ...viewing, watchedAt: dayStamp(tz, Number(viewing.watchedAt)) }));
    movies.push(next);
  });
  return { ...feed, marker, movieCount: movies.length, movies, dayOnly: true };
}

/**
 * The marker for a rebuilt copy: the midnight itself on the first build of a
 * day, one more than last time on a same-day rebuild (the owner republished).
 * Either way it moves when the copy might have, and never tells anyone when
 * the app was opened.
 */
function dayFeedMarker (release, cutoff) {
  if (release && release.cutoff === cutoff && Number.isFinite(Number(release.marker))) return Number(release.marker) + 1;
  return cutoff;
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

// A push body shows this many titles, then "and N more".
const LISTINGS_TITLES_SHOWN = 6;
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
  // A film's page lives under the market's full slug: drafthouse.com/dc/show/…
  // (the short form the first version guessed) lands on Alamo's "not found"
  // page (report 2026-09-29). The feed names its own market, so read it.
  const market = (Array.isArray(data.market) && data.market[0] && typeof data.market[0].slug === 'string' && data.market[0].slug) || 'dc-metro-area';
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
      url: `https://drafthouse.com/${market}/show/${slug}?cinemaId=${cinemaId}`,
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
const seenStamp = (value) => {
  if (value && typeof value === 'object') {
    const stamp = { f: Number(value.f) || 0, l: Number(value.l) || 0 };
    if (typeof value.s === 'string' && value.s) stamp.s = value.s;
    if (value.z) stamp.z = 1;
    return stamp;
  }
  return { f: Number(value) || 0, l: Number(value) || 0 };
};

function listingsDue ({ known, current, now = Date.now() }) {
  const list = (current || []).filter((entry) => entry && typeof entry.slug === 'string' && entry.slug);
  if (!known || typeof known !== 'object') {
    const seededKnown = {};
    // z: on the board before anyone was watching - the baseline, not news,
    // so the app never badges a new follower's whole first board as "new".
    list.forEach(({ slug }) => { seededKnown[slug] = { f: now, l: now, z: 1 }; });
    return { fresh: [], nextKnown: seededKnown, seeded: true };
  }
  const fresh = list.filter(({ slug }) => !(slug in known));
  const nextKnown = {};
  Object.entries(known).forEach(([slug, value]) => {
    const stamp = seenStamp(value);
    if (stamp.l > now - LISTINGS_FORGET_MS) nextKnown[slug] = stamp;
  });
  list.forEach(({ slug, firstShowTime }) => {
    const prior = nextKnown[slug];
    nextKnown[slug] = { f: prior ? prior.f : now, l: now };
    if (prior && prior.z) nextKnown[slug].z = 1;
    // A showtime learned once (from a detail page) or carried by the feed is
    // kept, so the app's board has it without asking again.
    const showtime = (typeof firstShowTime === 'string' && firstShowTime) || (prior && prior.s);
    if (showtime) nextKnown[slug].s = showtime;
  });
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
 * id missing from the static list is left out until it appears there - the
 * site rebuilds later than its schedule updates, and a bare ten-digit id is
 * no use as a title (2026-09-29 report). Left out means not recorded as
 * seen, so the film is announced by name once the list catches up.
 */
function boxofficeListings (scheduled, movies, siteUrl) {
  const days = (scheduled && scheduled.scheduledDays) || {};
  const byId = new Map(((movies && movies.nodes) || movies || []).filter((m) => m && m.id).map((m) => [String(m.id), m]));
  const base = String(siteUrl || '').replace(/\/$/, '');
  return Object.keys(days).sort().flatMap((id) => {
    const movie = byId.get(id);
    const title = movie && typeof movie.title === 'string' ? movie.title.trim() : '';
    if (!title) return [];
    const dates = (days[id] || []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    return {
      slug: id,
      title,
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

// --- Anyone's theaters (2026-09-30) -------------------------------------------
//
// "We really built it just with me in mind … we should figure out how to get
// this configured so that other people could set it up for their own local
// theaters … give a zip code or something, and then it would have to present
// them with a bunch of theaters, and then they would have to rank them." A zip
// becomes a town (zippopotam.us), the town becomes CinemaClock's city page,
// which lists every theater around it nearest first; a follower's pick is a
// CinemaClock slug, read by cinemaclockListings like the IMAXs.

const MAX_FOLLOWED_THEATERS = 12;
const NEARBY_THEATERS_SHOWN = 40;

/** "Takoma Park", "MD" -> "takoma-park-md", the city page's path. */
function cinemaclockCitySlug (place, state) {
  const slug = (value) => String(value || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const a = slug(place); const b = slug(state);
  return a && /^[a-z]{2}$/.test(b) ? `${a}-${b}` : null;
}

/**
 * CinemaClock's /<city>/movie-theaters page -> [{ key, name, address,
 * distance, chain, films }] nearest first. Closed theaters go; one with no
 * films on CinemaClock stays but says so (films: 0) - it may be a theater
 * CinemaClock doesn't carry showtimes for, which the picker should admit.
 */
function cinemaclockCityTheaters (html) {
  const text = String(html || '');
  const seen = new Set();
  const theaters = [];
  const blockRe = /<div class="cinemablock(?: [^"]*)?"([^>]*)>([\s\S]*?)(?=<div class="cinemablock[ "]|$)/g;
  let m;
  while ((m = blockRe.exec(text))) {
    const [, attrs, body] = m;
    const key = (/href="\/movie-theaters\/([a-z0-9-]+)" class="cinemaname"/.exec(body) || [])[1];
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const head = (/<h3>([\s\S]*?)<\/h3>/.exec(body) || [])[1] || '';
    if (/class="warning">\s*CLOSED/i.test(head)) continue;
    const chain = stripTags((/<s class="chain">([\s\S]*?)<\/s>/.exec(head) || [])[1]);
    const name = stripTags(head.replace(/<s class="chain">[\s\S]*?<\/s>/, '').replace(/<svg[\s\S]*?<\/svg>/g, ''));
    const address = stripTags((/<em class="address">([\s\S]*?)<\/em>/.exec(body) || [])[1]);
    const distance = Number((/data-distance="([\d.]+)"/.exec(attrs) || [])[1]);
    const mids = (/data-mids="\[([^\]]*)\]"/.exec(attrs) || [])[1];
    const films = mids === undefined ? null : mids.split(',').filter((id) => /\d/.test(id)).length;
    if (!name) continue;
    theaters.push({ key, name, address: address || null, distance: Number.isFinite(distance) ? Math.round(distance * 10) / 10 : null, chain: chain || null, films });
  }
  // The page is only roughly in order; a stable sort keeps its ties.
  const far = (t) => (t.distance === null ? Infinity : t.distance);
  return theaters.sort((a, b) => far(a) - far(b)).slice(0, NEARBY_THEATERS_SHOWN);
}

/**
 * The follower's ranked list as stored ({ theaters: [{ key, name }] }) ->
 * the clean ordered list the sweep walks: valid keys only, no repeats, the
 * best theater first, at most MAX_FOLLOWED_THEATERS.
 */
function followedTheaters (follow) {
  const raw = follow && Array.isArray(follow.theaters) ? follow.theaters
    : follow && follow.theaters && typeof follow.theaters === 'object' ? Object.values(follow.theaters) : [];
  const seen = new Set();
  const out = [];
  raw.forEach((t) => {
    const key = t && typeof t.key === 'string' ? t.key : null;
    if (!key || !/^[a-z0-9-]{1,80}$/.test(key) || seen.has(key)) return;
    seen.add(key);
    out.push({ key, name: typeof t.name === 'string' && t.name.trim() ? t.name.trim().slice(0, 80) : key });
  });
  return out.slice(0, MAX_FOLLOWED_THEATERS);
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
      const stamp = known[l.slug];
      return {
        slug: l.slug,
        title: l.title,
        // A theater whose grid has no dates (AFI) gets them backfilled into
        // the seen-state a few films a sweep; the board shows what's known.
        firstShowTime: l.firstShowTime || (stamp && typeof stamp === 'object' && typeof stamp.s === 'string' ? stamp.s : null),
        url: l.url || theater.url || null,
        imax: Boolean(l.imax),
        poster: typeof l.poster === 'string' && l.poster ? l.poster : null,
        year: Number.isInteger(l.year) ? l.year : null,
        // 0 = part of the first board recorded, never shown as new.
        firstSeenAt: seenStamp(known[l.slug]).z ? 0 : (seenStamp(known[l.slug]).f || now),
        coveredBy: cover ? cover.key : null
      };
    });
    if (listings) better.push({ key: theater.key, keys: new Set(rows.map((r) => titleKey(r.title)).filter(Boolean)) });
    return { key: theater.key, name: theater.name, url: theater.url || null, ok: Boolean(listings), listings: rows };
  });
  return { updatedAt: now, theaters };
}

// --- Reminders (Matt, 2026-09-28) --------------------------------------------
//
// "Swipe left can be remind me again one week before the showtime. And if
// it's already within one week, remind me again the day before." The app
// writes `theaters/reminders/<theaterKey>/<slug>` = { remindAt, title,
// theaterName, url, firstShowTime, setAt }; the sweep sends each one whose
// time has come and stamps sentAt, so the card can return to the screen.

/** reminders: { [theaterKey]: { [slug]: reminder } } -> the ones to send now. */
function remindersDue (reminders, now = Date.now()) {
  const due = [];
  Object.entries(reminders || {}).forEach(([theaterKey, slugs]) => {
    Object.entries(slugs || {}).forEach(([slug, r]) => {
      if (!r || typeof r !== 'object') return;
      const remindAt = Number(r.remindAt);
      if (!remindAt || remindAt > now || r.sentAt) return;
      due.push({ theaterKey, slug, ...r });
    });
  });
  return due.sort((a, b) => a.remindAt - b.remindAt);
}

// --- Showtimes on the icon badge (Matt, 2026-10-05) --------------------------
//
// "Movies in the Showtime screen that I have not yet either dismissed or
// snoozed should contribute to my badge count ... it should be off by
// default." One per film still waiting on the board: not dismissed, not
// snoozed (a reminder set and not yet sent - a sent one is back on screen),
// and not a film a better theater on the list also has. Counted only with
// prefs.showtimes === true. Mirrored in src/assets/javascript/
// showtimesUnread.js; src/test/showtimesBadge.test.js pins the two together.
function showtimesWaiting (board, dismissed, reminders) {
  const theaters = board && Array.isArray(board.theaters) ? board.theaters : [];
  let count = 0;
  theaters.forEach((t) => (Array.isArray(t.listings) ? t.listings : []).forEach((l) => {
    if (l.coveredBy) return;
    if (dismissed && dismissed[t.key] && dismissed[t.key][l.slug]) return;
    const r = reminders && reminders[t.key] && reminders[t.key][l.slug];
    if (r && !r.sentAt) return;
    count += 1;
  }));
  return count;
}

function composeReminderMessage (reminder) {
  const when = showTimeLabel(reminder.firstShowTime);
  const where = reminder.theaterName ? ` at ${reminder.theaterName}` : '';
  return {
    title: `Reminder: ${reminder.title || 'a film you flagged'}`,
    body: when ? `${/,/.test(when) ? 'First showing' : 'From'} ${when}${where}` : `On the board${where}`,
    tag: `remind-${reminder.theaterKey}-${reminder.slug}-${Number(reminder.remindAt) || 0}`,
    navigate: `/showtimes?focus=${reminder.theaterKey}/${reminder.slug}`
  };
}

/**
 * fresh: every listing announced this sweep, from every theater. ONE push,
 * titles only ("When a bunch of movies get found at theaters there are too
 * many notifications … I don't think the notification needs to mention the
 * theater", 2026-09-29); a film named twice is named once, and a long list
 * ends "and N more". The tap lands on the Showtimes screen - never on a
 * theater's site ("that's useless to me. It's with ads", 2026-09-28).
 */
function composeListingMessages (fresh) {
  const list = (fresh || []).filter((entry) => entry && entry.slug);
  if (!list.length) return [];
  const titles = [...new Set(list.map((entry) => entry.title || entry.slug))];
  const rest = titles.length - LISTINGS_TITLES_SHOWN;
  const body = titles.slice(0, LISTINGS_TITLES_SHOWN).join(', ') + (rest > 0 ? ` and ${rest} more` : '');
  return [{
    title: 'New showtimes',
    body,
    tag: `listings-${list[0].slug}`,
    navigate: '/showtimes'
  }];
}

module.exports = {
  MAX_FOLLOWED_THEATERS,
  NEARBY_THEATERS_SHOWN,
  cinemaclockCitySlug,
  cinemaclockCityTheaters,
  followedTheaters,
  LISTINGS_TITLES_SHOWN,
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
  remindersDue,
  showtimesWaiting,
  composeReminderMessage,
  composeListingMessages,
  SIGNUP_MAX_PER_SWEEP,
  signupsDue,
  emailGuessFromKey,
  composeSignupMessages,
  friendLogBody,
  friendRequestMessage,
  DAY_FRIEND,
  localDayStart,
  nextLocalMidnight,
  dayStamp,
  dayProfileFrom,
  dayFeedFrom,
  dayFeedMarker,
  dayFriendsByOwner,
  dayCopyDue,
  dayNews,
  composeDayMessage,
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
