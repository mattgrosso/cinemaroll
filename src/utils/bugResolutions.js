import { getDatabase, ref, get, update, query, orderByChild, equalTo } from 'firebase/database';

// The other half of the bug-report loop: when a report is resolved,
// `yarn resolve-bug-report` writes a plain-language notice into the
// reporter's own account at `<topKey>/bugReportResolutions/<reportId>`,
// and BugResolutionNotice.vue shows the unseen ones on the next launch.
//
// The notice lives under the reporter's account branch on purpose: the
// per-account rules already let them read it (and nobody else), so closing
// the loop needed no rules change — and `bugReports/` itself stays
// write-only, since reports carry other people's emails and app state.
//
// "Seen" is prompt state, not user-authored content, so marking it uses a
// plain non-durable write (the same category as prompt snoozes in
// data-writes.md). Worst case for a lost write is the notice showing twice.

/** Entries worth showing: not yet seen, oldest resolution first. */
export function unseenResolutions (entries) {
  return Object.entries(entries || {})
    .filter(([, value]) => value && !value.seen)
    .map(([id, value]) => ({ id, ...value }))
    .sort((a, b) => (a.resolvedAt || 0) - (b.resolvedAt || 0));
}

export async function fetchUnseenResolutions (store) {
  const topKey = store.getters.databaseTopKey;
  if (!topKey) return [];

  try {
    // Only the unseen ones come down (2026-11-11): a seen notice has
    // `seen: true` and an unseen one no `seen` at all. The whole list had
    // grown to ~170 KB and was read on every open; database.rules.json
    // indexes `seen` so the database does the filtering.
    const snapshot = await get(query(ref(getDatabase(), `${topKey}/bugReportResolutions`), orderByChild('seen'), equalTo(null)));
    return unseenResolutions(snapshot.val());
  } catch {
    // Offline or refused — the notice simply waits for another launch.
    return [];
  }
}

export async function markResolutionsSeen (store, ids) {
  const topKey = store.getters.databaseTopKey;
  if (!topKey || !ids.length) return;

  // One atomic multi-path update, and only of the `seen` leaves — the notice
  // text stays as the record of what was fixed.
  const updates = {};
  ids.forEach((id) => { updates[`${topKey}/bugReportResolutions/${id}/seen`] = true; });

  try {
    await update(ref(getDatabase()), updates);
  } catch {
    // Same shrug as above: they'll be marked on a later dismissal instead.
  }
}
