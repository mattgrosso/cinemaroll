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

**A shadow divergence explains itself in its own text (Sentry, 2026-10-20).** The
first one on a phase-2 build reached Sentry as "diverged from full download:
[object Object]" — the report rode in the context argument, which Sentry flattens.
`summarizeShadowReport` (`deltaSync.js`) puts counts, `lastSync`, and per stale
entry both stamps, whether the delta returned it and the differing fields into the
message, and into the recorded reading (`summary`). The full download is read
BEFORE the delta query, so a save landing in between makes the delta's copy newer
than the full download's: `isWriteRaceOnly` (only stale entries, every one in the
delta with a strictly newer stamp, list not capped) logs that at info, records
`race: true`, and `yarn delta-shadow-report` counts it apart without breaking the
streak. Same-stamp-different-content (the Dune class) stays an error.

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
A timed-out Firebase write logs `console.warn`, not `console.error`
(captureConsole makes every error a Sentry event, and the write is already
queued); a refusal stays an error, and `flushPendingWrites` errors once when a
queued write reaches `QUEUED_WRITE_REPORT_AFTER` (5) failures (Sentry, 2026-10-09).
The same split applies to any optional lookup with a fallback (the
post-rating Wikidata locations lookup, keywords): `isStallError` → warn,
anything else → error. Third-party lookups get their own `AbortSignal.timeout`
rather than `fetchWithTimeout`, so a slow outside service doesn't flip the app
offline (Wikidata: 20s, `LOOKUP_TIMEOUT_MS`).
Branch on `state.isOnline` for offline behaviour, never on `navigator.onLine`;
never add a network call without a timeout (axios has the default; raw `fetch`
goes through `fetchWithTimeout`). Everything queued through `pendingWriteQueue`
is JSON-round-tripped to plain data - reactive state cannot be structured-cloned.
Reproduce a dead-but-connected network with `scripts/liefi-proxy.mjs`
(`blackhole`), and one bar of signal with its `trickle` mode - the case where
slow requests DO get through, which is what starts an update.

## Every IndexedDB open is bounded and retried once (2026-10-11)

WebKit can leave the first `indexedDB.open()` of a launch unanswered while a
second goes straight through. Both `offlineStore.js` and `pendingWriteQueue.js`
bound each open (4s) and try once more; in the queue, list/get/put/delete are
bounded too, so nothing can wait on storage forever. `enqueueWrite(entry,
{ online })`: when the caller is also sending the write to the server, a
storage STALL is a `console.warn`; offline, or a real failure (blocked,
refused, unclonable), it stays `console.error`. `writeDurably` errors loudly
when a change reached neither the server nor the queue - the only case where
it exists only on screen. A new IndexedDB store must follow the same shape.

## Updates must never cost the offline copy (2026-09-30)

A hard reload (`hardReload` in `appUpdate.js`) deletes the precache and loads
from the network. It only runs once `newAppIsReachable` has downloaded the
new bundle; otherwise the update is `'deferred'` and the running app stays.
Route screens go through `lazyScreen` (8s deadline under a worker, then the
stale-chunk reload), the outgoing version's files survive an update in
`cinema-roll-previous-app` (`public/keep-previous-app-sw.js`), and nothing in
`index.html`'s head may load from another host - fonts are bundled.


**Never ask the worker for an update twice at once (2026-10-01).** Every
`registration.update()` goes through `checkWorkerOnce` (`appUpdate.js`): it
joins a check already in flight and skips one that just finished or a worker
already installing. A second `update()` queues behind the first one's install
on iOS, which is what made every auto-refresh sit out the 5-second cap.
Bug reports carry `update.lastUpdate` (spotted-after, wait time, result, landed-after).

**Quiet when it started is not quiet now (2026-10-09).** The automatic update
passes `stillQuiet` to `reloadForUpdate`, which asks it again right before
reloading (plain or hard). A touch since the attempt began, or a newly unsafe
moment, returns `'interrupted'`: nothing reloads, the reload-attempt record is
put back (so the retry isn't mistaken for a repeat and sent hard), and App.vue
goes back to waiting for an 8-second quiet stretch. Showtimes dismissals and
reminders go through `writeDurably` at `theaters/<dismissed|reminders>/<theater>/<slug>`;
`applyDbPathLocally` knows those paths and `loadTheaterBoard` replays the queue.

**Asking for a reload is not a reload (2026-10-14).** iOS can ignore
`location.reload()` outright; the notice then sat on "Updating…" for 47
minutes. After a `'reloaded'`/`'hard'` outcome, App.vue and the banner both
run `watchForStalledReload` (wall-clock, so time in the background counts):
a page still here after `RELOAD_STALL_MS` drops "Updating", and App.vue
re-arms the automatic update, which is now a repeat and so goes hard.

**A small deploy must stay a small download (2026-10-02).** `vite.config.mjs`'s
`coreChunk` puts everything loaded up front in `js/core.<hash>.js`; only
`main.js` and `router/index.js` (which names every screen file) stay in
`js/app.<hash>.js`. Nothing in core may import the router index (the store
uses `router/appRouter.js`) or read a per-build value like
`VUE_APP_VERSION`/`VUE_APP_BUILD_TIME` (main.js hands those to
`buildStamp.js`) - either one makes every screen's file change on every
deploy, and the new worker then downloads ~50 files before the auto-update
can reload (measured: 51 files / 2.6 MB for a one-screen tweak, 2 after).
`sharedChunks.test.js` guards both. To check by hand: build twice with a
one-screen change and count new file names in `js/`.

## Published feeds follow library writes

Every `movieLog*` write through `writeDurably` or `writeDatabaseEntryNow` schedules
two debounced republishes: the Film Club profile (`scheduleSocialPublish`, 20s) and
the Magic Mirror feed (`scheduleMirrorPublish`, 5s). Both are flushed on
pagehide / hidden in `App.vue`, because a backgrounded PWA doesn't run timers.
Home's six-hourly watchers are only backstops. A new published feed should hook in
the same way, not via a Home watcher (2026-10-05: the mirror kept showing a film as
"Now Showing" for hours after it was rated).

**A publish waits for the personal awards (2026-10-09).** Both the Film Club profile
and the club feed carry my awards, and the awards load on their own after the
library. `publishSocialProfile` / `publishClubFeed` go through
`personalAwardsReadyToPublish`, which awaits `ensurePersonalAwards` (one shared read)
and skips the publish if the awards can't be read and nothing is cached. Before this,
a launch publish could beat the awards and wipe them from every friend's view
("I can't see Seth's or Natalie's" awards). Anything else published from
`settings.personalAwards` must do the same.

## Movie Hat reads are the Film Club / Watchlist "N+1" (2026-10-11)

Sentry's "N+1 API Call" on FilmClubScreen (and earlier WatchlistScreen) was
first seen 2026-10-06 as nine Movie Hat reads: `ensureMovieHatContents` reads
the hat index and then every hat at once, triggered by the first `SendToHat`
button on a screen. The 2026-10-08 fixes (`personIdCache.js`, `deviceCache.js`)
cached the Watchlist's TMDB lookups and never touched it, so the issue came
back. A complete answer now stands for six hours
(`MOVIE_HAT_CONTENTS_MAX_AGE_MS`, kept across launches); a draw forces a read,
an incomplete read retries after a minute, and the send-time check stays the
authority.

**It came back on v1.124.7 the same morning, and that is accepted (2026-10-11).**
The six-hour window works; the first Film Club or Watchlist open of a day is
simply always past it, so the burst (index + one read per hat, in parallel)
still runs about once a day and Sentry still names it. Decided: archive it in
Sentry as expected, change nothing. Rejected: reading hats one at a time (only
hides the burst from the detector, and hat buttons settle ~1s later) and a
single combined read (needs a Movie Hat-side summary node — not worth it). A
recurrence on a build with the six-hour window is not a regression; only treat
it as one if the burst fires more than about once per six hours per device.

**Same call for the WatchlistScreen variant (2026-10-11).** Sentry reopened the
WatchlistScreen issue on v1.124.7 too. Every TMDB lookup on that screen is
already device-cached (`watchlistLookups.js` a week, runtimes 180 days), so the
only burst left there is the same hat read. Archived as expected; no code change.
Raising or disabling N+1 detection in the Sentry project settings is the way to
stop these reopening.

**Reopened again on v1.127.4 (2026-10-14), same call.** Still one user, still
the daily hat read; nothing on the screen changed. If a future event's spans
are TMDB `search/movie` calls instead, that's the Search tab's "ask" box
resolving each AI suggestion separately; cache those per title+year on the
device (`deviceCache.js`), the way the other Watchlist lookups are cached.

**The PersonalAwardsScreen variant was real (2026-10-15), not the hat.** The
Awards screen has no hat buttons. Its acting categories ask TMDB
`/search/person` per cast member for gender, and kept the answers 24 hours
per name per awards year (`person_<name>_<year>` in localStorage), so year
switches and next-day opens re-asked the whole cast at once. The picker now
reads and writes `personIdCache.js` (shared with the Watchlist; entries keep
the photo too, 2000 names, 90 days) and deletes the old `person_` keys on open.
A first open of a category can still burst once per new name — that's expected.
`AwardsPersonLookups.test.js` guards it. Before calling any N+1 "the hat read",
check the screen actually has a `SendToHat` on it.

**The Home variant (reopened 2026-10-17 on v1.127.9), same call.** Two users,
32 events since 2026-10-06. Home has both known bursts and nothing new: the
"More from" row's `SendToHat` buttons trigger the six-hour hat read, and
`PersonalAwardsModal` (opened from Home) asks `/search/person` once per name it
has never seen, via `personIdCache.js`. Archived as expected; no code change.
Everything else Home fetches is sequential (`discoverMovies` pages, the keyword
path) or memoized (`resolveTmdbId`, `moreFromCache`). If an event's spans are a
parallel run of `/search/person`, `/search/company` or `/search/keyword` from
the More from row's `Promise.all` over chips, that's `tmdbIdCache` being
in-memory only — keep those ids in `deviceCache.js`.

**Every N+1 now names its cause (2026-10-19).** Reopened again on v1.127.10
(Home, 33 events, two users). Rather than guess each time, `beforeSendTransaction`
(`utils/sentryBeforeSend.js`) runs `labelBurst` (`utils/burstLabel.js`) after the
scrubber: the largest group of five or more same-shaped requests in a transaction
tags it `burst_cause`, `burst_count` and `burst_pattern` (host + path, query
dropped, ids starred). Expected causes: `movie-hat-read` (about once per six hours
per device on any screen with a `SendToHat`) and `tmdb-person-lookups` (Awards /
`PersonalAwardsModal`, first sight of a name). `tmdb-company-lookups`,
`tmdb-keyword-lookups` (Home's More from chips) and `tmdb-movie-search` (the
Search "ask" box) are named because they have known fixes (above) — seeing them
means do the fix. `unknown` means a new burst: read its pattern and find the
caller. Open an N+1 issue's tags before anything else; archive expected ones
Forever, never Resolve (resolving is what makes Sentry reopen them).
`burstLabel.test.js` guards it. A new known burst gets a `KNOWN_BURSTS` entry.

## A one-off read nobody catches must classify its refusal (2026-10-15)

Sentry: on an expired sign-in every listener and the newsletter read were
quiet warnings, but the launch push-settings read (`loadPushState`, from
App.vue's `initializePush`) had no catch and escaped as an unhandled
rejection. It and `fetchSocialDirectory` now go through `reportRefusedRead`:
warn with nobody signed in, error while signed in. Any new `get()` whose
caller doesn't catch should do the same.

**The global handler is the backstop, not the fix.** `ErrorLogService`'s
`unhandledrejection` handler logs a "permission denied" rejection as a warning
when nobody is signed in (`isRefusedWithNoSignIn`; the store registers the
sign-in check via `setSignedInCheck`, since that file can't import Firebase).
Signed in, or any other rejection, stays an error. A test that mocks
`ErrorLogService` and loads the store needs `setSignedInCheck` in the mock.

**An opaque "Script error." is a warning (Sentry, 2026-10-20).** It's all the
browser reports for an error in code from another origin (on iOS, usually
something Safari added to the page): no file, no line, nothing to trace. Sentry
drops that message on its own, but `ErrorLogService`'s `error` handler re-said
it through `console.error`, which CaptureConsole sends. `isOpaqueScriptError`
(exactly "Script error." with no filename or line) logs it as a warning: it
stays in the in-app log and never reaches Sentry. Anything with a file or line
stays an error. `opaqueScriptError.test.js` guards it.
