// The header's tap-to-home, and a record of how the last few went.
//
// Bug report (Matt, 2026-10-07, on every screen): "I see the button press
// like I can see that reacting to my tap, but then nothing happens and I
// have to tap it a second time." The press showing means iOS felt the
// finger; what never came was the trip home. iOS only turns a touch into a
// click when it's sure the touch was a tap, and the title used to shrink
// 2% under the finger (.tap-feedback), which is the kind of movement that
// can make it decide otherwise. So the header now goes home on the finger
// LIFTING (isHeaderTap below), doesn't wait for the click, and no longer
// moves under the finger.
//
// It was never reproduced, so every header touch is also recorded, and bug
// reports carry the last few (bugReports.js `headerTouches`): did the
// finger land, did iOS's click come through, did the trip home start, and
// did it arrive, stall, or get cancelled.

// How far a finger may wander and still be tapping, not dragging. iOS's
// own tap slop is about this.
export const TAP_SLOP_PX = 10;
// A press held longer than this is a long-press, not a tap.
export const TAP_MAX_MS = 1000;
// A trip home that hasn't settled by now is recorded as stalled (and
// updated if it settles later).
export const STALL_MS = 3000;
const KEEP = 5;

export function isHeaderTap ({ startX, startY, endX, endY, startAt, endAt }) {
  if ([startX, startY, endX, endY].some((value) => typeof value !== 'number')) return false;
  const moved = Math.hypot(endX - startX, endY - startY);
  return moved <= TAP_SLOP_PX && (endAt - startAt) <= TAP_MAX_MS;
}

let touches = [];

/** Start a record for one header touch (or a click that came with no touch). */
export function recordHeaderTouch ({ route = null, landed = true, now = Date.now } = {}) {
  const entry = {
    at: new Date(now()).toISOString(),
    route,
    landed,
    lifted: null,
    movedPx: null,
    click: false,
    homeStarted: null,
    outcome: null,
    ms: null
  };
  touches.push(entry);
  if (touches.length > KEEP) touches = touches.slice(-KEEP);
  return entry;
}

export function getHeaderTouches () {
  return touches.map((entry) => ({ ...entry }));
}

export function clearHeaderTouches () {
  touches = [];
}

// vue-router 4's NavigationFailureType values, named for a person reading
// a report.
const FAILURE_NAMES = { 4: 'aborted', 8: 'cancelled', 16: 'duplicated' };

/**
 * Record what became of the trip home `navigation` (router.push's promise)
 * on `entry`: 'arrived', 'aborted'/'cancelled'/'duplicated', 'error: …',
 * and 'stalled' in the meantime if it takes longer than STALL_MS.
 */
export function trackTripHome (entry, navigation, { via, now = Date.now, stallMs = STALL_MS } = {}) {
  const startedAt = now();
  entry.homeStarted = via;
  entry.outcome = 'pending';
  const stallTimer = setTimeout(() => {
    if (entry.outcome === 'pending') entry.outcome = 'stalled';
  }, stallMs);
  const settle = (outcome) => {
    clearTimeout(stallTimer);
    entry.outcome = outcome;
    entry.ms = now() - startedAt;
  };
  return Promise.resolve(navigation).then(
    (failure) => settle(failure ? (FAILURE_NAMES[failure.type] || `failed:${failure.type}`) : 'arrived'),
    (error) => settle(`error: ${error?.message || error}`)
  );
}
