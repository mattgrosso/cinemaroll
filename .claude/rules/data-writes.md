---
paths:
  - "src/store/**"
  - "src/utils/**"
  - "src/assets/javascript/AddRating.js"
  - "src/assets/javascript/syncStamp.js"
  - "src/assets/javascript/storedEntry.js"
  - "src/assets/javascript/tmdbBackfill.js"
  - "src/assets/javascript/backfill*.js"
---

# Data, writes & offline rules

This app lost real user data once. The write path is the way it is because of that.
Full narrative: `docs/history/data-and-offline.md`.

## The write path

**Offline audit 2026-08-15 (v1.47.0): every user-authored write in the app is
durable.** `setDBValue` remains ONLY for derived/re-derivable values (error-log
toggle, group-order daily override, prompt snooze states) and the deliberately
non-durable maintenance batches via `updateDatabaseEntriesNow`. Any NEW write of
something a user typed, chose, or decided must use `writeDurably` with a LEAF
path — never whole-entry, never whole-map, never fire-and-forget. Bug reports
are the one exception shape (global `bugReports/` path, outside the account
root): they use their own localStorage stash + `flushStashedBugReports` drain.


Use **`writeDurably`** (store action) for anything user-authored. It does, in order:

1. **Commit locally** via `applyDbPathLocally` (or `setMovieLogEntry` for a whole entry).
2. **Durably `enqueueWrite`** to IndexedDB — *before* any network attempt, so an app kill
   mid-write can't lose it.
3. **Attempt `writeDatabaseEntryNow`** if online, removing the redundant queue entry on
   confirmed success.

Do **not** reorder these. The durable queue entry sits *underneath* the network attempt,
not as an after-the-fact fallback. Do not `await enqueueWrite` before issuing the network
write — serializing them behind IndexedDB latency caused the tiebreak-flash regression.

`AddRating.js`'s non-placeholder path **re-throws** on a failed online write, so the user
sees an error rather than trusting an unconfirmed save. `writeDurably` deliberately does
**not** re-throw — its callers have no error UI, and the queue retries.

## Local commit is not optional

Online, Firebase's client cache reflects a `set()` back through `onValue` before the
round trip completes. **Offline it does not**, so without an explicit local commit the
change is invisible until reconnect. Every write path commits locally first.

## Batch. Never write per-item in a loop.

A per-movie design (one `setMovieLogEntry` + one `set()` each, across hundreds of movies)
sustained enough allocation and reactivity churn to make mobile browsers **kill and
reload the tab** mid-run. It reads as a crash, not as slowness.

Use `setMovieLogEntries` (one spread, one freeze, one reactivity trigger) and
`updateDatabaseEntriesNow` (one atomic multi-path `update()`). `tmdbBackfill.js`'s
`runTmdbBackfill` already implements the worker-pool + batched-flush shape — reuse it
rather than copying it.

## Write leaf paths, not whole objects

`set()` at `movieLog/<key>/movie` replaces it wholesale and can clobber
cast/crew/genres with a stale local snapshot. Write
`movieLog/<key>/movie/<field>` instead. Multi-path `update()` with `null` values is the
only way to *delete* a field without rewriting the entry.

## `{ ...someArray }` silently produces an object

Spreading an array into an object literal gives `{0: …, 1: …}` with **no `length`**.
`GetRating.js` opens with `if (!media?.ratings?.length) return null`, so the entry's score
collapses to 0 and its date vanishes. This survived a long time because Firebase
normalises sequential numeric keys back into an array on the round trip — it only became
visible once writes committed locally first. Use `.map()`.

## In-flight write protection

`state.inFlightWrites` holds `{path: value}` from local commit until the server settles.
Both `onValue` listeners re-top incoming snapshots with anything still in flight, because
a snapshot that predates a just-made change would otherwise briefly revert it. Raw server
data still goes to the IndexedDB snapshot; only in-memory state is re-topped.

## Change tracking (delta sync phase 0)

`syncStamp.js` decides how each write is performed. Every `movieLog` write carries an
`updatedAt` — **`serverTimestamp()`, never `Date.now()`**, so a wrong device clock can't
hide a movie from itself. A field write becomes one atomic `update()` carrying the field
*and* the stamp (stamping separately would leave a changed-but-unstamped entry on
failure). A deletion becomes an atomic `update()` writing a tombstone at
`movieLogDeletions/<key>`. **Never stamp a deletion** — overlapping paths are rejected
outright by Firebase.

**Phases 2/3 are LIVE for everyone (2026-08-17).** `launchPlan` (`deltaSync.js`)
decides per launch: a `startAt(lastSync)` query listener normally, a full download on
first run / lost snapshot / every 3 days / forced refresh — and the full launches still
run the shadow comparison and record readings (`yarn delta-shadow-report`). Consequences
for write code: **an unstamped `movieLog` write will not propagate to other devices
until their next full resync** — `syncStamp.js` must keep covering every write path.
The "Refresh library from server" button (Settings → Maintenance) and
`forceFullLibraryRefresh` are the escape hatch. Design notes in
`docs/history/data-and-offline.md` (tombstones compared by time, `lastSync` as max
received stamp, snapshot + lastSync persisted together).

## Stored-entry shape

`storedEntry.js` is the single definition of "trimmed". `KEPT_CREW_JOBS` uses substring
matching; **Screenplay/Story/Novel are load-bearing** (754 of 1,368 movies have no plain
"Writer" credit). `RUNTIME_ENTRY_FIELDS` (`dbKey`, `_search`) are injected on read and
must never be written back. Cast is deliberately untrimmed — Six Degrees walks the full
billing list on purpose.

## Re-rating must preserve locally-owned data

`shapeTmdbDataIntoMovie` builds a **brand new** movie object, so anything not explicitly
rebuilt is wiped. Entry level: copy everything except `movie`/`ratings`/`dbKey`. Movie
level: an explicit allowlist (`CARRIED_OVER_MOVIE_FIELDS`), applied only where the fresh
TMDB object doesn't define the field — a blanket merge would resurrect stale values and
keep `isPendingReconciliation` set on a placeholder being finalised.

## Placeholder ratings (offline, new movie)

`placeholderId.js` — a non-numeric `offline-<uuid>` id is the discriminator, since TMDB
ids are always numeric. Placeholder movies get **non-null defaults**: `release_date`
always a real `YYYY-01-01` (null breaks date parsing everywhere), `runtime` 90 (not null
— `null <= 40` is `true`, so the shorts filter would silently exclude it).

## Network: "online" means answering, not connected (2026-09-23)

`store.state.isOnline` is no longer `navigator.onLine`. `src/utils/networkHealth.js`
flips it false when a request times out (every axios call has an 8s timeout,
Firebase writes 8s) and back when anything answers or the probe gets through.
Branch on `state.isOnline` for offline behaviour, never on `navigator.onLine`;
never add a network call without a timeout (axios has the default; raw `fetch`
goes through `fetchWithTimeout`). Everything queued through `pendingWriteQueue`
is JSON-round-tripped to plain data - reactive state cannot be structured-cloned.
Reproduce a dead-but-connected network with `scripts/liefi-proxy.mjs`.

