// The push sweep's clock (Sentry, 2026-10-21: "cinemaroll-push is about to
// time out", back a week after every request got its own deadline).
//
// Per-request deadlines weren't enough: the sweep walks every account, friend
// feed and theater one after another, so on a morning when Firebase answered
// slowly (5-15s a read, some 500s) a sweep that takes 14s on a good evening
// ran past 60s on most runs, logging nothing on the way. Lambda then retried
// each one twice, which added load to the database that was already slow.
//
// So the sweep carries a clock: each stage is timed and logged as it ends
// (a run that dies still says how far it got), accounts are worked a few at a
// time, no new unit of work starts once the reserve is reached, and no
// request is allowed to outlive the invocation. What's skipped waits for the
// next sweep, 15 minutes later. Pure and dependency-free; tested from
// src/test/sweepClock.test.js.

/** Run `fn` over `items`, at most `limit` at once. Resolves in input order. */
async function mapLimit (items, limit, fn) {
  const list = Array.from(items || []);
  const results = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next;
      next += 1;
      results[i] = await fn(list[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, list.length)) }, worker));
  return results;
}

/**
 * The list started at a different place each sweep, so when time runs out it
 * isn't always the same accounts that wait. `turn` is any integer that moves
 * once a sweep (the 15-minute slot number).
 */
function rotate (list, turn) {
  const n = list.length;
  if (!n) return [];
  const k = ((Math.trunc(turn) % n) + n) % n;
  return list.slice(k).concat(list.slice(0, k));
}

/**
 * A request's deadline, never later than the invocation's own end less
 * `marginMs`, and never under `floorMs` (a request with no time at all is a
 * guaranteed failure; a short one may still land). No deadline known: `ms`.
 */
function requestDeadline (ms, deadlineAt, now, { marginMs = 2000, floorMs = 1000 } = {}) {
  if (!Number.isFinite(deadlineAt)) return ms;
  return Math.max(floorMs, Math.min(ms, deadlineAt - now - marginMs));
}

/**
 * `deadlineAt`: when the invocation is killed (epoch ms), or null if unknown.
 * `reserveMs`: no new work starts with less than this left.
 */
function createSweepClock ({ deadlineAt = null, reserveMs = 10000, now = Date.now, log = console.log } = {}) {
  const startedAt = now();
  const stages = [];
  const skipped = {};

  const left = () => (Number.isFinite(deadlineAt) ? deadlineAt - now() : Infinity);
  const outOfTime = () => left() < reserveMs;

  /** Note that `count` units of `stage` were left for the next sweep. */
  const skip = (stage, count = 1) => {
    if (count > 0) skipped[stage] = (skipped[stage] || 0) + count;
  };

  /** Time `fn` as stage `name`; skipped outright if the reserve is reached. */
  const stage = async (name, fn) => {
    if (outOfTime()) {
      skip(name);
      log(`Sweep stage ${name}: skipped, ${Math.round(left() / 1000)}s left`);
      return undefined;
    }
    const at = now();
    try {
      return await fn();
    } finally {
      const ms = now() - at;
      stages.push({ name, ms });
      log(`Sweep stage ${name}: ${(ms / 1000).toFixed(1)}s`);
    }
  };

  /** One line for the end of the sweep: total, each stage, anything skipped. */
  const summary = () => {
    const parts = stages.map((s) => `${s.name} ${(s.ms / 1000).toFixed(1)}s`);
    const waits = Object.entries(skipped).map(([name, count]) => `${name} x${count}`);
    return `Sweep took ${((now() - startedAt) / 1000).toFixed(1)}s (${parts.join(', ') || 'no stages'})` +
      (waits.length ? `; out of time, left for next sweep: ${waits.join(', ')}` : '');
  };

  return { left, outOfTime, skip, stage, summary, stages, skipped };
}

/**
 * Firebase's own trouble, as opposed to ours (Sentry, 2026-10-21: one 500 on
 * the Miracle's seen-state, one 15s timeout on a save, one on the sign-up
 * check - each its own Sentry issue, each gone by the next sweep). A 5xx, a
 * 429, a timeout or a dropped connection is worth one more try; a 4xx is a
 * real problem (rules, a bad path) and is not.
 */
function isTransientFailure (error) {
  if (!error) return false;
  const status = Number(error.status);
  if (Number.isFinite(status)) return status >= 500 || status === 429;
  if (error.name === 'TimeoutError' || error.name === 'AbortError') return true;
  return error.name === 'TypeError' && /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN/i.test(`${error.message} ${error.cause && error.cause.code}`);
}

/**
 * Run `attempt` and, on a transient failure, once more after `waitMs` if
 * `canRetry()` still allows it. A failure that stays transient is thrown
 * marked `transient: true`, which is what lets the caller log it as a
 * warning rather than file it with Sentry.
 */
async function retryTransient (attempt, { canRetry = () => true, waitMs = 500, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
  try {
    return await attempt();
  } catch (error) {
    if (!isTransientFailure(error)) throw error;
    if (!canRetry()) {
      error.transient = true;
      throw error;
    }
  }
  await sleep(waitMs);
  try {
    return await attempt();
  } catch (error) {
    if (isTransientFailure(error)) error.transient = true;
    throw error;
  }
}

module.exports = { mapLimit, rotate, requestDeadline, createSweepClock, isTransientFailure, retryTransient };
