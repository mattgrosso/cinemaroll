# UI, Layout & Performance — development history

> Archived from CLAUDE.md. Verbatim post-mortem narrative, kept for the hard-won
> detail. Durable rules extracted from this live in `.claude/rules/`.

## Favorite Sections — Live Tuning (Jun 2026)

The 8 `Favorite*` sections on the Insights page (Directors, Writers, Composers, Cinematographers, Editors, Producers, Actors, Actresses) each rank people by a weighted Bayesian score. Each now has an inline **✏️ tuner**: a small icon-only button pinned to the right of the section's top-border title (absolutely positioned against `.insights-pane`, so the centered title is undisturbed) that opens a collapsing accordion of labeled sliders with plain-language help text.

- **Shared machinery: `src/mixins/favoriteTuning.js`.** Holds ONLY the type-agnostic plumbing: the TMDB details cache (`detailsCache`), Firebase load/save of tuner values (`loadPersistedTuning`/`persistTuning`), tuner event handlers (`onTunerUpdate`/`resetTuner` → `await this.rescore()`), `getCachedDetails`, `bayesianAverage` (with a `globalAvgOverride` param), `mostRecentRating`, `getDetailsForCastMember`, `updateSearchValue`, and the `mounted`→`waitForDataAndBuildList` boot. Exposes `getRating`. A consumer MUST provide: data `tuningKey` + `tuningDefaults` + one data prop per lever; computed `tunerLevers`; methods `averageRating`, `buildTopTwelveList` (gather), `rescore`.
- **Per-section independence preserved.** Every section keeps its own `tuningDefaults`, lever values, gather logic, blend field, and scoring quirks in its own file. Values persist per section at `settings/favoriteTuning/<key>` (keys: `director`/`writer`/`composer`/`cinematographer`/`editor`/`producer`/`actor`/`actress`) and survive refresh + sync across devices. The mixin holds zero tuning values.
- **Gather/rescore split = no re-fetch while tuning.** `buildTopTwelveList` gathers people ONCE per data load (no TMDB, no minEntries filter); `rescore` scores eligible people with current levers, lazily fetching+caching TMDB details only for the eligible set, guarded by a `rescoreSeq` token that drops superseded async passes. Dragging a slider never re-hits TMDB (enforced by test).
- **Lever sets differ by archetype** (each `tunerLevers` reflects only what that section actually uses):
  - Crew **with blend** (Directors=`direction`, Writers=`story`, Composers=`soundtrack`, Cinematographers=`imagery`): minEntries, confidenceNumber, countWeight, knownForWeight, `<blend>Weight`.
  - Crew **no blend** (Editors, Producers): the same minus the blend lever (Producers' `countWeight` slider maxes at 10 — its default is 5).
  - **Cast** (Actors gender 2, Actresses gender 1): minEntries, confidenceNumber, billingLimit, billingExponent, performanceWeight. Cast `rescore` RE-GATHERS each pass (billingLimit/billingExponent change the gathered set/weights) and walks highest-bayesian-first, gender-gating via cached TMDB lookups until 12 found.
- **Exact scoring preserved per section.** Known-for bonus intentionally differs: Directors/Composers blend the role sub-score; Writers/Cinematographers/Editors/Producers use the plain overall (`calculatedTotal`). `manualBoosts` is a dormant empty scaffold — NOT exposed in the tuner (cast components never had it).
- **Net effect**: added the whole tuning feature while the 8 components shrank ~300 lines (dedup of the cloned machinery). Dead `compareTwoLists`/`isList…`/`get*Breakdown` helpers were dropped.
- **UI component: `FavoriteTuner.vue`** (presentational only — emits `update`/`reset`). Tests: `FavoriteTuning.test.js` (Directors deep-dive), `FavoriteSectionsTuning.test.js` (all 8: build, persist key, live retune, no-refetch, cast gender gate), `FavoriteTunerSmoke.test.js`.

## Asset / Image Performance (Jun 2026)

A pass over image + asset loading on the high-traffic home/library screen:

- **Lazy-load placeholder shrunk 316KB → 1.4KB.** The `v-lazy` `loading` placeholder behind every grid poster (`DBGridLayoutSearchResult.vue`) was `sheen.jpg` — a full 2000×3000 poster. Replaced with `sheen-placeholder.jpg` (40×60, metadata-stripped, visually identical when stretched). Old file deleted; it had a single reference.
- **`moment` removed** — it was a direct dependency with ZERO imports anywhere in `src/`. Dropped from `package.json`; confirmed gone from `yarn.lock` (nothing transitive needed it).
- **Library grid posters w500 → w342** (`DBGridLayoutSearchResult.vue:11`, the `v-lazy` src only). ~55% fewer bytes per poster at the rendered mobile size. Other w500 usages (details-modal backdrop on line 48, StickinessInline, TweakInline, ShareDBResults, PickMedia, RateMovie) intentionally kept — they show one/two large posters where w500 is right.
- **Lazy-load pre-trigger** (`main.js`): `VueLazyLoad` now passes `observerOptions: { rootMargin: '1200px 0px' }` (default was `'0px'`). Posters start fetching ~1.5 screens before entering the viewport, so the placeholder is effectively never seen on normal scroll. Dial: bump to `'2000px'` if fast scrolls still flash placeholders, drop to `'800px'` to be stingier on data.
- **`vue3-calendar-heatmap` removed (Jul 2026)** — registered globally in `main.js` (`app.use(VueCalendarHeatmap)`) but with **zero template usages anywhere** (`grep -ri heatmap src/**/*.vue` — nothing; the actual calendar UI is `FullCalendarView.vue`, built on `@fullcalendar/*`, a completely different library). Same dead-weight pattern as the `moment` removal above — it just hadn't been noticed because it doesn't throw or lint-warn (registered as a plugin, not an unused import). Its transitive dependency `tippy.js` (also listed, redundantly, as our own direct dependency despite zero direct imports) went with it. `chunk-vendors.js`: 796 KB → 762 KB (220 KB → 209 KB gzipped) — modest, but it's dead code either way.
- **Bundle-size investigation (Jul 2026)**: the obvious suspects — Chart.js, `vue-chart-3`, `@fullcalendar/*` — turned out to **already be correctly code-split** into their own per-route async chunks (`insights.js`, `year-in-review.js`, a numbered chunk), *not* sitting in the eager `chunk-vendors.js`. Verified by grepping the built `dist/js/*.js` files for library-specific strings (e.g. `"Chart.js v"`, `"FullCalendar"`) rather than assuming from import locations. What *is* in `chunk-vendors.js` is dominated by Firebase (the full app+auth+database modular SDK, ~62 string-match density vs. next-highest ~15-21 for Vuex/tippy/axios/Sentry) — all things `main.js`/`store/index.js` need eagerly on every page (auth state, routing guards read `store.getters` synchronously), so there's no easy "just lazy-load it" lever left without swapping Firebase for something lighter, which is a much bigger undertaking than tonight's scope. Net: the vendor bundle is already close to as lean as it can get without a larger architectural change; 762 KB / 209 KB gzipped for an app this size isn't alarming for a personal app used by a handful of people.

## "Can't scroll to the bottom" + sideways scroll on iOS PWA (Jun 2026)

Symptom (reported on the installed iOS PWA, phone only): the page scrolls *most* of the way but stops ~5% short of the bottom, hiding the bottom controls (Submit / poster buttons). On RateMovie it *intermittently* also wants to scroll **horizontally**, into empty space (nothing visible is out there). It builds up over a session across **all** screens and only resets on a force-quit/reload.

**Root cause — a form field overflowing its grid column horizontally, which latches the iOS layout viewport wider than the screen.** RateMovie's date field is `<input type="datetime-local">` in a narrow Bootstrap `.col-5` (the `medium` `<select>` in `.col-4` is a milder version). These controls have a UA-imposed **intrinsic minimum width** (datetime-local reserves room for "MM/DD/YYYY, --:-- --") that beats Bootstrap's `width: 100%`, so the field's layout box pokes past the right edge even though its visible area looks fine — hence "I can scroll over but there's nothing there." On the standalone iOS PWA that horizontal overflow latches the layout viewport wider than the visual viewport; the now-too-wide viewport throws off every screen's `100vh`-based vertical layout, cutting off the bottom, until the app is fully reloaded. The two symptoms (sideways scroll + cumulative bottom cut-off) are one bug.

Fix (two complementary parts):
- **Root cause — `RateMovie.vue` `.form-control, .form-select { min-width: 0; max-width: 100%; }`** (scoped under `.rate-movie`). `min-width: 0` lets the controls shrink to their column instead of overflowing it. This is the actual fix.
- **Global safety net — `App.vue` `.cinema-roll { overflow-x: hidden; max-width: 100%; }`.** Clips *any* stray horizontal overflow (current or future, from any component) so the page can never scroll sideways and the viewport can never latch. Vertical page scroll is unaffected (the document, not `.cinema-roll`, is the vertical scroll container). Without this the datetime field would just be clipped; without the min-width fix it would fit but be cut on the right — both are needed.

Verified earlier (browser, desktop width 2560): zero horizontal overflow on Home or RateMovie — confirming the offender is width-dependent (fine when the column is wide, overflows only at phone width). Test impact: RateMovie/Home suites still pass (CSS-only change). To re-verify on device, test the actual iOS PWA — the overflow does not reproduce at desktop width.

### Unrelated minor fix landed alongside: modal scroll-lock leak
While investigating, a *separate* latent bug was found and fixed (it is NOT the cause of the above — `body.no-scroll`'s `overflow:hidden` blocks ALL scrolling, not a 5% short-stop). Modals lock body scroll via the global `body.no-scroll` class (`App.vue`; toggled by `Modal.vue`, the 8 `Favorite*` components, Home's movie-info modal) or `document.body.style.overflow` (`RateMovie.vue`'s context modal), relying on their own close handler. `Home.rateMovieFromModal()` routed to `/rate-movie` without removing `no-scroll`, leaking the lock onto later screens. Fixes: `router.afterEach(() => { document.body.classList.remove('no-scroll'); document.body.style.overflow=''; })` in `src/router/index.js` (global safety net for the whole modal class) + `rateMovieFromModal()` now calls `closeMovieInfoModal()` before navigating. Tests: `src/test/ScrollLockCleanup.test.js`. (The router `afterEach` isn't unit-tested — importing the real router pulls in `store/index.js` which inits Firebase at module load.)

## RateMovie rating-select extraction (Jun 2026)

The eight rating criteria on RateMovie (direction, imagery, story, performance, soundtrack, stickiness, love, overall) used to be eight near-identical inline `<div>`+`<label>`+`<select>` blocks (~330 lines, with five byte-identical copies of the standard 0–10 option list). Extracted to a presentational child + a data-driven `v-for`:

- **`src/components/RatingSelect.vue`** — props `label`, `description`, `name`, `options` (`[{ value, label }]`), `modelValue`; emits `update:modelValue`. Renders the wrapper/label/description and a native `<select>` whose `v-model` is proxied through a `selected` computed, so binding semantics match the old inline markup **exactly** (string option values; a `null` initial shows the leading empty option, which the component renders — it's NOT in the `options` array). All scoring/default logic stays in the parent.
- **`RateMovie.vue`** — three module-level option constants (`STANDARD_OPTIONS`, `LOVE_OPTIONS`, `STICKINESS_OPTIONS`, built via `.map((label, value) => ({ value: String(value), label }))`) feed a `RATING_FIELDS` array (`{ key, label, description, options }`) exposed as `data().ratingFields`. The template is one `<RatingSelect v-for="field in ratingFields" v-model="$data[field.key]" :name="field.key" …/>`. **`v-model="$data[field.key]"` is deliberate** — it keeps the eight flat data props (`this.direction`, etc.), so `rating`, `addRating`, weights math, etc. are untouched (zero blast radius outside the template). `field.key` doubles as the data-prop name, the select id/name, and the criterion name used by the rating math, so array order = on-screen order.
- Per-scale shapes: STANDARD (0–10) is shared by direction/imagery/story/performance/overall; LOVE is 0–10 values with custom labels (-5…5); STICKINESS is 0–5. RateMovie's `<style>` is **not** scoped, so `.rate-movie .form-select { min-width:0; max-width:100% }` still applies to the child-rendered selects.

Tests (written before the extraction as the safety net): `src/test/RateMovieSelects.test.js` asserts at the **DOM level** (full `mount`, not shallowMount — which would stub the child) the 8 selects' labels, exact option value/label lists, and v-model binding; it was confirmed green on the OLD inline code first, then on the refactor, so it proves behavioral equivalence. `src/test/RatingSelect.test.js` unit-tests the child (render, empty option, modelValue reflection, emit).

## Insights: `estimatedMoviesThisYear` clarity pass (Jul 2026)

Bug report: "I don't really remember how I calculated that, can you look that over and see if it seems like it's giving an accurate number or if we could make it more precise." (The "N to Date"/year-end-pace estimate shown on the Insights page, `Insights.vue`'s `estimatedMoviesThisYear` computed.)

- **Audited the math by hand — no actual bug, but real obfuscation.** The pre-existing formula computed "movies per week this year" and "movies per month this year" by rescaling the SAME whole-year-so-far daily rate up and back down again (`moviesWatchedThisYear / (dayOfYear / 7)`, then `* (remainingDays / 7)`) — algebra shows those two terms are exactly identical to just `(moviesWatchedThisYear / dayOfYear) * remainingDays`, so despite reading like three independently-computed estimates blended together (`combinedEstimate`), it always reduced to using the whole-year rate three times over. The GENUINE diversification (recent-2-week rate, recent-2-month rate) was already present, one level further down in the formula (`recentWeeksAdjustment`/`recentMonthsAdjustment`) — and once the redundant middle step's algebra is followed through, the ORIGINAL code's final output already exactly equals a clean, honest equal-weighted blend of (whole-year rate, recent-2-week rate, recent-2-month rate) projected across the remaining days. Confirmed this is not just an approximation but a byte-for-byte identical result by simplifying the formula and running it against the existing characterization test in `Insights.test.js` (`estimatedMoviesThisYear` for a fixed fixture → same locked-in value, `15`, unchanged).
- **Fix: simplified to the clean 3-rate-blend form directly** (`wholeYearRate`, `recentWeeksRate`, `recentMonthsRate`, all normalized to movies/day, averaged, then `* remainingDays`) — same output, but now honestly reflects what it computes instead of laundering one number through three redundant unit conversions. No visible number changed for any user.
- **Not changed**: the actual WEIGHTING (equal thirds) or which time-windows feed the estimate. Favoring recent behavior more heavily than the whole-year average would be a legitimate, arguably-more-accurate alternative (recent pace usually predicts near-future pace better than a stale year-to-date average, especially early in the year when the whole-year rate is based on very little data) — but that's a genuine philosophy/design call about what "accurate" should mean here, not a bug fix, so it wasn't made unilaterally. Revisit if the user wants a different weighting.

### 4th signal: last year's seasonal shape, guarded (Jul 2026, immediate follow-up)
User's own framing: "can we look at what I was doing last year and use that to help guide the number... build in some guards against people with very small libraries, so it only works for those where it will actually be effective."

- **What it adds**: a genuinely NEW kind of signal, not another rescaling of the same rate. The existing 3 estimates all extrapolate THIS year's own recent pace forward — none of them can see real seasonality (e.g. habitually watching more during awards season, or less during a busy summer). New `seasonalProjectedAdditional` computed: takes the fraction of LAST year's full-year total that had already been watched by this exact same calendar date (via the pre-existing `moviesWatchedLastYear`/`moviesWatchedLastYearToDate` computeds — `moviesWatchedLastYearToDate` already correctly compares by month/day, not a raw day-of-year count, so it's leap-year-safe for free), then scales this year's current count by the inverse of that fraction to imply a full-year total, and returns the ADDITIONAL movies that implies. `estimatedMoviesThisYear` pushes this onto the same array of "additional movies" estimates the other 3 already populate and averages them all equally — becomes a 4-way blend whenever the signal qualifies, otherwise stays exactly the pre-existing 3-way blend (verified: the untouched characterization test for a fixture with no prior-year data still returns the same locked-in `15`).
- **Three independent guards, each able to disqualify the signal on its own** (`seasonalProjectedAdditional` returns `null`, which `estimatedMoviesThisYear` treats as "leave this signal out," not zero):
  - `MIN_LAST_YEAR_TOTAL = 12` — a full prior year averaging under one movie a month isn't enough texture to imply a real "shape." This ALSO naturally excludes anyone who wasn't using the app (or didn't exist as a user) last year, since their full-year total would be 0 — no separate "does last year's data even exist" check needed, it falls out of the same threshold.
  - `MIN_LAST_YEAR_TO_DATE = 4` — a fraction computed from only a couple of movies is noisy regardless of how large the denominator is (1 movie by this date out of a 20-movie year is a real data point, but far too thin to trust as "typical").
  - `MIN_FRACTION = 0.15` — a belt-and-suspenders floor on the FRACTION itself, independent of the two count guards above: caps how aggressively the signal can scale up the estimate even when both counts clear their thresholds but the split still happens to be extremely lopsided (e.g. a binge-heavy December last year) — `Math.max(fraction, MIN_FRACTION)` before dividing, so one unusual year can nudge the blend without dominating it.
- Tests: `Insights.test.js` — each guard tested in isolation (a fixture that only trips ONE threshold at a time, confirming they're independently sufficient to disqualify), an exactly hand-computable non-guard-tripping case (0.5 fraction, round numbers, asserts the precise implied value rather than just "not null"), the `MIN_FRACTION` floor case (asserts the capped value, not the uncapped one), and a differential test proving the signal actually reaches `estimatedMoviesThisYear`'s final blended output (identical "this year" data, with vs. without a qualifying prior year, asserting the two final estimates differ) rather than just checking `seasonalProjectedAdditional` in isolation.

## Box Office / Budget on MovieDetail (Jul 2026)

`MovieDetail.vue` now shows a "Box Office" section (Budget + Box Office/revenue, formatted as USD via `Intl.NumberFormat`) when either figure is known.

- **No new network call**: TMDB's `/movie/{id}` response (already fetched by `getTMDBData` for every rating/re-rate) already includes `budget`/`revenue` — `AddRating.js`'s `shapeTmdbDataIntoMovie` just wasn't extracting them into the stored movie object. Now does, alongside everything else it already pulls from that same response.
- **Graceful degradation for existing library entries**: only movies rated/re-rated after this change have `budget`/`revenue` stored locally (`MovieDetail.vue`'s `loadMovieData` is a pure local lookup, no live TMDB fetch — deliberately kept that way, consistent with this app's documented move away from per-view live TMDB calls, e.g. the Academy Awards migration). An older entry simply doesn't render the section at all, same convention every other optional section here already follows (Cast/Keywords/Production Companies/etc. are all `v-if`-guarded). `movieBudget`/`movieRevenue` computeds treat both `undefined` (never stored) and `0` (TMDB's own "not available" convention — it doesn't distinguish that from a genuinely free production) identically as "unknown."
- **Free side effect**: `Insights.vue`'s "taste profile" scoring (`calculateBlockbusterScale` and several sibling genre-personality heuristics) already read `movie.budget || 0` defensively — since `budget` was never actually stored before now, that factor was silently always contributing 0. It'll start reflecting real data for any movie rated after this change, no code change needed there.
- Placed right after Genres, before Awards — a "core facts about the film" section, grouped with Genre rather than the People/Company sections (Cast/Crew/Production Companies) that follow.

Tests: `TMDbDataProcessing.test.js`'s existing "should correctly transform TMDb data for storage" test extended with budget/revenue assertions. `MovieDetail.test.js` new "Box Office" describe block: both figures present, budget-only, revenue-only, both zero, and the field-entirely-absent (pre-existing library entry) case.

### Backfill button for the existing library (same day, immediate follow-up)
Direct feedback: "I needed to appear on all my movies... it should always work even on all the movies I've already rated." Graceful degradation was the right call for the initial ship (no live TMDB fetch on every MovieDetail view), but leaving hundreds of already-rated movies permanently without this data wasn't - a one-time catch-up was needed, not just "wait until you happen to re-rate it."

- **New pure module, `src/assets/javascript/backfillBoxOffice.js`** — same `warmImageCache`-style shape (`offlinePosterCache.js`) already established for the "Download all posters for offline" Settings button: worker-pool `concurrency` (default 4, a bit more conservative than image downloads since these are real TMDB API calls, not CDN image fetches), `onProgress({completed, total, failed})`, an `AbortSignal`, store-free/unit-testable without mounting anything.
  - `collectMoviesNeedingBoxOffice(movieLog)` — candidates are entries with a real (non-placeholder) `movie.id` and both `budget`/`revenue` falsy. **Known, accepted tradeoff**: TMDB's own `0` = "no data" convention means a movie TMDB genuinely has no financials for is indistinguishable from "never fetched," so it stays a candidate on every future run too - a deliberate simplicity choice over adding a separate "already checked" marker field, since this only costs a handful of wasted re-fetches for genuinely-data-less movies, not a functional bug.
  - `fetchBoxOffice(tmdbId)` — a single `/movie/{id}` call (no credits/keywords - this backfill doesn't need them).
  - `backfillBoxOffice(movieLog, writeFn, options)` — the orchestrator; persistence is injected via `writeFn(dbKey, boxOffice, entry)` rather than importing the store directly, keeping the module pure. **Idempotent and safe to re-run by construction**: candidates are computed fresh from current `movieLog` state, so a partial run (or one from days ago, after a batch of new ratings) just picks up wherever it left off — no separate resume/checkpoint logic needed.
- **`Home.vue` wiring** (`backfillBoxOfficeData()`, new `boxOfficeBackfill` state, mirrors `offlineDownload`'s exact shape/UI pattern) — the injected `writeFn`: reads the CURRENT `state.movieLog[dbKey]` fresh (not a captured closure) and commits an updated copy via the existing `setMovieLogEntry` mutation so the grid/detail page reflect it immediately without a reload, then durably persists via **two separate leaf-path writes** (`movieLog/<key>/movie/budget`, `movieLog/<key>/movie/revenue`) rather than one write to the whole `movie` object — a `set()` at the `movie` path would replace it wholesale, risking clobbering cast/crew/genres/etc. with a possibly-stale local snapshot. Uses `writeDatabaseEntryNow` (the direct, no-queue write action from the offline-rating work above) **without** the durable-queue-first treatment ratings get — this is re-fetchable TMDB metadata, not irreplaceable user data, and a failed write just leaves that movie as a candidate for the next run, which is an acceptable, self-healing failure mode here (unlike a lost rating).
- New Settings-panel button, "Fill in box office data for all movies," directly under the existing "Download all posters for offline" one, same progress-spinner/success-summary convention.

Tests: `src/test/backfillBoxOffice.test.js` (pure module - candidate selection incl. the 0/0-stays-a-candidate tradeoff and placeholder exclusion, fetch normalization, progress reporting, per-item fetch/write failure isolation, abort-signal support, concurrency capping). Caught a real off-by-a-typo bug while writing these: the initial candidate filter used `!movie.id` to exclude entries with no id, which also excludes `id: 0` - never happens with real TMDB ids (always ≥ 1) but was worth tightening to `movie.id == null` anyway once a test fixture happened to use `0` and exposed it. No dedicated Home.vue-mount test for the button wiring itself, matching the established precedent that `downloadForOffline`/`offlineDownload` (the analogous, older feature) also has no such test - only its pure module is directly tested.

## Phantom scroll on every page (Aug 2026)

Bug report: *"the content does not go below the bottom edge of the screen, but the page still can scroll down quite a bit. It seems like maybe we're forcing a height in here maybe that's because we wanted to get that footer bar to stay stuck to the bottom."* The diagnosis was exactly right.

**13 components each declared `min-height: 100vh`** on their own root — every game, plus MovieDetail, TrophyCase and YearInReview. `.cinema-roll` is a flex column that already has `min-height: 100vh`, so the page came out as `header + a FULL viewport + footer`, i.e. roughly a header's worth of empty space to scroll through on **every one of those pages**, always.

The rule meant to handle this, `.cinema-roll > router-view`, **never matched anything**: `<router-view>` renders the matched component *in its place*, so no `router-view` element exists in the DOM. It had been dead the whole time, which is why each page had grown its own `min-height` workaround.

Fixed by wrapping `<router-view>` in `<main class="app-main">` (`display: flex; flex: 1 1 auto; flex-direction: column`) with `.app-main > * { flex: 1 1 auto }`, and deleting `min-height: 100vh` from all 13 components. The page now stretches to fill whatever is left below the header — same "footer at the bottom" result, no phantom scroll:
- short content → total is exactly `100vh`, nothing to scroll
- long content → total is the natural height, scrolls only as far as it needs

Checked before shipping: the three surviving `height: 100%` rules in those components are all on images inside fixed-size parents (a timeline gap, the backdrop container, a poster box), so none relied on the page being a viewport tall; and every routed component is single-root, so `.app-main > *` can't split space between siblings.

## Deep Stats reworked, and the Standouts pantheon (Aug 2026)

Matt's review of the page: *"the first three cards are all repeats of things that are
already on the overview page… I like the idea of the crown, but it's taking up too much
vertical space… The Pantheon is interesting, but I have too many movies in each of these
categories for it to be really fascinating… I do like the idea of constellations… The
Marathon Club, I don't really know what these things mean… there's having eight top days
is too much… for each of the years, what is it actually telling me?… by genre, I like
that we have these genres, but I don't think I need the top twelve of them… we should
maybe just have each genre listed with a few examples and then a log score."*

The cuts, all of them vertical-space-driven: the top strip (titles / viewings / screen
time) deleted outright as an Overview repeat; the Crown turned from a vertical timeline
into a sideways poster row; the Pantheon's per-category lists dropped, keeping only
Constellations; Marathon Club's top days cut 8 → 3 and its caption rewritten to actually
say what it measures ("Not consecutive days; the biggest ones"); Years compressed into a
poster row; Genres cut to 8 with 5 examples each. The page went from ~9,100px to ~6,700px.

### Standouts: why ranking by Log Score was wrong

The new idea was Matt's: *"it'd be cool to find outliers around, like, things that have
unusually high log scores. Not just genres, but keywords and directors and all that
stuff… that would be an interesting pantheon to find."*

`standouts()` buckets the library by every facet at once — genre, keyword, studio,
director, composer, cinematographer, top-5 cast, decade — and ranks them against each
other. The first implementation ranked by Log Score, which read as the obvious choice and
was wrong. Against the real 1,374-film library it returned:

    Drama · Comedy · 1990s · hilarious · 2010s · Crime · based on novel or book · Pixar

That is a list of the biggest categories, i.e. a restatement of the library's shape. The
mechanism is Log Score's **rank weighting**: `rankWeight / (rankWeight + i)` means a
group is scored mostly by its best few films, and your biggest genre is also where all
your favourites live. So a huge, thoroughly average genre scores high for a reason that
has nothing to do with being a standout.

Ranking is now by **lift**: a Bayesian-adjusted mean minus the global average, using the
same prior Log Score uses (`bayesianWeight`, default 7). Shrinkage does the work Log
Score's rank weighting was mistakenly being asked to do — eight films at 9.5 survives it,
one film at 10 does not — without also rewarding size. Log Score still displays alongside,
because "how good is this corner outright" is a fair second question. The same library
then returns:

    Pixar · hilarious · Michael Giacchino · Joel Coen · Roger Deakins · Eddie Murphy

### The keyword flood

Ranked purely by lift, **16 of 24 slots came back as TMDB keywords** and no director,
actor or studio appeared at all — TMDB tags films with far more keywords than anything
else, so keywords simply have more chances to win. A `perType` cap (3 per facet type,
12 overall) restores the variety that was the whole point of ranging across facets.

Both failures are covered by tests that were checked against the broken code first
(`src/test/standouts.test.js`) — the log-score fixture is specifically shaped so the big
category wins on Log Score (7.99) and loses on lift (-0.06), because an earlier version of
that test passed under both rankings and guarded nothing.

## Year in Review rebuilt (Aug 2026)

Matt, having approved Trophy Case as-is: *"The year review looks nice, but I feel like we
could add a lot more information to it. Can you go in there and try and come up with a
bunch of clever things to throw in to make it look... keep it looking nice, but make it
way cooler?"*

The old page showed five things: two hero counts, a time total, a bar chart of films per
month, top actors and top directors. It also **computed eight more that were never
rendered** — `topGenres`, `bestRatedMovies`, `longestMovie`, `shortestMovie`,
`oldestMovie`, `busiestMonth`, `averageRating`, `mostCommonDecade` all existed as
computeds with nothing in the template referencing them.

The logic now lives in `src/assets/javascript/yearInReview.js` (pure, store-free,
`getAllRatingsFn` injected) with `src/test/yearInReviewStats.test.js` covering it
directly, per the house preference. Eleven sections: the shape of the year as a
contribution-graph heatmap, bookends, best-of-each-month, rhythm (streaks, droughts,
day-of-week), the extremes, what was different about the year, new releases vs
catalogue, discoveries vs revisits, the score distribution, faces, and directors.

### The unit is a viewing, not a film

The old page mixed the two: `moviesWatchedCount` counted entries while `moviesByMonth`
counted ratings, so a film watched twice made the monthly bars add up to more than the
headline above them. Everything now derives from one `allViewings()` pass — which also
matters for cost, because `getAllRatings` re-normalizes every rating it touches and the
page needs this year, last year and all-time.

### Three things that were quietly wrong

- **Comparing a year in progress against a complete one.** The first version had August
  2026 down 5 films, down 16 hours, down 0.19 average — every delta negative, purely
  because 2025 had twelve months in it and 2026 has eight. Trimming last year to the same
  point on the calendar (`throughDate`) turned that into **+30 films, +52h, +0.11**. The
  label says "so far" when the trim applies.
- **`percentOfYear` divided by 365 always**, so any current year read as a fraction of
  what it actually was. It now divides by the days elapsed.
- **The headshot fetch fired from `mounted()`**, which runs before the library arrives,
  so it asked TMDB for the top actors of an empty list and never retried. Every face on
  the page was a placeholder icon. Now driven by an immediate watcher on the names. This
  is the same trap as DrawFromHat's hat summaries — **`mounted()` is not "when the data
  is ready"** — and the test for it only became a real guard after the first version was
  written in a way that changed `selectedYear`, which masks the bug entirely.

### A macOS filesystem trap worth knowing

`src/test/YearInReview.test.js` already existed with 24 component tests. Writing to
`src/test/yearInReview.test.js` **silently overwrote it** — APFS is case-insensitive by
default, so the two paths are one file, and it keeps the original's casing. The full
suite still reported "144 files passed", because the file count didn't change; the tell
was the test count moving by less than the number added. `rm` on the lowercase name then
deleted the uppercase file too. Both were recovered with `git checkout`, the pure-module
tests went to `yearInReviewStats.test.js`, and `YearInReview.test.js` was rewritten
against the new component's surface.

## All-time calendar coverage, and the back-link that sat below the header (Aug 2026)

Two follow-ups to the Year in Review rebuild. Matt: *"the back button on year in review is
down below the header instead of up in the header like we did everywhere else"* and *"I
really like your shape of the year graph... Can we add one of that graph to somewhere in
our insights page where it shows all time days of the year? It'd be cool to see if there's
any specific dates that I have yet to watch a movie on."*

### `position: relative` on a routed root breaks BackLink

BackLink is `position: absolute; top: 6px` and depends on there being **no positioned
ancestor anywhere up the tree** — that's how it escapes to the page's initial containing
block and lands up over the global header, which is documented in its own source comment.
`.year-in-review { position: relative }` created exactly that ancestor and trapped the
link at the top of the component's own content instead. It was the only routed root in the
app doing this (the other four `position: relative` declarations are all on inner
elements), and the rule predated the rebuild.

### Why the Insights grid is a different shape

The Year in Review heatmap started as a contribution graph: 7 weekday rows by ~53 week
columns, which is right for one real year. Collapsing *every* year onto that grid would be
meaningless, because a given date's weekday moves from year to year. The all-time version
is therefore **12 month rows by day-of-month**, which is what "which dates have I never
watched on" actually asks.

**Both grids are that shape now.** Matt, seeing the Insights one: *"I like how you got the
whole calendar on the one screen without scrolling... let's do that also on the Year in
Review and imitate that shape"* (2026-08-17). The contribution graph was the conventional
layout and it was accurate, but it ran wider than the screen. `calendarGrid` was rewritten
to return month rows and its four tests replaced; the week-column code is gone rather than
left dead. `new Date(year, month + 1, 0).getDate()` gives each month its length, which
handles February in a leap year with no special case.

A single year adds one thing the all-time grid doesn't need: days that **haven't happened
yet** are marked `future` and render as absent rather than as empty squares. In August, an
empty November is not a fact about your viewing.

`calendarCoverage()` lives alongside `allViewings` in `yearInReview.js` — that module owns
the viewing-level model, so Insights imports from it rather than growing a second one.
Shorts are deliberately included here: the question is "did I watch *something* on this
date", and a short counts.

Details worth keeping:

- **Feb 29 is `rare`, not a gap.** It comes round every fourth year, so an empty one says
  far less than an empty March 3rd. It renders dimmed and is kept out of the "still to
  claim" list.
- **The gaps get the only outline.** A flat dark square reads as background rather than as
  a date, so unwatched cells carry an inset border; watched ones ramp through the
  Activity tab's `--accent`.
- **A 31-column CSS grid, not a flex row.** Flexed cells would make February's wider than
  January's and the columns — which are the dates — would stop lining up. The first
  attempt was a fixed-size flex row that came to 396px against a 393px viewport: a 3px
  overflow, which reads as a bug rather than as a scrollable graph.
- The panel is hidden entirely until something has been watched; 366 hollow squares is a
  bleak welcome.

Adding a second import from `GetRating.js` broke four existing `Insights.test.js` tests:
`vi.mock` with a partial factory **fails loudly** on a missing export rather than
returning undefined, so a module mock has to keep pace with what the component imports.

Against the real library: 203 of 366 dates covered across 7 years, 163 never claimed.

## MovieDetail: colour by section family (Aug 2026)

Matt: *"I'm pretty happy with the movie detail page... see if you can get it to match some
of our more recent styles, maybe a little more color, but I want all the information
that's on there. I like it... I wouldn't want to get too much bulk here. So take a pass,
but there's a good chance I'm gonna tell you to undo it."*

So: a restrained, **height-neutral** pass. Nothing removed, no new surfaces, no new
padding. The page went from 2,146px to 2,105px — slightly shorter than it started.

The page was flat black with grey labels and a Bootstrap-Reboot underline under every
name, which made the underline the loudest thing on it — a section listing fourteen
editors was fourteen underlines. Colour now carries the meaning instead.

### The first palette was arbitrary, and Matt said so

The first attempt invented a hue per family: blue for people, green for descriptors, gold
for awards, violet for production facts. *"I like that it's more colorful, but the colors
feel a little bit arbitrary."* Correct — and worse than arbitrary, because **blue already
means Ratings** in this app (Insights' tab accents are overview `#FFD700`, ratings
`#1D8BF1`, activity `#24d776`, people `#cd7fe8`), so using it for people actively
contradicted the existing vocabulary.

The palette is now the app's own, carrying the meanings it already carries:

| Family | Accent | Why |
|---|---|---|
| People — directors, cast, writers, composers, editors, cinematographers, producers | `#cd7fe8` | Insights' **People** tab, where Favorite Directors/Actors/Composers live |
| Ratings / Best since | `#1D8BF1` | Insights' **Ratings** tab |
| Awards | `#ffc107` | wins throughout — Trophy Case, the Deep Stats crown, personal awards |
| Genres, keywords, tags | `#6fd39b` | the vocabulary you search your own library by; the one house choice, kept in the family of Insights' Activity green |

**Production facts — box office, country, companies — get no accent at all.** They're
TMDB's facts about the film rather than anything in your library's vocabulary, and the
absence of colour is the signal. The links among them keep their default underline, so
they still read as tappable. Checking Home first confirmed there is no per-type chip
colour to inherit, so Insights' four accents plus the award gold are the whole vocabulary
available.

`h4`s became uppercase micro-labels in the section's accent, matching `.standout-facet`
on Deep Stats and `.coverage-month` on Insights (and slightly *smaller* than what they
replaced). `a.link` drops the underline and takes the accent, with `:active` for press
feedback. Count bubbles went 0.5rem → 0.62rem, still inside the 1rem line box.

Two things tried and pulled back inside the same pass:

- **A hairline border on `.long-list`.** It reads well around a scrolling Cast or
  Keywords list, but `.long-list` also wraps Box Office and Made In, which are one line
  each — bordered, they looked like text inputs. Reverted to the original inset shadow.
- **Awards all in gold** came out as a solid wall of it, which is exactly what Matt
  objected to on Insights ("we need to figure out how to break up the wall of yellow").
  Gold now means *won*; nominations drop to a muted amber `#b9a06a` (~8:1 on this
  background), so the colour distinguishes them rather than just saying "award".

**If this gets reverted**, it is one commit and touches only MovieDetail.vue's style
block plus this note.

## The Home prompts, and two rainbow-bar nudges (Aug 2026)

*"I really like the way that stickiness, tiebreaks and awards prompts all show up on the
home screen as prompts to make sure that I do stuff, sort of like fun homework. I haven't
really reworked the visuals of those since I first made them — maybe there's a chance now
to spruce them up, make them match the rest of the app a little bit more."*

They were the oldest surface left: flat `#4a4a4a` with a `#666` border, from before the
`#161616` / `#2e2e2e` panels and the accent vocabulary that Deep Stats, Insights, Year in
Review, Club Charts and MovieDetail now share. Four separate components each carried
their own copy of that grey.

`src/assets/scss/_prompt-card.scss` is now the one definition, imported the same way the
games import `_game-buttons.scss`. Each chore keeps its own accent, and — the lesson from
MovieDetail's first pass — every colour is taken from the app's existing vocabulary
rather than invented:

| Prompt | Accent | Why |
|---|---|---|
| Awards | gold `#ffc107` | wins everywhere in the app |
| Film Club request | purple `#cd7fe8` | Insights' People tab |
| Tiebreak | blue `#1D8BF1` | Insights' Ratings tab — a tiebreak is a rating decision |
| Stickiness | green `#24d776` | Insights' Activity tab — stickiness is how a film holds up over time |

The colour arrives as a badge behind the icon, **not** a left-edge accent bar ("I'm not
that into it", 2026-08-15). Copy was rewritten to say what the chore is rather than to
narrate the click: "1 movie you've had time to sit with" over "You have 1 movie that
needs stickiness updates. Click to add stickiness."

`TweakInline`'s tests clicked `.tweak-container` to open the prompt, which is now
`.prompt-card` — 15 selectors and one copy assertion moved with it.

**The expanded panels had to move too.** The first pass restyled only the collapsed
notices, which left the stickiness form, the tiebreak matchup and the tournament results
still on `#4a4a4a` — so the card changed colour the moment you tapped it. Their container
classes were *kept* rather than swapped for `.prompt-card`: a lot of form styling is
nested under them, and `.prompt-card`'s icon-plus-body flex row is the wrong layout for a
form. Only the surface rules changed. Bootstrap's `.rounded` utility then had to come off
those elements, because at 6px it was overriding the container's own 10px and leaving the
expanded panel a different shape from the collapsed prompt above it.

Every colour inside those panels is `#fff` or `#ccc`, so the darker surface only improved
contrast (white goes from ~14:1 to ~19:1).

### The rainbow bar

- **The binoculars had no font-size of its own** and so ran visibly smaller than the club
  beside it, which sets `1.32em`. Matched, which was the tidier of the two options Matt
  offered ("10% bigger or else maybe just match the club icon next to it").
- **The sort glyph and its up/down arrow had drifted apart.** `.order-arrow` was
  `position: absolute; right: 7px` — pinned to the chip's right edge while the glyph
  stayed centred, so giving the sort chip `flex-grow: 1.6` pulled them apart. Inline with
  a small negative margin, they travel together at any width.


## Notification tap "flashes to the loading screen" + decade row scroll (Sep 2026)

Two reports from Matt, 2026-09-02 and 2026-09-05.

**"Tap a notification on my phone and it opens up Cinema Roll. It always shows me Cinema Roll and then immediately flashes to the loading screen and then shows it again."** The reload itself is iOS's: a declarative web push payload carries a mandatory `navigate` URL, and tapping the notification navigates the Home Screen web app to it — a full document load, whether or not the app was already alive (and a killed app shows its launch snapshot first, which reads the same way). What was ours: the reloaded page sat on Home's spinner for the Firebase auth restore **plus** the IndexedDB snapshot read, back to back, because `initializeDB` awaited `authReady` before starting a read that never needed a token. Two changes: (1) `initializeDB` starts the movieLog snapshot read *before* awaiting auth (`startSnapshotRead` at module scope, cached per key so the router guard re-dispatching mid-wait can't fan out into duplicate multi-megabyte reads; the promise is still the one the delta-sync shadow check consumes, and it still predates this launch's re-persist). (2) Home's spinner waits `LOADING_SPINNER_DELAY_MS` (700ms) before rendering, so a warm launch goes header → library with nothing flashing between. Tests: `EarlySnapshotBoot.test.js` keeps `onAuthStateChanged` permanently silent and asserts the library still paints (the old code hangs there); `LoadingSpinnerDelay.test.js` drives the timer. Both verified by reverting the fix.

**"When I click a year here in the decade championships, it should take me back to the left edge of the scroll."** `DeepStats.vue`'s winners row is a horizontally scrolling `.ds-poster-row`; changing decade replaced its cards but kept `scrollLeft`. The `championship` watcher now resets every `.ds-poster-row` in the section to 0 on the next tick (the pill strip keeps its scroll — the tapped pill is there). Test in `DeepStatsDecades.test.js` stubs `scrollLeft` as a writable value, since jsdom has no layout.

## Highest grossing people (2026-09-16)

Matt, 2026-09-15: "It would be cool to be able to see box office returns by person, so
like we could have a list of highest grossing directors and highest grossing
performers, and I don't know, maybe even crew, and show those lists based on my
database." Built as the twin of the two-day-old years card rather than a new shape:
`boxOfficePeople.js` is `boxOfficeYears.js` grouped by name instead of year, with
the role list borrowed from Deep Stats' facet matching (jobs, not positions; top five
billing for performers so a crowd scene doesn't hand every extra a billion dollars).
Seven roles: directors, performers, producers, writers, composers, cinematographers,
editors. Writers are the one role where a person routinely holds two credits on one
film (Screenplay + Novel), so names are deduped per film before summing.

## Insights "takes forever to open" was a min/max per score (2026-09-23)

Report (Matt, from his phone): "Off-line support still doesn't seem like it's
working all that well... if I tap on the insights tab, it takes forever to open
it... maybe we're trying, we have a little bit of Internet, and we should give up
faster." Reproduced with Playwright against `dist/` signed in as the tester with
his 1,435-film library cloned in, 4x CPU throttle for phone speed: the tap took
2.7s with a fast network and 2.8s with a 4s-latency / 300 B/s one. Not the
network at all. The CPU profile put ~550ms (unthrottled) inside
`calculatePostStickyRatingFor`: every `getRating` call did
`Math.min(...allRatings)` / `Math.max(...allRatings)` over the whole library to
get the normalization range, and Insights' glance row alone calls it six times
per film. The module-level `allRatings` copy was also only refreshed when EMPTY,
so a new rating never widened the range until a reload.

Fix: `scoreRange()` memoizes min/max on the identity of the
`allMediaRatingsArray` getter's result (a cached Vuex getter, same array until
movieLog changes). First build threw 1,436 `reading 'length'` errors on sign-in:
that getter itself went through `getRating`, which now read the getter back
mid-computation, and a re-entered Vue computed returns undefined. The getter
(and `sortByRating`) now use `rawScore()`, the raw weighted total with no
normalization, which is all they ever needed. After: 0.5s at the same throttle,
zero page errors. The `GetRating.test.js` store mock had pointed at a path that
resolved to nothing (`../../store/index` from `src/test/`) since it was written,
so its tests had been running against the real store; fixed with `vi.hoisted`.
Tooling worth keeping: the lie-fi + CPU-throttle timing script lived in the
session scratchpad, pattern = `Network.emulateNetworkConditions` +
`Emulation.setCPUThrottlingRate` over CDP, `Profiler.start/stop` for the flame.

## Speed sweep: "make every interaction really snappy" (2026-09-23)

Matt: "lots of small things add up... every button push, every screen load,
every scroll, all of it just feel really snappy and tight." Tooling:
`scripts/perf-tour.mjs` (Playwright, 4x CPU throttle ≈ his iPhone, tester
signed in with his 1,435-film library, long-task accounting per action) and
CDP `Profiler` runs per hot spot. Before/after at phone speed:

| Action | Before | After |
|---|---|---|
| Insights → Places tab | 3.5s | 0.24s cold, ~30ms once warmed |
| Return to Home (any screen) | 0.9-1.6s | 0.2-0.35s |
| Trophy Case open | 1.4s busy | 0.46s |
| Insights → Ratings tab | 1.4s busy | 0.7s |
| Search keystroke | ~1.0s busy | 0.3-0.7s |
| Relaunch: second full rebuild ~2s in | 0.8s stall | gone |

What each was:

- **Places tab.** The world polygon data was plain component data, so Vue
  made 15,000 vertices reactive and every ring read in `countryForPoint` was
  a Proxy trap. `markRaw` fixed most of it; resolved points are now cached
  for the life of the page (`countryLookup.js`), the coverage table is
  memoized, and Insights warms the lookup in idle slices from mount
  (`warmCountryLookup`) so the tab is instant by the time it is tapped.
- **Return to Home.** Every library-derived table (flattened keywords, search
  fields, scores, entity counts, director filmographies) lived in component
  computeds and died with the component. `src/utils/memoByIdentity.js`
  caches them at module scope keyed on the cached Vuex getter's identity;
  `entityCounts.js` exports are wrapped, Home/Insights/Film Club/Watchlist/
  Club Charts/Trophy Case use it. Two traps found on the way: the Home memo
  first keyed on `settings.normalizationAnchors` by identity, and every
  settings write (a game's play counter) lands a fresh settings object, so
  a Wordle visit cost a full rebuild - key nested settings by VALUE (JSON).
  And the awards object is edited in place by the modal, so the Trophy
  Case memo keys on its JSON too. `allMediaSortedByRating` sorted
  `allMediaAsArray` IN PLACE (reordering another getter's cached array for
  everyone) and re-scored both sides of every comparison; now a decorated
  copy, plus an `overallRankByDbKey` Map so cards stop running `findIndex`
  over the library. `allDirectors` did a `find` over the library per
  director in both Home and Insights - one indexing pass now.
- **Keystrokes.** `sortResultsFast` re-scored all 1,400 entries per
  keystroke - scores ride on the memoized entries (`_rating`). The grid's
  `smallFormattedDate` built a new `Intl.DateTimeFormat` per call, twice per
  card per render - shared formatters now. What remains is DOM work for
  ~120 cards, not app code.
- **Relaunch.** The settings snapshot was read only after the auth restore,
  so Home painted without the rating-curve anchors and rebuilt every score
  when they arrived; it now rides along with the library snapshot and lands
  first. Then the live listener re-committed an identical library ~2s in
  (`startAt(lastSync)` is inclusive, so the delta always contains the
  newest entry) and everything derived from it rebuilt again; both the
  delta and full listeners now keep the snapshot's identity when nothing
  actually changed (same keys, same updatedAt, nothing in flight).
- **Trophy Case.** `expandNomineeFromMinimal` did a linear `find` per
  nominee; `collectAwardEntries` builds one id index.

Not done: Watchlist (0.8s), Deep Stats (1.0s) and Club Charts (0.9s) first
opens are mostly rendering, and Club Charts' `buildOverlaps` join is real
work on first open (memoized after). Scrolling was already 60fps.

Rules that came out of it, in CLAUDE.md: anything derived from the whole
library goes through `memoByIdentity`; never sort a getter's array in place;
never key an identity memo on an object that is mutated in place; big static
data (maps, catalogs) gets `markRaw`.

## Feel of response: acknowledging every tap (2026-09-23)

After the speed sweep Matt asked for the other half: "even if the thing
isn't doing something right away, the app clearly registered my
interaction." Fifteen items, all shipped, all deliberately quiet:

- **A one-frame yield before heavy work.** `src/utils/nextFrame.js`
  (`nextFrame`, `afterFrame`, `SKELETON_FIRST`). Vue batches a tap's
  acknowledgment and the render it triggers into one paint, so nothing
  showed until the expensive part was done. The router guard now flags
  `routePending` and yields a frame before resolving a route; Insights'
  `renderedTab` trails `activeTab` by a frame (with a skeleton and, for
  Places, "Mapping your films…" in that frame); Home's More… button spins
  for the frame its 48 cards take. Under Vitest the yield is immediate and
  skeletons are off, since component tests read content straight after mount.
- **RouteProgress.vue:** a 2px bar under the header, visible only after 90ms
  so instant screens never show it. **App.vue:** enter-only 140ms fade on
  the router view; global `.tap-feedback` (2% press + dim while the finger
  is down) on the grid card, back link, header home link, tiebreak posters,
  quick-filter badges, Insights tabs and people chips; posters ease from the
  placeholder instead of cutting.
- **SkeletonBlock.vue** for one frame on Watchlist, Film Club, Deep Stats
  and Club Charts (`painted` flips in mounted via afterFrame).
- **SavedFlash.vue + the `flashSaved` mutation:** "Poster saved", "Backdrop
  saved", "Viewing removed", "Stickiness saved". MovieDetail's poster and
  backdrop picks apply locally FIRST and write after, instead of the
  reverse.
- Home: a small spinner inside the search input and a dimmed list while a
  keystroke is still being applied (`searchPending`); Sign out disables
  and spins. RateMovie: the form dims and locks while "Submitting…" (also
  no longer "Submiting"). NewRatingSearch's spinner says "Checking TMDB…"
  and, after 4s, "Still trying…".

Verified with `scripts/perf-tour.mjs` (no timing regression beyond the
~16ms frame yield) and phone-width screenshots of each state.

