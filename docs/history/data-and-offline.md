# Data, Offline & Sync — development history

> Archived from CLAUDE.md. Verbatim post-mortem narrative, kept for the hard-won
> detail. Durable rules extracted from this live in `.claude/rules/`.

## Offline / PWA Support (Jul 2026)

A full audit + pass at real offline support, prompted by wanting posters/images/data usable with no connection. Previously the PWA plugin only precached build assets (JS/CSS/fonts/`index.html`) — zero image caching, zero Firebase offline persistence, so a cold start with no connection would hang forever on the loading screen.

- **TMDB image + Google Fonts runtime caching** (`vue.config.js`'s `workboxOptions.runtimeCaching`, GenerateSW mode — no `workbox-*` npm packages needed, the webpack plugin bundles the strategies from plain config objects): `image.tmdb.org` → CacheFirst, cache name `tmdb-images`, 3000-entry cap, 90-day expiry, `cacheableResponse: { statuses: [0, 200] }` (the `0` matters — cross-origin image fetches are opaque responses). `fonts.googleapis.com` → StaleWhileRevalidate. `fonts.gstatic.com` → CacheFirst, 1-year expiry. This only caches an image the first time it's actually requested (viewed) — it does not proactively warm anything by itself.
- **"Download all posters for offline" (Settings panel, `Home.vue`)** is what actually satisfies "I want ALL my posters available offline" — `src/assets/javascript/offlinePosterCache.js`'s `collectImageUrls(movieLog)` (dedup'd poster w342 + backdrop w500 URLs, matching the sizes actually used elsewhere per the asset-perf section above) and `warmImageCache(urls, { concurrency, onProgress, signal })` (a small worker-pool fetcher, `mode: 'no-cors'` since TMDB doesn't send CORS headers and a same-origin-mode `fetch()` — unlike an `<img>` tag — would reject outright). The `fetch()` calls exist purely to give the already-registered CacheFirst route something to intercept and store; the responses themselves are never read. Both are pure/store-free and unit-tested without mounting anything (`src/test/offlinePosterCache.test.js`). Deliberately a manual, opt-in button rather than automatic — eagerly pulling ~60-100MB isn't something to do silently on someone's cellular connection.
- **New/changed images are cached automatically after the initial bulk download** (Jul 2026, follow-up — "I don't wanna have to run it again manually except for this one time at the beginning"). `offlinePosterCache.js` exports `posterUrl`/`backdropUrl` (the same w342/w500 URL builders `collectImageUrls` uses internally) so individual call sites can warm exactly one new image without re-scanning the whole library. Two hook points, both fire-and-forget (never awaited, never block or fail the real save): **`AddRating.js`**'s `addRating()` warms the new movie's poster+backdrop right after a rating is saved; **`MovieDetail.vue`**'s `selectPoster`/`selectBackdrop` each warm the newly-chosen image right after the custom-path save succeeds. Together with the passive CacheFirst route (which already covers anything you view), this means the manual button is genuinely a one-time backfill — everything added or changed afterward keeps itself cached without another manual run. Tests: `TMDbDataProcessing.test.js` (warms poster+backdrop on a successful add, does NOT warm when TMDb data/poster is missing or `addMovieRating` returns early), `MovieDetail.test.js` (`selectPoster`/`selectBackdrop` each warm their specific new URL).
- **Offline data fallback for `movieLog`/`settings`** (`src/utils/offlineStore.js` + `initializeDB` in `store/index.js`): Firebase RTDB's web SDK has no built-in disk persistence (unlike Firestore's `enableIndexedDbPersistence`), and `initializeDB` was purely a live `onValue()` WebSocket listener with no timeout — offline, it just never fires. `offlineStore.js` is a small dependency-free IndexedDB wrapper (`saveSnapshot`/`loadSnapshot`, keyed by `${databaseTopKey}:${movieLog|settings}`) that never throws (best-effort; resolves `null`/no-ops on any failure, e.g. private browsing). `initializeDB` now races `loadSnapshot(...)` against the live `onValue` listener rather than sequencing them: whichever settles the UI first wins, and the live callback (which always eventually fires once connected, cache hit or miss) is the source of truth — it unconditionally overwrites/re-persists on arrival. A `context.state.dbLoaded` guard on the cache-read side just stops a slower cache resolution from clobbering already-arrived live data; there's no artificial timer/delay, the two async paths just race naturally. **Inherent limitation, not a bug to fix further**: a user's very first-ever session with no prior successful sync has no snapshot to fall back to, so a true first-time offline cold start still can't show data that was never cached — there's nothing to persist yet. Tests: `src/test/offlineStore.test.js` (real IndexedDB behavior via `fake-indexeddb`, a new devDependency — jsdom itself has no IndexedDB implementation), `src/test/OfflineDataFallback.test.js` (imports the REAL `store/index.js`, not a hand-rolled mock store like `VuexStore.test.js` — Firebase/axios/router/Sentry mocked so module-load has no real side effects; exercises the actual race/guard logic end-to-end).
- **Cleanup**: `public/offline.html` (a bare static fallback page) was precached but never actually wired to a `navigateFallback`, and turned out to be unnecessary anyway — hash-based routing means every in-app "page" is really the same `index.html` (the `#fragment` never reaches the server/service-worker), which is already precached and correctly served offline by Workbox's default exact-match precache route. Deleted as dead code rather than wired up. The redundant Bootstrap CDN `<link>` in `index.html` was also removed (Bootstrap is already bundled via `main.js`'s `import "bootstrap/dist/css/bootstrap.min.css"` — the CDN link was doing nothing but adding an uncached external request). `vue.config.js`'s manifest `icons` now also includes the maskable variants (`android-chrome-maskable-{192,512}.png`) — the files already existed in `public/img/icons/` but were never referenced, so Android home-screen icons weren't using them.
- **Scope note**: this covers the app shell (already fine pre-existing), images (new), and the user's own rated-movie data (new). It does NOT cover the `academyAwardWinners` external-API fetch in `initializeDB` (Railway + TMDB calls) or other network-dependent features (Letterboxd scraping, TMDB search for new ratings) — those inherently require a connection and weren't in scope for "view what I've already rated, offline."

### Foreground update-check reliability on iOS (Jul 2026)
Bug report: the "check for a new version when the app comes back to the foreground" behavior (`App.vue`) worked reliably on one household member's iPhone but never on another's, despite both being recent iPhones with the app added to the home screen the same way. Root cause is environmental, not a code bug: the original implementation relied solely on `visibilitychange`, and iOS Safari/WebKit has a long-standing, version-dependent quirk where `visibilitychange` doesn't reliably fire when a home-screen-installed (standalone) PWA is brought back to the foreground — which iOS release a phone is on materially affects this. (iOS also evicts a site's service worker registration after ~7 days of no visits, as part of Safari's storage eviction policy — a second, independent reason a specific device might silently never see the check run.)
- **Fix: don't depend on a single trigger.** `App.vue`'s `checkForServiceWorkerUpdate()` method (`registration.update()`, wrapped in try/catch so a failed check never throws) is now called from FOUR independent triggers instead of one: `visibilitychange` (existing, kept), `window` `pageshow`, `window` `focus`, and a `setInterval` re-check every 30 minutes while the app is open. The interval is a genuine backstop — it doesn't depend on any lifecycle event firing at all, so even a device where every event-based trigger is flaky still gets checked periodically.
- **Not fixed by this change**: the ~7-day service-worker eviction on rarely-opened installs — there's no code workaround for that (nothing can run before the app is opened). If someone reports updates never arriving despite this fix, ask how often they actually open the app before assuming it's another visibility-event issue.
- Tests: `src/test/App.test.js` — spies on `document`/`window` `addEventListener` and invokes the captured handler directly (real `dispatchEvent` calls would leak listeners across tests in the same file, since `App.vue`, being the root component, never unregisters them in `beforeUnmount` — correct for production, where it's mounted exactly once for the app's lifetime, but requires this workaround in tests). Covers each of the four triggers firing an update check, hidden-state suppression, the interval firing repeatedly, missing-`serviceWorker`-API safety, and a rejected `getRegistration()` not throwing.

## Offline Movie Rating (Jul 2026)

Cinema Roll already supported offline *viewing* (cached images, an IndexedDB snapshot fallback for `movieLog`/`settings` reads — see "Offline / PWA Support" above). This closes the remaining gap: rating movies while offline, for two cases the user asked to be built together — (1) re-rating/updating a movie already in the library, and (2) rating a brand-new movie with no TMDB lookup possible.

**A real, pre-existing bug fixed along the way**: `AddRating.js`'s `getTMDBData()` silently swallowed any TMDB fetch failure and returned `undefined`; `addMovieRating` then proceeded anyway, writing a `movie` object with `id: null, poster_path: null, genres: [], cast: [], crew: [], title: ""` — wiping a previously-good entry's metadata on any transient network blip. Fixed at the failure path only (online, successful-fetch behavior is unchanged — still always live-refetches on re-rate, since that's the only path that ever picks up TMDB metadata corrections): a failure with an existing local entry now reuses that entry's `movie` data instead of nulling it; a failure with NO existing entry (a genuinely new movie) now **throws** instead of silently writing a broken entry.

- **Offline detection**: new store state `isOnline` (init from `navigator.onLine`), flipped by `App.vue`'s `window` `'online'`/`'offline'` listeners. `App.vue` already had a 4-trigger pattern for its service-worker update check (`visibilitychange`/`pageshow`/`focus`/a 30-min interval) with an in-code rationale about no single browser event being reliable enough (esp. iOS) — the same four triggers now also call `attemptPendingWritesFlush()` (dispatches `flushPendingWrites`, itself a no-op if actually offline), so a queue flush isn't solely dependent on the `online` event firing.
- **Durable write queue — `src/utils/pendingWriteQueue.js` (new)**: a clean IndexedDB sibling to `offlineStore.js` (own DB, not a second object store bolted onto it — different lifecycle: individually added/updated/removed entries vs. `offlineStore.js`'s whole-blob snapshot overwrite, so no shared-migration risk). `enqueueWrite`/`listPendingWrites`/`removePendingWrite`/`updatePendingWrite`, same try/catch/never-throws shape as `offlineStore.js`. **One queue, discriminated by `type`** (`'write'` | `'placeholder'`) rather than two separate stores — both need identical flush mechanics for their `dbEntry: {path, value}`, and a single list drives both "silently retry" and "prompt to reconcile." `enqueueWrite` for `type: 'write'` dedupes by `dbEntry.path` (overwrites in place), so repeated offline edits to the same movie before the next flush collapse to one write. `listPendingWrites` sorts oldest-first by `createdAt` — IndexedDB's `getAll()` returns key order, and the key is a random UUID, not insertion-ordered, so this is what actually guarantees FIFO flush order.
- **`src/utils/placeholderId.js` (new)**: `makePlaceholderId()` → `offline-${crypto.randomUUID()}`; `isPlaceholderId(id)` → starts-with check. TMDB ids are always numeric, so a non-numeric-prefixed string id is a clean, collision-free discriminator for "this is an offline placeholder rating" — no separate boolean flag needed anywhere `previousEntry`/`findKeyForMovieInDatabase`-style `===` id matching already happens (all of which continue to work unmodified against a string id).
- **Optimistic local commit — the piece that makes offline actually feel like it worked.** If a write only went to the IndexedDB queue while offline, `store.state.movieLog` would never update until the queue flushes — the just-rated movie wouldn't show up anywhere (grid, previous-viewings, a same-session re-edit) until connectivity returned. Online, this happens "for free" via Firebase's own client-side optimistic cache (the `onValue` listener reflects a local `set()` back before the server round-trip completes) — but the offline path never calls `set()` until flush, so that mechanism doesn't fire. Fix: a new mutation, `setMovieLogEntry(state, {key, value})` (rebuilds+refreezes `state.movieLog` — `setMovieLog` freezes it wholesale, so this can't mutate the existing frozen object in place), called synchronously and **unconditionally** (online or offline) from `AddRating.js`'s `addRating()` right after building `dbEntry`. This is also what makes a SECOND offline edit to the same still-unsynced placeholder correctly reuse the same movieLog key (`findKeyForMovieInDatabase` reads `store.state.movieLog`, which the optimistic commit already populated).
- **Flush/retry action, `store/index.js`**: `setDBValue`'s core (`removeNaNAndUndefined` + `set(ref(...))` + try/catch) was extracted into a shared `performDatabaseWrite(context, dbEntry)` helper, used by both `setDBValue` (keeps its existing 1-second same-path debounce in front of it) and the new `flushPendingWrites` action (deliberately bypasses that debounce — a queued entry is already a single, deliberately-deduped write; routing it back through the debounce risks a legitimate flush being silently dropped). `flushPendingWrites`: no-ops if offline or already mid-flush (`isFlushingPendingWrites` guard, since it's called from several overlapping triggers), processes the queue in order, removes `type: 'write'` entries on success, marks `type: 'placeholder'` entries `{written: true}` (kept queued for reconciliation), records `{attempts, lastError}` on a per-entry failure without aborting the rest of the pass. A separate `refreshPendingReconciliations` action (list + filter unreconciled placeholders + commit `pendingReconciliations`) is purely local/IndexedDB, safe to call regardless of connectivity — called from `flushPendingWrites`'s tail AND unconditionally from `initializeDB`, so the "needs a match" banner reflects reality even before the next successful flush.
- **`AddRating.js`**: `addMovieRating` now resolves `existingKey`/`existingEntry` up front. If offline and `existingEntry` exists, skips `getTMDBData()` entirely (no network call at all) and reuses `existingEntry.movie` (`buildMovieFromLocalData`, merging in the new rating's `ownership`/`chatGPTKeywords`). A new placeholder path (`buildPlaceholderMovie`, only reached for `isPlaceholderId` ids, never touches TMDB) builds a movie object with **deliberately non-null, sensible-default fields** rather than an all-null shape: `release_date` always resolves to a real (if approximate) `YYYY-01-01` — a typed year if given, else the current year — never `null`, since a null date would break date-parsing call sites throughout the app (MovieDetail, Insights, sort-by-date); `runtime` defaults to `90`, not `null` — the "include shorts" filter is `runtime <= 40`, and `null <= 40` is `true` in JS (null coerces to 0), so a null-runtime placeholder would be silently excluded whenever that setting is off. `genres`/`cast`/`crew`/`keywords`/`production_companies` stay empty arrays (the already-safe "no data yet" shape). Carries `isPendingReconciliation: true` — the durable marker components check for, independent of the id (which changes to the real TMDB id once reconciled). `addRating(ratings)` builds `dbEntry` → commits it via `setMovieLogEntry` (optimistic, immediate) → then, per the write-path design finalized in the "Real data-loss bug" section below (read that section for the full history — went through three rounds before landing here), **always durably `enqueueWrite`s first**, then (online only) directly `await`s `writeDatabaseEntryNow`, cleaning up the now-redundant queue entry on confirmed success → warms the image cache (already null-safe, no-ops for a placeholder). A new export, `shapeTmdbMovie(tmdbId, ratings)`, is the `getTMDBData`+shaping logic reused by the reconciliation flow — takes an explicit id rather than reading `ratings[0].id` (which still carries the OLD placeholder id at reconciliation time).
- **`RateMovie.vue`**: two pre-existing null-unsafe spots fixed for a placeholder's null `release_date`/`poster_path`/`backdrop_path` — `mounted()`'s year derivation (`new Date(null).getFullYear()` was `NaN`) and `rateBannerUrl` (rendered `.../w500null`); `posterUrl()` (the neighbor-strip thumbnail) now falls back to the existing `Image_not_available.png`. `addRating()`'s submit call is now wrapped in try/catch — needed since `AddRating.js` can genuinely throw now (the new-movie-online-TMDB-failure case) — resets `loading` and shows a new inline `submitError` message on failure instead of hanging on "Submitting..." forever.
- **Reaching `RateMovie.vue` for a brand-new movie while offline** (no TMDB search possible, so `PickMedia.vue` can't be used): two entry points, both building a synthetic `movieToRate` (`{id: makePlaceholderId(), title, release_date: null, poster_path: null, backdrop_path: null}`) and routing straight to `/rate-movie`, bypassing TMDB search entirely — (1) `NewRatingSearch.vue` (the zero-local-results auto-search flow, the PRIMARY new-movie path): a new `offlineFallback` state gates on `!$store.state.isOnline` (checked in `mounted()`/the `value` watcher, before ever firing a doomed request) and ALSO on the TMDB search itself throwing (now wrapped in try/catch — previously unhandled, would have left the UI stuck on the spinner forever on any network failure, not just genuine offline); shows "Rate '{title}' from memory" instead of the "doesn't exist" message. (2) `Home.vue`'s "Search TMDB for X" manual button (shown when some local results already exist alongside wanting to add a new one) — gated `v-else-if="$store.state.isOnline"`, with a `v-else` "Rate from memory" sibling button (`rateOffline()`).
- **Placeholder entries are written to Firebase immediately** when possible (see the write-path design below), not held device-local until manually reconciled — holding them back would stack a second data-loss risk on top of the exact problem this feature exists to solve. They also always get a durable `type: 'placeholder'` queue entry regardless of connectivity, since that's how the reconciliation banner/screen find "things still needing a match," independent of write-retry.
- **Library display**: `DBGridLayoutSearchResult.vue` — new `posterImageUrl(result)` falls back to `Image_not_available.png` when the poster path is falsy (this file had no existing "missing poster" fallback, only a lazy-load *loading* placeholder); a small `.pending-match-badge` ("Pending match", amber/black for contrast) renders `v-if` on `topStructure(result).isPendingReconciliation`; `showDetails()` routes a pending-reconciliation result straight to `/reconcile/:dbKey` instead of `MovieDetail`. `rateMedia()` (re-rate from modal) needed no change — `previousEntry.movie` flows back through `AddRating.js`'s `isPlaceholderId` check correctly. `MovieDetail.vue` gets the same badge (as a dismissive-free `.pending-reconciliation-notice` banner linking to `/reconcile/:dbKey`) — its existing local-lookup-by-id already tolerated a placeholder without crashing, every optional section already `v-if`-guarded.
- **Reconciliation flow**: `PickMedia.vue`'s card-grid markup/CSS was extracted into `src/components/MediaResultGrid.vue` (`props: {mediaList, isTVShow}`, `emits: ['select']`) — small (~15-line template), low-risk extraction so the new reconciliation screen doesn't duplicate-and-drift from the existing "pick a TMDB result" rendering; `PickMedia.vue` now just wires its own `@select` handler (the same `setMovieToRate`+push it always did) onto the shared grid. New route `/reconcile/:dbKey` → `src/components/ReconcilePlaceholder.vue` (same `requiresLogin`/`loggedIn()` guard shape as every other authenticated route): on mount, finds the matching queue entry by `dbEntry.path === movieLog/${dbKey}`, pre-fills a search box with the placeholder's typed title(+year) and auto-searches if online; picking a result calls `shapeTmdbMovie(tmdbResult.id, queueEntry.ratings)` and **replaces the existing movieLog entry in place** (same `dbKey`/path — a single atomic write, not a new key + delete), commits it locally, writes it directly via `writeDatabaseEntryNow` (see the write-path design below — NOT enqueue-then-flush), then removes the now-done placeholder queue entry and navigates home. "Skip for now" just navigates home, leaving the queue entry untouched so it resurfaces later. `Home.vue` shows a small dismissible-free banner ("N movies rated offline need a match — Review") near the top of the template, driven by `$store.state.pendingReconciliations`, gated on `isOnline` (reconciliation needs a connection).

Tests: `src/test/pendingWriteQueue.test.js` (pure module — round-trip, FIFO ordering, path-based dedupe for `type: 'write'` but not `'placeholder'`, graceful `[]`/`null` on IndexedDB failure), `src/test/flushPendingWrites.test.js` (imports the REAL store, same "mock firebase/axios/router, exercise real action logic" pattern as `OfflineDataFallback.test.js` — offline no-op, per-entry success/failure handling, debounce bypass, no-overlapping-passes guard, `setMovieLogEntry`'s refreeze, `refreshPendingReconciliations`, `initializeDB` wiring), `src/test/TMDbDataProcessing.test.js` (this is `AddRating.js`'s existing, pre-existing-but-comprehensive test file — several tests asserting the OLD buggy null-fallback behavior were rewritten to assert the throw/local-fallback fix instead; new describe block for the offline-skip-TMDB and placeholder-building paths), `src/test/App.test.js` (new describe block for the online/offline listeners + flush-trigger wiring), `src/test/NewRatingSearch.test.js` (new describe block for the offline fallback UI + `rateOffline`), `src/test/RateMovie.test.js` (new describe blocks for the placeholder-shaped `movieToRate` null-safety fixes and the submit-failure error handling), `src/test/ReconcilePlaceholder.test.js` + `src/test/MediaResultGrid.test.js` (new), `src/test/DBGridLayoutSearchResult.test.js` (new describe block for the badge/fallback-poster/reconcile-routing).

**Scope boundary**: only `AddRating.js`'s write path routes through the durable queue — the ~10 other `setDBValue` call sites (tag CRUD, custom poster/backdrop picks, rating deletes, etc.) are untouched, a much larger blast-radius change than what was asked for. Not built: a shared `InjectManifest`-mode service worker / Workbox Background Sync (would've meant a bigger PWA-config architecture change; the in-app IndexedDB-queue-plus-multi-trigger-flush approach follows the exact pattern `offlineStore.js`/`App.vue`'s update-check already established elsewhere in this codebase).

### Real data-loss bug found on first real-world use (fixed same day, three rounds)
User report, immediately after the above shipped: rated a movie **while online** (not the offline case at all), saw it appear, "returned to the app" (navigated away and back), and the rating was gone — not searchable, not in "most recent," and did not come back even after fully closing/reopening the app. Root cause was the "fire and forget" design of the immediate flush: `AddRating.js`'s `addRating()` called `store.dispatch('flushPendingWrites')` **without awaiting it**, and `flushPendingWrites` early-returns immediately (no-op) whenever another pass is already mid-flight (`isFlushingPendingWrites` guard) — which is very likely right after rating, since navigating home itself triggers `initializeDB` → another `flushPendingWrites` dispatch on the very next route change. If that OTHER pass's `listPendingWrites()` snapshot was taken before the new rating's queue entry existed, neither pass ever wrote it, and nothing was scheduled to retry until some unrelated later trigger (an app relaunch in the meantime loses it, since the only copy was the local optimistic commit). A second, compounding risk: Firebase RTDB's `set()` has no built-in timeout and can hang indefinitely on a degraded connection (`navigator.onLine` still `true`, but the socket can't actually reach the server) — if that happened during a flush pass, `isFlushingPendingWrites` would get stuck `true` for the rest of the session, silently disabling **every subsequent** flush attempt.

**Round 1** (kept, still true, but turned out insufficient on its own):
- **`performDatabaseWrite` (store/index.js) races every write against a 15s timeout** (`withTimeout`, implemented via `Promise.race` + `.finally()` — an earlier `.then(resolve, reject)` version tripped `eslint-plugin-promise`'s `catch-or-return`/`always-return` rules) — a hung `set()` becomes a recorded failure instead of a permanent stall. Shared by `setDBValue` too, so it incidentally hardens every save in the app, not just ratings.
- An interim `flushSingleEntry` action (attempt one queue entry directly, bypassing `isFlushingPendingWrites`) closed the specific race above, but — per the user's explicit follow-up ask, "we need to be totally certain this never happens again" — still left every online save fundamentally dependent on an IndexedDB write succeeding and a follow-up dispatch running correctly. Given the user had *just* lost real data to exactly that class of dependency, a narrower race-fix wasn't a strong enough guarantee; this action no longer exists (superseded by round 2).

**Round 2, the actual fix — decouple the common (online) case from the offline queue entirely:**
- **New action, `writeDatabaseEntryNow(context, dbEntry)`** — a raw, direct `performDatabaseWrite` call with **zero** queue/IndexedDB/shared-state involvement of any kind. `AddRating.js`'s `addRating()` now checks `store.state.isOnline` itself: when online (the common case), it `await`s this action **directly** and lets a failure **throw** — restoring the exact guarantee the app had before the offline-rating feature existed at all: if the save resolves, it is CONFIRMED on the server before `RateMovie.vue` is told it succeeded and navigates home; if it throws, the existing `submitError` UI fires and the user is NOT navigated away, so nothing is silently trusted. The durable IndexedDB queue (`enqueueWrite`) is now used ONLY as the fallback: when genuinely offline (no point attempting a write that can't reach the server), or as a last-resort durability net if the direct online attempt itself throws (still queued for background retry via the existing App.vue triggers, but the error is *also* re-thrown so the user sees it rather than silently trusting an unconfirmed save).
- **Placeholder ratings (brand-new movie, offline) are the one deliberate exception**: they always get a `type: 'placeholder'` queue entry regardless of connectivity (needed for the reconciliation banner to find them, not for write-retry), and a failed *direct* write attempt for a placeholder is swallowed rather than re-thrown — the queue entry is already durably there as the safety net, and "sync eventually" is the feature's whole point for this specific path, so hard-erroring here would contradict the UX the feature is supposed to have.
- **`ReconcilePlaceholder.vue`'s `selectMatch()` got the same treatment** — `await`s `writeDatabaseEntryNow` directly (reconciliation always requires connectivity anyway, the TMDB search above already needed it) instead of enqueue-then-flush; a failure shows the existing `searchError` UI and leaves the placeholder queue entry untouched so the user can retry, rather than silently believing the match was saved.
- **Net effect**: for a normal online rating, the write path became a single direct, awaited, timeout-bounded Firebase call with no shared guard flag and no dependency on anything else running concurrently — no longer a mechanism by which the write ATTEMPT could be silently skipped. Round 2's remaining gap (closed in round 3 below): the durable queue entry was only created as a fallback *after* a failed attempt, not before — so a tab/app killed in the split second *while the write was actually in flight* (after the optimistic commit had already made it look saved) still had no durable copy anywhere yet.

**Round 3, following the user's explicit follow-up ("we have to be 100% certain... do whatever you need to do to make this bulletproof"): durably enqueue BEFORE attempting the write, always, not only on failure.**
- `AddRating.js`'s `addRating()` now: optimistic commit → **unconditionally `enqueueWrite`s first** (`type: 'write'` or `'placeholder'`) → *then* attempts `writeDatabaseEntryNow` (online) or leaves it queued (offline). The queue entry is the durability net sitting *underneath* the direct-write attempt, not an alternative to it or an after-the-fact fallback — from the instant `enqueueWrite` resolves, the rating is durable on this device (IndexedDB) regardless of what happens to the network attempt next, including the app being killed mid-attempt. On confirmed success, the now-redundant entry is cleaned up: `type: 'write'` is `removePendingWrite`d; `type: 'placeholder'` is marked `{ written: true }` instead (still needed for reconciliation tracking, a separate concern from write-durability) — `flushPendingWrites`' general sweep now also skips re-attempting a `written` placeholder entry (a correctness/efficiency fix that fell out of introducing the flag's real meaning — previously it was set but never actually checked, so an unreconciled placeholder was redundantly re-written to Firebase on every single background sweep for as long as it sat unreconciled).
- `ReconcilePlaceholder.vue`'s `selectMatch()` got the identical treatment: the finalized `type: 'write'` entry is durably queued *before* `writeDatabaseEntryNow` is attempted (coexists fine alongside the original placeholder's own queue entry — different `type`, so `enqueueWrite`'s dedupe-by-path never conflates them), and only removed — alongside the now-superseded placeholder entry — once the write is actually confirmed. A failure leaves both entries queued, so a retry (manual or via the background sweep) has everything it needs; nothing is lost, only the reconciliation step needs redoing.
- **What "bulletproof" now actually means, end to end**: the only window where a rating could theoretically vanish without a trace is being killed before the `enqueueWrite` promise itself resolves — i.e., before the user has seen anything that looks like a save (the optimistic UI commit happens first, but the very next line durably persists it). Once that line completes, the rating survives a killed tab, a crashed browser, a dropped connection, or a hung/failed write — every one of those paths either confirms the write directly or leaves a durable, retryable record that `initializeDB`/App.vue's background triggers pick up on the very next load.

Tests: `src/test/flushPendingWrites.test.js`'s `writeDatabaseEntryNow` describe block (writes directly regardless of `isFlushingPendingWrites`, propagates failure to the caller, no queue interaction at all) plus a new test confirming a `written: true` placeholder is skipped entirely by the general sweep (no redundant `set()` call). `TMDbDataProcessing.test.js`: asserts `enqueueWrite` is called and its call ORDER is strictly before `writeDatabaseEntryNow`'s dispatch (not just that both happen); online+success removes the now-redundant `'write'` entry; online+failure leaves it queued AND re-throws; offline queues without attempting; a placeholder's failed direct write leaves its entry queued (not removed) and swallows rather than throwing; a placeholder's successful direct write marks its entry `written` rather than removing it. `ReconcilePlaceholder.test.js`: finalize asserts the same enqueue-before-write ordering and that BOTH queue entries (finalized + original placeholder) are removed only on confirmed success, or both left alone on failure.

## Fix: PWA update no longer force-reloads mid-task (Jul 2026)

Bug report right after the box office backfill button shipped: "after somewhere between fifteen and sixty seconds, it... resets the app. The page goes white and reloads." Confirmed the backfilled data was NOT lost (each write is confirmed/durable before the local grid updates - see the Offline Movie Rating sections above), so this was a UX bug, not a data bug - but a real one.

**Root cause**: `registerServiceWorker.js` (Vue CLI's default PWA boilerplate, untouched since project creation) had `updated() { window.location.reload(); }` - an **unconditional** reload the instant a new service worker finishes installing and activating in the background. This was always latent, but two things made it bite now: (1) `App.vue` was recently hardened to check for updates from four separate triggers (visibilitychange/pageshow/focus/a 30-min interval - see "Foreground update-check reliability on iOS"), making it far more likely to catch a just-deployed update quickly; (2) the box office backfill is a genuinely long-running operation (15-60+ seconds for a real library), giving a background check plenty of time to land mid-run. But the bug was never actually specific to that button - ANY sustained session (typing a rating, browsing) was equally vulnerable to being yanked out from under the user with zero warning.

**Fix**: `updated()` no longer reloads anything. It commits `setUpdateAvailable: true` to a new store flag instead. New `src/components/UpdateAvailableBanner.vue`, rendered globally from `App.vue` (same "always visible regardless of route" treatment as `BugReportButton.vue`) right below the header, in normal document flow (not fixed-position — avoids z-index/overlap fights with the various per-page back-link affordances that already use the corner-lift trick documented elsewhere in this file; a rare, brief layout shift when it does appear is the acceptable tradeoff). Shows "A new version of Cinema Roll is available" + a "Refresh" button — the user decides when to reload, on their own terms, never automatically.

Tests: `src/test/registerServiceWorker.test.js` (new — stubs `NODE_ENV=production` to actually exercise the module's real `register(...)` call, mocks `register-service-worker` to capture the config object passed to it, then invokes `updated()` directly and asserts `window.location.reload` is genuinely never called — this test would have caught the original bug). `src/test/UpdateAvailableBanner.test.js` (new — hidden when no update, shown + reload-only-on-click when one is available). `App.test.js` gained a render-presence check.

### Correction, same day: the real cause was a second, independent bug
User pushed back — the reload happened "every time," not just once right after a deploy, which the service-worker theory alone couldn't explain (that path only fires when an actual new version has been detected; it wouldn't repeatedly trigger across unrelated attempts). They also flagged it might be a memory leak. Both pointed at the same real culprit, found by re-examining what the backfill button itself does to the app while it runs, not just what happens *to* it externally.

**Actual root cause**: `Home.vue`'s `backfillBoxOfficeData()` called `setMovieLogEntry` — which does `state.movieLog = Object.freeze({ ...state.movieLog, [key]: value })` — **once per movie**, immediately as each one's fetch+write completed. For a real library (hundreds of entries), that's hundreds of full shallow copies of the entire `movieLog` object plus a fresh `Object.freeze()` walk, *each one* also triggering Vuex getters (`allMediaAsArray`, `allMediaSortedByRating`, etc.) and every Home.vue computed that depends on them (search filtering, sorting, grouping — the exact machinery "Search Recompute Performance" above already documents as expensive) to recompute, all firing in rapid succession with `concurrency: 4` giving no natural pacing between them. Not a leak in the strict sense (old objects were still eligible for GC), but the *practical* effect — sustained heavy allocation + main-thread churn piling up faster than the browser could keep up — is indistinguishable from one, and matches a mobile browser eventually killing/reloading an unresponsive or memory-heavy tab exactly.

**Fix — batch everything, don't touch the store once per movie**:
- **New mutation, `setMovieLogEntries(state, entries)`** — applies a whole array of `{key, value}` pairs in ONE spread + ONE freeze + ONE reactivity trigger, instead of N of each. `setMovieLogEntry` (singular) is unchanged and still used everywhere else (ratings, reconciliation) — those are genuinely one-at-a-time, user-driven events with no batching to be had.
- **New action, `updateDatabaseEntriesNow(context, updates)`** — uses Firebase's `update()` (not `set()`) for an atomic multi-path write: `updates` is a flat object keyed by full relative paths across potentially many different movies (e.g. `{'movieLog/key1/movie/budget': 100, 'movieLog/key2/movie/revenue': 200}`), sent as ONE network round trip. This is the remote-write half of the same fix — fewer writes also means fewer `onValue` listener refires (Firebase's own live listener would otherwise pile up its own separate wave of `setMovieLog` reactivity triggers on top of the local ones, compounding the problem further).
- **`backfillBoxOffice.js` redesigned around batching**: fetches still run with full `concurrency` (cheap, no store interaction), but results accumulate in a `pending` buffer and flush as one `writeBatchFn(batch)` call once `batchSize` (default 20) is reached, with a final flush for any remainder. Grab-and-clear on the buffer is synchronous (no `await` before it), which is what makes it safe against multiple concurrent workers flushing without an explicit lock — JS's single-threaded, run-to-completion semantics guarantee only one call can ever see a non-empty buffer at the check.
- **Net effect**: a 400-movie backfill now triggers ~20 store reassignments and ~20 Firebase writes instead of ~400 of each — a ~20x reduction in exactly the kind of event this bug turned out to be about.

Tests: `backfillBoxOffice.test.js` rewritten around the batched `writeBatchFn(batch)` interface (one flush when everything fits in a batch, a full-batch flush mid-run without waiting for all candidates, a final partial-batch flush, a failed batch write counting every member as failed without aborting the run). `flushPendingWrites.test.js` gained `setMovieLogEntries mutation`/`updateDatabaseEntriesNow` describe blocks — including a test that directly counts real Vuex reactivity triggers (`store.watch`) to prove a 20-entry batch causes exactly ONE `movieLog` reassignment, not twenty; that's the actual regression guard for this bug, not just an input/output check.

## Offline Support Extension: Stickiness, Tiebreak, Personal Awards (Jul 2026)

Bug report: "Updates to the stickiness rating and the tiebreaker values and any [Groskers, the user's own name for their personal awards] changes. Also all should be able to be done off-line and then push to the database when I'm back online." The original Offline Movie Rating work (see its own section above) deliberately scoped itself to `AddRating.js`'s write path only, leaving ~10 other `setDBValue` call sites untouched as documented future work — this is that extension, covering the three the user actually asked for.

- **The gap, precisely**: `setDBValue` writes (online) get "instant" UI reflection for free from Firebase's own client-side optimistic cache — the `onValue` listener fires with the new value before the round trip even completes. Offline, that listener never fires until reconnected, so nothing local ever showed the change, AND (before AddRating.js's fix) nothing durable existed on disk if the tab closed first. `AddRating.js` solved this for `movieLog/*` writes specifically (`setMovieLogEntry` for local commit, enqueue-before-attempt for durability). Stickiness/Tiebreak/Personal Awards write mostly to `settings/*` paths (at varying depths — `settings/lastTweak`, `settings/tieBreakTournament`, `settings/personalAwards/<year>`), which had **no** local-optimistic-commit mechanism at all.
- **`src/utils/statePath.js`** (new, pure) — `setValueAtPath(obj, segments, value)`: immutable nested-set by path segments, cloning only the objects actually along the path. General enough to handle any depth, not just the specific paths these three features happen to use today.
- **`applyDbPathLocally` mutation** (store/index.js) — the general-purpose counterpart to `setMovieLogEntry`/`setMovieLogEntries` for everything else: a single-segment `movieLog/<key>` path reuses the exact freeze+reassign shape those already use (proven, and every other `movieLog` writer stays on it unchanged); anything deeper, or anything under `settings/*` at any depth, routes through `setValueAtPath`.
- **`writeDurably` action** (store/index.js) — the shared "offline-safe write" all three components now call instead of `setDBValue`: commit locally via `applyDbPathLocally`, THEN durably `enqueueWrite` (same "enqueue before attempt" ordering as AddRating.js's bulletproofing — durable on disk before any network attempt, so a mid-write app-kill can't lose it), then attempt `writeDatabaseEntryNow` directly if online (removing the now-redundant queue entry on confirmed success). **Deliberately does NOT re-throw on a failed online attempt**, unlike `AddRating.js`'s non-placeholder path — none of these three callers had dedicated per-write error UI before this (they already just `console.error`/`ErrorLogService.error` and move on), and adding blocking error UI to three unrelated flows was a much larger scope than "make it work offline." The durable queue entry is the real safety net either way; a failed attempt just means the existing background flush (App.vue's triggers / `initializeDB`) retries it later, same as the offline case.
- **Call sites swapped, `setDBValue` → `writeDurably`, no payload/shape changes**: `StickinessInline.vue` (1, the full-movie-entry `movieLog/<dbKey>` write); `TweakInline.vue` (7 — `settings/tieBreakTournament` create/update/clear, `settings/lastTweak` stamps, and the `movieLog/<dbKey>` score-adjustment writes in `applyTournamentResults`); `PersonalAwardsModal.vue` (6 — `settings/dailyAwardsYear`/`dailyAwardsYearDate`/`awardsPromptState`/`lastAwardCompletionDate`, and the main `settings/personalAwards/<year>` save in `saveCurrentState`). TweakInline's own `localTournament` optimistic-override field (documented elsewhere in this file) already covered *that* component's instant-UI-feedback need independently of this fix, but the durability half (surviving a kill mid-write, syncing once back online) was still missing before this.
- **Not changed**: `flushPendingWrites`/`writeDatabaseEntryNow`/the queue module itself — all were already fully path-generic (a `dbEntry.path` is just appended to the db ref), so extending coverage to new call sites needed zero changes there.

Tests: `src/test/statePath.test.js` (pure — top-level and nested sets, sibling-preservation at every level, no mutation of the source, null/undefined-base tolerance, empty-path passthrough). `src/test/flushPendingWrites.test.js` gained `applyDbPathLocally mutation` (settings top-level + nested + sibling preservation, movieLog single-segment parity with `setMovieLogEntry`) and `writeDurably action` (local commit happens BEFORE the network attempt resolves, durable enqueue call shape, the queued entry is removed on confirmed success, a failed attempt leaves it queued without throwing, and the offline case commits+enqueues without ever attempting the network write) describe blocks — same "import the real store" pattern that file already established. `src/test/TweakInline.test.js`'s existing `setDBValue` assertions renamed to `writeDurably` (the `lastDispatchTo` helper matches by path, not action name, so most assertions needed no change at all).

## Stickiness prompt: `{...array}` corrupted the rating shape (Aug 2026)

Bug report: "The stickiness prompt is still acting weirdly... it's still showing up when I don't really have a stickiness... It's clearly not correct."

**Root cause — a genuine, long-latent data-shape bug.** `StickinessInline.addStickinessRating` built its updated entry as:
```js
ratings: { ...this.firstStickinessResult.ratings, [index]: { ...updated } }
```
Spreading an **array** into an object literal produces a plain object (`{0: …, 1: …}`) with **no `length`**. `GetRating.js` opens with `if (!media?.ratings?.length) return null` → `calculatePostStickyRatingFor(null)` → `{ calculatedTotal: 0 }`. So the instant a movie was saved this way its local copy lost `date`, `userAddedStickiness`, and its real score. In `resultsThatNeedStickiness` that reads as: flag `undefined` → "hasn't rated stickiness"; `date` `undefined` → defaults to `"1/1/2021"` → "more than a week ago" → **the movie goes straight back into the queue**, permanently, and displays a rating of 0.

**Why it only surfaced now**: `setDBValue` never wrote to local state at all — the malformed object went to Firebase, which normalises sequential numeric keys back into a real array, and the corrected shape came back via the `onValue` listener. Switching this component to `writeDurably` (which commits locally FIRST, by design — see the Offline Support Extension section) made the broken intermediate shape visible for the first time. **Stored data was never affected**, only the local copy, so there's nothing to repair.

Fix: build the new ratings with `.map()`, preserving the array. (`TweakInline.applyTournamentResults` already did it correctly with `.slice().map()` — this was the only site with the object-spread form.)

**Generalisable lesson**: `{ ...someArray }` is never what you want when the value must stay an array, and it fails silently — the object looks right in a debugger and even round-trips through Firebase correctly. Anywhere local state is committed optimistically (which is now most write paths), the malformed shape is what the app actually runs on.

Tests: `src/test/StickinessInline.test.js` (new file — this component had none). The mocked `getRating` deliberately reproduces the real `!ratings?.length` bail so the bug is reproducible in test, and the mocked `dispatch` applies the write back onto the fixture to mirror `writeDurably`'s synchronous local commit. **Verified as a real regression guard** by temporarily reinstating the object spread: 3 of the 5 tests fail. Fixture dates are relative (`daysAgo`) rather than fixed, so an entry can't silently drift into the six-month window as time passes.

## Cost control pass (Aug 2026)

Asked what was costing money and what would run away at scale. Audit findings and the first three fixes.

### What every cold app launch used to cost
| | per launch |
|---|---|
| Firebase `movieLog` | **15.16 MB** |
| Firebase `settings` | 0.44 MB |
| Railway `/awards` | **5.25 MB** |
| TMDB `/movie/{id}` | **98 sequential calls** |

≈21 MB and ~100 API calls **per cold launch** (page reload or PWA open; in-app navigation is fine). Firebase RTDB gives 10 GB/month free then $1/GB, so 15.6 MB per launch is roughly **650 launches/month across all users** before it bills. **A quota cutoff would look exactly like the 1 Aug "banner shows but the movie list is empty" report** — worth checking the usage graph for that date if it recurs.

### 1. The AI endpoint was unauthenticated
`aws-lambda/claude-ai.js` had `Access-Control-Allow-Origin: *`, no auth and no rate limit — and its URL is baked into the public client bundle, so anyone could spend the Anthropic balance in a loop. Got riskier the day email/password signup shipped.

Now verifies a **Firebase ID token** using node's built-in `crypto` (no `firebase-admin` dependency, ~40 lines; needs Node 18+ for global `fetch`, and the function runs `nodejs22.x`). Checks signature against Google's cached x509 certs plus `exp`, `aud` and `iss` — **the audience and issuer checks are load-bearing**: without them a valid token from *any* Firebase project would be accepted. Plus a per-container in-memory rate limit (20/min/user), which is a speed bump not a guarantee — Lambda runs many containers and each keeps its own counter. CORS was tightened too but is *not* the gate; it only constrains browsers.

**API Gateway stage throttle (set Aug 2026):** the `$default` stage of `cinemaroll-ai-api` (HTTP API `2lyldox07e`) had **no throttle at all**, i.e. the AWS default of 10,000 req/s. Now `ThrottlingRateLimit=2`, `ThrottlingBurstLimit=10`. The sustained rate is what bounds spend; the burst only smooths legitimate spikes (several people starting a round at once), so widening burst costs nothing. Verified live: a burst of 30 produced 429s, a realistic burst of 5 passed clean.

Two other bounds discovered while doing it, worth knowing:
- **The AWS account's Lambda concurrency limit is 10** (not the usual 1,000), so at most 10 of these can run at once — a real throughput ceiling in its own right. It's also why reserved concurrency isn't usable here: AWS requires leaving ~100 unreserved.
- Overflow beyond that surfaces as **503**, not 429. During testing, 503s looked like an application error until CloudWatch showed no lambda errors at all — worth remembering before chasing a phantom bug.

**None of this is a spend cap.** Throttling limits RATE, not total: 2/s sustained is still ~172k calls/day. The only hard money ceiling is a **spend limit on the Anthropic API key** (console → Organization → Limits) plus an AWS budget alert. Both are console-only and were left for Matt.

Client side, **`src/utils/aiRequest.js` is the only place that attaches the token**, so no caller can forget. It throws rather than firing a request that would 401 anyway.

**Verified end-to-end, not just by unit test**: minted a real ID token via the Admin SDK + Identity Toolkit REST, then confirmed a valid token returns 200 with real keywords, and a forged token and a missing token both return 401. (The probe's throwaway auth user was deleted afterwards.)

### 2. Two fetches that ignored their own caches
- **`academyAwardWinners` had no persistence at all.** It enriches ~98 Best Picture winners with one TMDB call *each*, sequentially, and was guarded only on in-memory state — so all 98 ran on **every** cold launch. Now cached to IndexedDB under `'global'` (not user-specific). Only caches a non-empty result, so a failed fetch retries next launch.
- **`allAcademyAwards` kicked off the cache read and the 5.25 MB network fetch in parallel.** The snapshot only ever won a race to first paint; the download happened regardless. Now awaits the cache and skips the fetch entirely on a hit. The old test asserted that race, so it was replaced with cache-hit / cache-miss tests — the race was the bug.

Together these remove ~5.25 MB and ~98 API calls from every launch.

### 3. Model choice is a cost decision
All three routes were on **Opus** ($5/$25 per M tokens) for prompts that are just a title and a year. Now:
- `keywords` → **Haiku 4.5** ($1/$5). Thematic labels; nothing to get factually wrong.
- `context` / `trivia` → **Sonnet 5**. These have to be TRUE, and cheap models confabulate hardest on obscure factual recall. Trivia is *unverifiable to the player*, so a wrong "fact" quietly becomes part of the game. Still well below Opus.

Dropping trivia to Haiku is a one-line further saving if quality holds up. Note the old ID `claude-opus-4-5` isn't in the current lineup.

### Still outstanding: the scaling problem
The library is re-downloaded in full on every launch, which is what makes cost scale linearly with launches (~2.3 TB/month at 1,000 users × 5 launches/day ≈ $2,300). Fixing it needs a compact index node (title/poster/rating/date — all the grid needs) with full entries loaded on demand. **Not yet done — deliberately scoped separately.**

## Slimming the stored library (Aug 2026)

The follow-on from the cost audit. The library was **15.2 MB re-downloaded on every cold launch**, which is what made Firebase cost scale with app opens rather than with users.

### What was actually in it
| | | |
|---|---|---|
| `movie.crew` | 7.39 MB | **49%** — 91 people/film |
| `movie.cast` | 3.03 MB | 20% — 45/film |
| `_search` | 0.98 MB | 6% |
| everything else | 3.80 MB | 25% |

**Half the database was crew nothing reads.** TMDB returns every credit — stunts, hairstylists, "Thanks" — and `AddRating` stored all of them.

### The compact-index idea was wrong, and measuring caught it
The first sketch was "store a small index (title/poster/rating) and load full entries on demand". That doesn't work: **search matches on cast names, crew names and keywords**, so an index like that can't support the app's most-used feature. Abandoned before any code was written.

### What shipped: `src/assets/javascript/storedEntry.js`
One definition of "trimmed", shared by the write paths and the migration.
- **`KEPT_CREW_JOBS`** — substring matching, mirroring `getCrewMember`'s own loose matching ('Photo' catches "Director of Photography"). **Screenplay/Story/Novel are load-bearing, not extras**: `FavoriteWriters` and Home's crew grouping key off them, and **754 of 1,368 movies have no plain "Writer" credit at all**. Dropping them would have silently broken writer attribution for over half the library — caught by measuring, not by reading the code. Production Design / Costume Design / Casting are kept so those credits stay searchable.
- **`RUNTIME_ENTRY_FIELDS` (`dbKey`, `_search`)** — injected when READING (the store's getter; Home's search memoisation) and written straight back by any code spreading a whole entry. ~1 MB of pure junk, uploaded and re-downloaded forever. Four `...this.result` writes in MovieDetail did this, and `addMovieRating`'s carry-over did it on every re-rate.
- **`DERIVED_MOVIE_FIELDS` (`flatKeywords`)** — recomputed on load everywhere it's used (MovieDetail lines 824/1212), so storing it was redundant.

**Cast is deliberately untouched.** Six Degrees walks the full billing list on purpose (see its uncapped `playGraph`), so trimming cast would regress a fix made specifically for that.

### The migration
"Slim down stored data" in Settings. Uses **multi-path `update()` with `null` values to DELETE paths** — the only way to remove a field without rewriting the whole entry, which is what created the problem in the first place. Batched (25/write) for the reason every migration here is batched. Idempotent: `collectEntriesNeedingTrim` returns nothing once done.

**Measured against the real library: 15.20 → 9.49 MB, 38% smaller.** Free-tier headroom goes from ~674 to ~1,079 cold launches/month. A backup of the pre-migration library was taken to the session scratchpad.

### Still not solved
38% is a shave, not a fix — cost still scales linearly with launches. The real answer is **delta sync**: an `updatedAt` per entry, query only what changed since last sync against the IndexedDB snapshot that already exists. The hard part is **deletions** (a "what changed" query can't report absence, so it needs tombstones or a periodic full resync), plus setting `updatedAt` on every write path, of which there are now many. Deliberately not attempted — worth doing only if usage actually approaches the cap.

## Delta Sync — phase 0 only (Aug 2026)

The library is re-downloaded in full on every cold launch (9.49 MB after the trim above), which is what makes Firebase cost scale with app opens rather than with users. The fix is to fetch only what changed. **Phase 0 — recording what changed — has shipped. Nothing reads it yet.**

### What phase 0 does
**`src/assets/javascript/syncStamp.js`** (pure, store-free) decides how each write is performed:
- Paths outside `movieLog` (settings, etc.) are untouched — settings are small enough to always fetch whole.
- A **whole entry** (`movieLog/<key>`) gets `updatedAt` injected into the value and stays a `set()`. Ratings are the most critical write path in the app and `set()`'s replace-the-whole-entry semantics are what `addRating` and `deleteRating` both depend on, so that path's mechanics are left completely alone.
- A **field inside an entry** becomes one atomic `update()` carrying both the field and the entry's `updatedAt`. It has to be a single round trip: stamping separately after a successful write means a failure between the two leaves the entry changed but *unstamped*, which is invisible and would hide it from every future sync.
- A **deletion** becomes an atomic `update()` that removes the entry and writes a tombstone at `movieLogDeletions/<key>` together. A "what changed" query can report presence but never absence, so without tombstones a movie deleted on one device lingers on every other one forever.

**The timestamp is `serverTimestamp()`, never `Date.now()`** — assigned by Firebase, so a device with a wrong clock can't hide a movie from itself. This also means a write queued offline for hours is stamped when it actually lands, not when it was made.

### Why this needed almost no call-site work
**All 58 movieLog writes funnel through four store actions, which collapse into two chokepoints** — `performDatabaseWrite` (behind `setDBValue`/`writeDurably`/`writeDatabaseEntryNow`) and the `update()` inside `updateDatabaseEntriesNow`. Stamping in the plumbing rather than at the call sites means no caller *can* forget, which is what made "every write path must set `updatedAt`" tractable instead of a 15-file audit.

### Traps, all confirmed live against the sandbox
Verified with a throwaway Firebase Admin SDK probe (written into `scripts/`, run, then deleted — the admin SDK can't resolve from the scratchpad, see the awards-fixtures note above), writing only under `testing-database/movieLog/__syncProbe_*` and cleaning up after itself:
- **Overlapping paths are genuinely rejected.** `update({'movieLog/k': null, 'movieLog/k/updatedAt': TS})` fails outright — *"values argument contains a path /movieLog/k that is a parent of another"*. So the "never stamp a deletion" guard in `stampPlanForWrite` is load-bearing, not defensive. And had Firebase accepted it, the entry would have come back as a bare timestamp and nothing else.
- The server sentinel (`{'.sv': 'timestamp'}`) **survives `removeNaNAndUndefined`**, which recurses through the whole payload — its only leaf is a string, so nothing is stripped. Pinned by a test.
- `update()` **replaces at each named path** rather than merging into it (a field write doesn't clobber its siblings, and a whole-array write really does replace the array). Already relied on by the trim migration; now confirmed directly.

### The index — the thing that makes any of this pay off
`scripts/generate-database-rules.mjs` now emits `.indexOn: ["updatedAt"]` under `$topKey/movieLog`. **Without it the delta query does not fail — Firebase downloads the entire node, filters client-side, and logs only a console warning.** The data would be correct and the saving would be exactly zero. It rides along on the same pending `firebase deploy --only database` as the locked-down rules, so phase 1 doesn't need a second deploy.

### Backfill
Settings → **"Add change timestamps"** (`Home.backfillSyncStamps`, batches of 100 through `updateDatabaseEntriesNow`). Strictly optional — an unstamped entry is simply never returned by a delta query, which is correct as long as the local snapshot already holds it — but a uniform library removes a whole category of "why is this movie invisible to sync" reasoning. Local state is deliberately NOT committed: the real timestamps arrive via the `onValue` listener, and committing the placeholder would put a value in state that was never stored.

### Phases 2/3 — shipped together, default on for everyone (2026-08-17)
Phase 1 (shadow mode) ran Aug 14–17: 15 clean launches for Matt, a handful for others,
and one real catch — the Aug 15 "Dune" divergence (entry stale on every boot, stamp
exactly equal to lastSync, cause never conclusively named; `describeStaleEntry`
instrumentation was added so a recurrence explains itself). Matt then called it:
evidence thin but the failure mode bounded, ship the whole thing with revert paths.

How it works (`launchPlan` in `deltaSync.js` + `initializeDB`):
- A launch with a baseline (`deltaSyncMeta.lastSync`), a non-empty IndexedDB snapshot,
  and a full sync within 3 days attaches a `startAt(lastSync)` **query listener** —
  which serves both the catch-up set at attach and every live change for the session,
  since every write's `serverTimestamp()` stamp is >= the baseline. A second (tiny)
  listener on `movieLogDeletions` applies tombstones by the newer-stamp-wins rule.
- Anything else — first run, lost snapshot, resync due, meta predating phase 2, any
  error in the plan — attaches the old full listener, where the shadow comparison
  still runs and records a reading. **Verification continues at resync cadence.**
- Snapshot and `lastSync` are persisted together in the same reconstruction pass —
  the invariant that keeps the next launch's `startAt` sound.
- Escape hatch: "Refresh library from server" (Settings → Maintenance) clears the
  baseline and reloads into a guaranteed full download.

Known accepted risks, and what bounds them:
- **Unstamped changes don't propagate via delta** (the Dune class). Healed by the
  3-day full resync; detected by the shadow reading that resync records.
- **Stale read → user edit → stale write-back** on multi-device use. Bounded by the
  resync interval; recoverable from `~/cinemaroll-backups`.
- A local serverTimestamp echo can overstate lastSync by client clock skew, which
  could skip another device's near-simultaneous write until resync. Same bound.

Revert: `git revert` + deploy (the meta/snapshot machinery is
backward-compatible in both directions — a full-download build simply ignores it).

Design notes for whoever picks this up:
- **Tombstones are advisory, compared by time, not applied blindly.** Apply a deletion only when `movieLogDeletions/<key> > movieLog/<key>/updatedAt`. That way re-rating a previously deleted movie wins naturally on its newer timestamp, so nothing ever has to clear a tombstone — which would otherwise need to be atomic with the entry write and can't be, given `set()` is what that path uses.
- **`lastSync` must be the maximum `updatedAt` actually received**, never a local clock reading — that's what keeps clock skew out of it entirely.
- **`lastSync` and the IndexedDB snapshot must be stored and invalidated together.** If the snapshot is ever lost while `lastSync` survives, a delta fetch returns almost nothing and the library looks empty.
- The listener currently *replaces* `movieLog` wholesale; a delta listener must *merge*, which touches the same code as `reapplyInFlightWrites`' clobber protection.
- Tombstones grow forever (~40 bytes each). Fine at any realistic scale, but prunable once every device has certainly synced past them.
- **Not urgent.** After the trim, the free tier allows ~1,079 cold launches/month against a handful of real users. This is insurance against growth.

Tests: `src/test/syncStamp.test.js` (24, pure — path classification, all four write shapes, the no-stamp-on-deletion guard, batch stamping incl. the overlapping-path avoidance, backfill collection). `src/test/flushPendingWrites.test.js`'s `change tracking on every library write` block (8, against the real store — the actual Firebase call shapes, including that queued offline writes are stamped at flush time and that the sentinel survives the scrubber). Note every `vi.mock('firebase/database')` factory now needs a `serverTimestamp` export or the store import fails.

## Where the money actually went — billing audit (2026-08-17)

Matt's GCP statements looked scary (July 2026: $78.62 vs a ~$40 baseline), so the
Cloud Console billing reports were read directly. Findings:

- **100% of all 2026 spend ($380 YTD) is one SKU: Realtime Database "Outgoing
  Bandwidth"** (~$1/GB) on `movie-log`. No other Google service bills at all.
- **Statements lag usage** — June's statement was $7.70 and July's $78.62 only
  because of payment timing; real usage was ~$52 (June) / ~$74 (July). Read
  Billing → Reports, not the statement/invoice list.
- **Cost tracks development activity, not users.** July (142 commits) ran a flat
  ~$2.40/day; January–March ran ~$1.30/day. Every dev-server reload and QA
  session re-downloads a full library.
- **The Aug 15 backup system immediately became the biggest line item**: a full
  124 MB download per `predeploy`, × 36 deploys on Aug 15 / 56 on Aug 16 under
  deploy-per-stopping-point ≈ $4–7/day. The Aug 2026 cost-control pass's real
  savings (awards cache, 38% trim) were invisible under it.
- **`testing-database` was a pre-prune clone of Matt's account** — 70 MB, 56% of
  the whole DB, most of it the same dead `tvLog` (39.6 MB) + `sharedDBSearches`
  (24.9 MB) pruned from the real account on Aug 15. Every backup re-bought it.

Fixes shipped same day:
- `predeploy` now passes `--skip-if-fresh=6` to `backup-database.mjs`: skip the
  backup when a snapshot under 6 h old exists (filename timestamps only — no DB
  read). Manual `yarn backup-db` and `prune-legacy-branches.mjs`'s safety backup
  still always run. Pure logic in `scripts/snapshotFreshness.mjs`, tested in
  `src/test/snapshotFreshness.test.js`.
- `prune-legacy-branches.mjs` takes `--account=<db-key>` (required) so the
  sandbox could be pruned the same way Matt's account was.

Still open, smallest first: natalierosegrosso (7.8 MB `sharedDBSearches` +
1.1 MB `tvLog`) and hopper-seth (4.3 MB `sharedDBSearches`) carry the same dead
branches — real users' accounts, so not touched without Matt's say-so; pennies
once backups are throttled. The structural fix for the per-launch download
remains delta sync phase 2/3 above.

## Lie-fi: "my phone thought I had a connection, but basically did not" (2026-09-23)

Matt, after a day in a low-signal area: "There were a lot of things where it
felt like I would tell it to do something and it would just sit there... my
phone thought I had a connection, but basically did not." An earlier pass had
blamed Insights' CPU cost (real, fixed the same day - see GetRating's range
memo) and tested with DevTools network throttling, which changed nothing.
That was the wrong instrument: CDP throttling never touches service-worker
or websocket traffic, and slow is not dead.

**The reproduction that worked** is `scripts/liefi-proxy.mjs`: an HTTP proxy
that accepts every connection and, in blackhole mode, never returns a byte -
existing tunnels drop everything, new CONNECTs are "established" and silent.
`navigator.onLine` stays true throughout. Chromium via Playwright with
`bypass: '<-loopback>'`, dist/ served locally, tester signed in with Matt's
library cloned, 4x CPU throttle, service worker precached before the switch.

**What actually sat there.** Screen-to-screen navigation was fine (precache).
Relaunch was fine (IndexedDB snapshot, auth restore does not block). What
hung: anything that talked to TMDB (no axios call had a timeout, so the
search-for-a-new-title spinner never ended, and with it the whole results
area including the Settings/Insights buttons), and any Firebase write (15s
timeout, then an error). The offline branches - rate from memory, the
queued write, the banner - all existed and never engaged, because every one
of them keys off `store.state.isOnline`, which was `navigator.onLine`, which
was true.

**The fix, `src/utils/networkHealth.js`:** "online" now means "the internet
is answering". Every axios request gets an 8s timeout; a timed-out or
network-failed request (or a timed-out Firebase write) marks the connection
STALLED, which sets `isOnline` false - so every existing offline path
engages, and the banner says "Your connection isn't answering" rather than
"You're offline" (bars are showing; "offline" would read as wrong). While
stalled, a no-store fetch of index.html probes every 15s; the first answer
(or any successful request, or the browser's own 'online' event) clears the
stall and flushes the queue. `flushPendingWrites` now guards on
`state.isOnline`, not `navigator.onLine`. Measured under blackhole: the
rate-from-memory offer at ~10s (8s timeout + the 1s mount delay + debounce),
save in ~3s, back online 8-15s after signal returned, the queued rating on
the server after that.

**Two real bugs under the rock.**
1. `pendingWriteQueue.enqueueWrite` was failing for EVERY rating queued from
   the form - offline, placeholder, and the durability copy under an online
   save - and swallowing the error. RateMovie hands over its reactive
   `ratings` array; IndexedDB's structured clone refuses a Proxy ("[object
   Array] could not be cloned"); the user saw "offline storage is
   unavailable" and the rating was gone. The unit tests only ever queued
   plain objects. Records are now JSON-round-tripped to plain data
   (`pendingWriteQueueReactive.test.js` fails on the old code), the catch
   logs, and open/put are bounded (6s) with onblocked/onabort handled - an
   unsettled promise there was a form stuck on "Submiting…".
2. `addRating` for a brand-new movie whose TMDB detail fetch failed threw,
   and RateMovie said "check your connection and try again" - the rating
   typed out was simply lost. It now falls back to a placeholder rating
   (poster, title and date kept from the search result, `pendingTmdbId`
   stashed) exactly like rating from memory offline. `AddRatingLieFi.test.js`.

**Harness notes.** A Playwright `click()` blurs the search input first,
which turns the typed title into a chip and re-renders the button under the
pointer - dispatch the click from `page.evaluate` (that is what a finger
does). `page.reload()`/`page.screenshot()` hang under blackhole waiting for
images and fonts; use `waitUntil: 'commit'` and CDP `Page.captureScreenshot`.
The tester's Firebase keys are `<timestamp>-<uuid>-<title>`, so look for a
test title by substring, not `orderByKey().startAt()`.

