// The number on the home-screen icon: how many chores are waiting.
//
// Bug report (Matt, 2026-09-27): "This app never shows badges when it has
// things I need to do." Only a chore push ever SET the badge, and opening the
// app cleared it outright — so with the app used daily, the icon was blank
// while stickiness ratings, a tiebreak and award years sat waiting.
//
// Now the app sets it itself, from the same digest the push reads, with the
// same arithmetic as the Lambda's badge (aws-lambda/pushCadence.js
// dueFromDigest): stickiness films + 1 for a tiebreak + each award year.
// A prompt that's disabled, or paused by its daily quota, isn't counted —
// the badge must never promise work the app won't show when you open it.
// pushCadence.js is CommonJS for the Lambda, so this is a mirror rather than
// an import; src/test/appBadge.test.js pins the two together.
//
// Film Club activity is deliberately not counted here. A friend-log push adds
// one to the badge; the app setting the chore count on open is what drops it.

export function appBadgeCount (digest, prefs = {}, now = Date.now()) {
  const open = (section) => {
    const at = Number(section?.eligibleAt);
    return !Number.isFinite(at) || at <= now;
  };

  const pinned = Boolean(digest?.tiebreak?.pinned) && prefs?.tiebreak !== false;

  const stickiness = (prefs?.stickiness === false || pinned || !open(digest?.stickiness))
    ? 0
    : (digest?.stickiness?.count || 0) +
      (digest?.stickiness?.dueTimes || []).filter((time) => time <= now).length;

  const tiebreak = (prefs?.tiebreak !== false && open(digest?.tiebreak) && digest?.tiebreak?.due) ? 1 : 0;

  const awards = (prefs?.awards === false || pinned || !open(digest?.awards))
    ? 0
    : (digest?.awards?.years || []).length;

  return stickiness + tiebreak + awards;
}
