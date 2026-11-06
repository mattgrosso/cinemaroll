// Last-resort stash for a writeDurably change that reached NEITHER the server
// NOR the IndexedDB queue (Sentry, 2026-11-06: an iPhone woke with a dead
// socket and frozen storage, so a tiebreak step timed out on both). The same
// idea as bugReports.js's stash: localStorage is synchronous and answers when
// IndexedDB doesn't. One entry per account + path, newest wins - a later save
// of the same path supersedes it (writeDurably drops the stash once a newer
// value is queued or confirmed). flushPendingWrites sends what's left, AFTER
// the queue, since anything stashed is newer than whatever is queued for the
// same path.
//
// Everything stored is JSON, so reactive state is fine to pass in.

export const WRITE_STASH_KEY = 'cinemaRoll.writeStash';
// A stash isn't a queue: bound it so a wedged device can't fill localStorage.
const MAX_STASHED = 50;

const read = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(WRITE_STASH_KEY) || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const write = (stash) => {
  const keys = Object.keys(stash);
  if (!keys.length) {
    localStorage.removeItem(WRITE_STASH_KEY);
    return;
  }
  localStorage.setItem(WRITE_STASH_KEY, JSON.stringify(stash));
};

const keyFor = (account, path) => `${account}|${path}`;

// Returns true when the change is now on the device, false when even
// localStorage refused it (full, private mode) - the only case left that
// genuinely exists only on screen.
export function stashWrite (account, dbEntry) {
  if (!account || typeof dbEntry?.path !== 'string') return false;
  try {
    const stash = read();
    const key = keyFor(account, dbEntry.path);
    delete stash[key];
    stash[key] = {
      account,
      dbEntry: JSON.parse(JSON.stringify({ path: dbEntry.path, value: dbEntry.value ?? null })),
      stashedAt: Date.now()
    };
    const keys = Object.keys(stash);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_STASHED))) delete stash[old];
    write(stash);
    return true;
  } catch {
    return false;
  }
}

export function listStashedWrites (account) {
  return Object.values(read())
    .filter((entry) => entry?.account === account && entry.dbEntry)
    .sort((a, b) => a.stashedAt - b.stashedAt);
}

// `stashedAt` given: only removes that exact stash, so a newer one stashed
// while the old one was being sent survives.
export function removeStashedWrite (account, path, stashedAt) {
  try {
    const stash = read();
    const key = keyFor(account, path);
    if (!stash[key]) return;
    if (stashedAt !== undefined && stash[key].stashedAt !== stashedAt) return;
    delete stash[key];
    write(stash);
  } catch {
    // Storage blocked: the next flush simply re-sends it, which is harmless.
  }
}
