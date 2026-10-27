# Awards — development history

> Archived from CLAUDE.md. Verbatim post-mortem narrative, kept for the hard-won
> detail. Durable rules extracted from this live in `.claude/rules/`.

## Recent Changes - Awards Modal Stability Fixes (Aug 2024)

### Fixed Awards Modal Auto-Close Issue
- **Problem**: Awards modal would unexpectedly disappear when users completed categories, preventing them from continuing work
- **Root Cause #1**: `autoSave()` function automatically set completion date when all categories were filled, causing modal to be hidden by daily limit logic
- **Root Cause #2**: `showAwardsModal` computed property treated any year with awards data as "complete", ignoring partial progress
- **Root Cause #3**: `firstEligibleYear` computed property (banner display) had similar flawed logic, causing missing year in banner
- **Solution**: 
  1. Removed auto-completion behavior from `autoSave()` - users now must explicitly click "Complete Awards" button
  2. Fixed eligibility logic to keep showing modal for years with partial progress (not explicitly completed)
  3. Fixed banner year display logic to include years with partial progress

### Added Awards Resume Functionality
- **New Feature**: "Resume Awards" section in Insights page (`src/components/Insights.vue`)
- **Functionality**: Shows partially completed award years with progress bars and "Resume" buttons
- **Detection Logic**: Identifies years with partial progress (some nominees/winners but not explicitly completed)
- **Resume Method**: Sets daily awards year selection and navigates to Home to trigger modal
- **New Movies Detection**: Highlights years with new movies added since last awards session

### Key Files Modified
- `src/components/PersonalAwardsModal.vue:927-963` - Removed auto-completion from autoSave()
- `src/components/Home.vue:1796-1801` - **CRITICAL FIX**: Added partial progress check to showAwardsModal eligibility logic
- `src/components/PersonalAwardsModal.vue:376-381` - **CRITICAL FIX**: Added partial progress check to firstEligibleYear banner logic
- `src/components/Insights.vue:277-314` - Added Resume Awards section in template
- `src/components/Insights.vue:431-487` - Added partialAwardsYears computed property
- `src/components/Insights.vue:1169-1183` - Added resumeAwards() method

### Technical Details
- Awards modal no longer auto-closes when categories are completed
- Completion date only set when user explicitly clicks "Complete Awards" button
- Resume logic bypasses daily limit by setting `dailyAwardsYear` to specific year
- Progress calculation excludes explicitly completed years (via button) but includes partial work
- All existing functionality preserved, just made less fragile

This fixes the fragility issue where the modal would disappear unexpectedly and provides a reliable way to resume work on partial awards.

### Best Director saved nominees not highlighted on reopen (fixed Jun 2026)
**Symptom**: a year's Best Director nominees/winner persisted, but on reopening the modal they showed in the top "Current Nominees" gallery yet were NOT highlighted as selected in the "Available Options" grid below (acting categories had a milder, intermittent version). **Root cause**: the grid highlights via `isNominee`/`isWinner`, which compare identities through `getOptionId()`; the top gallery just renders stored nominees directly (so it always shows them — hence the split symptom). `getOptionId` classified an option as movie-vs-person **by shape**: a freshly-computed Best Director option is a movie-group `{ movieId, movie, allCast:[{id:'directors-X',…}] }` with **no top-level `id`** → `movie-X`, but a nominee restored via `convertNomineeToMinimal`→`expandNomineeFromMinimal` has the director id **promoted to top-level** `id:'directors-X'` → `person-directors-X-X`. The two never matched, so saved Directors didn't light up (and couldn't be un-nominated) after a save+reload — in-session worked because both sides were the same movie-group object. **Fix**: `getOptionId` now special-cases `selectedCategory === 'bestDirector'` to always return `movie-<movieId>` regardless of object shape.

**Acting categories had a SEPARATE, milder cause (also fixed Jun 2026)**: identity round-trips fine there (`person.id` is preserved), but the grid only loads 3 cast/movie initially, so a nominee deeper in the cast had no tile to light up until "Load more cast". Fix: `extractAndGroupPeopleByMovie` now, after the initial 3-per-movie load, **always appends any already-nominated cast member** to that movie's `loadedCast` (matched by `id`+`movieId`; included regardless of the gender heuristic since the user explicitly chose them — only TMDb details are fetched for the profile image). `loadMoreForMovie` gained a dedupe guard so a surfaced-early nominee isn't re-added (duplicate tile/`:key`) when the user later clicks "Load more cast". Only runs on a cache miss (`optionsCache` is cleared each modal open, and `awardsData` is already populated by `initializeAwardsData` at that point, so nominees are known when the grid is built).

Tests: `src/test/AwardsNomineeIdentity.test.js` — Director round-trip (mounts the modal, exercises the real convert/expand round-trip; fails on the old code) + deep-acting-nominee surfacing (6-person cast, nominee at index 4 surfaces exactly once; no extra tiles when there are no nominees).

### Debug Logging Cleanup (Aug 2024)
- All debug logging (`🏆 AWARDS DEBUG:` messages) has been removed after successful problem resolution
- Core functionality preserved, console noise eliminated
- System now operates cleanly in production

### Awards UI Enhancement - Actor Display (Aug 2024)
- **Improvement**: Split actor nomination display from 2 lines to 3 lines for better readability
- **Before**: Name on line 1, "Movie (Role)" on line 2
- **After**: Name on line 1, Movie on line 2, Role on line 3 (italicized)
- **Files Modified**: `src/components/PersonalAwardsModal.vue` - template, methods, and CSS
- **New Methods**: `getOptionMovie()` and `getOptionRole()` for cleaner data separation
- **Styling**: Role text is smaller, italicized, and slightly more transparent for visual hierarchy

## Personal Awards + Other Ceremonies on Movie Pages (Jul 2026)

MovieDetail's "Awards" section previously showed Academy Award wins/nominations only (from `film-awards-api`, per-movie via `/awards/tmdb/{id}`). It now has three subsections: **My Awards**, **Academy Awards**, **Other Ceremonies**.

- **`src/assets/javascript/personalAwardsCategories.js`** — `PERSONAL_AWARD_CATEGORIES` (key/name/type) extracted out of `PersonalAwardsModal.vue`'s `categories` computed (which now just maps over the shared list) so MovieDetail can look up category display names without duplicating — and risking drifting from — that list.
- **"My Awards" (`MovieDetail.personalAwardsByResult`)** — scans `settings.personalAwards` (keyed by year; see PersonalAwardsModal's existing `{ categories: { <key>: { nominees, winner } } }` shape, nominees/winner are "minimal" objects carrying `movieId`, a TMDB id) across **every** year, not just the movie's release year — a personal-awards year can legitimately honor films released in more than one calendar year. A category counts as a win if `winner.movieId` matches; otherwise a nomination if any entry in `nominees` matches. Person-shaped categories (Director/acting) surface the nominee's `name`. **Tapping an entry reopens that year's `PersonalAwardsModal`** — same trick as `Insights.resumeAwards()` (set `dailyAwardsYear`/`dailyAwardsYearDate`/`awardsPromptState:'forced'`, navigate home), now duplicated as `MovieDetail.openPersonalAwardsYear()` since the two components don't share a base.
- **"Other Ceremonies"** (Golden Globes Drama/Musical-Comedy/Director, BAFTA Best Film, Cannes Palme d'Or, Venice Golden Lion) — **`src/assets/data/otherAwardsWinners.json`** (~1,490 entries, minified) + **`src/assets/javascript/otherAwards.js`** → `findOtherAwardsForMovie(movie)`.
  - **Data provenance**: scraped from the *raw wikitext* of each ceremony's Wikipedia "winners and nominees" list page (via `action=query&prop=revisions`, NOT the rendered HTML and NOT an LLM summary of the page — an earlier attempt using a web-fetch-and-summarize tool silently mis-attributed rows across adjacent tables, e.g. inventing a "Tintin" Best Picture win and misreading the current year's Best Actor winner as that year's Best Picture winner; the raw-wikitext-parsed data was cross-checked against the summarized version for the years they overlapped and matches). Parsed with a small regex-based wikitable parser (bold + colored-background cell = winner; not committed to the repo, it was a one-off scratch script) that unwraps `[[wikilink|display]]`, `{{sort|key|display}}`, and `<ref>` noise. ~1% of rows are known-noisy (a handful of BAFTA/Cannes rows picked up a crew member's name instead of a film title from a malformed table row) — harmless for matching since a person's name essentially never collides with a real movie title.
  - **No TMDB id in the source** (it's Wikipedia, not TMDB) — matching is by **normalized title** (lowercased, accent-stripped, non-alphanumeric collapsed) **+ release year within ±1** of the TMDB `release_date` year, to absorb the real-world slop between a ceremony's own "film year" labeling and TMDB's release date (international rollouts, year-of-eligibility conventions differing by ceremony). Index is a `Map` built once at module load, not per movie-page-visit.
  - **Scope, deliberately limited**: winners *and* nominees for the 3 Golden Globe categories and BAFTA Best Film; **winners only** for Cannes/Venice (those Wikipedia pages don't tabulate nominees the same way — Cannes/Venice don't publicly "nominate" for their top prize the way the Golden Globes/BAFTA do). Berlin Golden Bear was attempted and **dropped** — its wikitext table had column-shifted rows for some tied years that put a director's name where the film title should be, and the noise rate was too high to trust. Revisit if someone wants to invest in fixing that page's parsing.

Tests: `src/test/otherAwards.test.js` (matching, accent/case-insensitivity, year tolerance, no-match cases), `src/test/MovieDetailAwards.test.js` (personal-awards win/nomination classification, `openPersonalAwardsYear`, other-ceremony wiring).

**Tried and reverted (Jul 2026): a small trophy-icon badge on grid posters** for any movie with a win (personal/Best Picture/other-ceremony), backed by two Vuex getters (`moviesWithPersonalAwardWins`, `bestPictureWinnerIds`) for cheap no-network lookups. Removed after real-world use — across a ~400-movie library there were enough winners that the badges cluttered the grid rather than reading as a meaningful signal. If revisiting, consider a rarer/higher bar (e.g. personal Best Picture only, not every category/ceremony) rather than "won anything, anywhere."

### In-app bug report fixes for Awards/Rating Shape on MovieDetail (Jul 2026)
Four bug reports filed via the in-app button after the above features shipped, all fixed together since three overlapped:

- **"My Awards" → "The {{ personalAwardSectionTitle }}"**: previously hardcoded, ignoring the user-configurable `settings.personalAwardName` (Home.vue's settings panel, default 'Oscar'). The grammar helpers (`getAwardNameWithThe`/`getAwardNameWithoutThe`/`getAwardNameSingular`) that used to live only as Home.vue methods were extracted to pure functions in **`src/assets/javascript/personalAwards.js`** (`awardNameWithThe`/`awardNameWithoutThe`/`awardNameSingular`); Home.vue's methods now just delegate to them (zero behavior change there), and MovieDetail's `personalAwardSectionTitle` computed calls `awardNameWithThe` directly off `$store.state.settings.personalAwardName` (no dependency on Home.vue), e.g. "The Oscar" / "The Groskers".
- **Personal award entries no longer show a leading year** ("2023 · Best Picture" → "Best Picture") — the movie's own release year already establishes when it was in contention, so repeating it on every line was redundant. `award.year` is still carried on the data object (used by `openPersonalAwardsYear`), just not rendered.
- **Award links now resolve to the specific ceremony year, not a generic ceremony page**: `goToWikipedia(query)` was building a raw `/wiki/<title>` URL, which 404s (or lands on the wrong page) for anything but an exact title match. Now routes through Wikipedia's **`Special:Search?search=<q>&go=Go`** endpoint — jumps straight to an exact-title match same as before, but falls back to a full-text search results list instead of a dead page when the guessed title isn't exact. Paired with `otherAwards.js`'s new `buildWikipediaQuery(ceremony, year)`: Golden Globes get a computed ordinal title (`"81st Golden Globe Awards"` — reliable since the ceremony has run every year since 1943 with no gaps, formula `year - 1942`); BAFTA/Cannes/Venice (which all have historical irregularities — wartime pauses, combined-year ceremonies — that break a simple ordinal formula) get a `"<year> <ceremony>"` query instead, good enough for the search-with-fallback to land somewhere useful. Academy Award links already carried a year-specific `ceremony` string from `film-awards-api` (e.g. "67th Academy Awards") and needed no data change, just the same more-forgiving search-based navigation.
- **Rating Shape (the radar chart) was tried and removed** — after seeing it live, it didn't look good and was pulled entirely (imports, `Chart.register`, `ratingRadarData`/`ratingRadarOptions` computeds, template, CSS all removed from MovieDetail.vue). The underlying pure module (`src/assets/javascript/ratingRadar.js`, `normalizedRadarValues`/`RADAR_LABELS`) and its test were left in place, unused, in case the idea gets revisited in a different form later — it's small and self-contained. `Chart.js`/`vue-chart-3` are still used elsewhere (Insights.vue), so no dependency was dropped.
- **Awards section**: an initial collapse-behind-a-toggle-with-count-badge design was tried, but the follow-up ask was to **match the rest of the page's sections instead** — a plain always-visible `<h4>Awards</h4>` header, same as Cast/Keywords/Directors, with the awards content scrolling internally if it overflows (`.awards-body { max-height: 150px; overflow-y: auto; ...}`, the same scroll-box treatment as `.long-list` used by Cast/Genres/Directors) rather than collapsing/expanding.

Tests: `src/test/otherAwards.test.js` (wikipediaQuery ordinal/year-query cases), `src/test/personalAwards.test.js` (award name grammar helpers), `src/test/MovieDetailAwards.test.js` (`personalAwardSectionTitle`, `goToWikipedia` URL shape, awards body always rendered + no year prefix).

## Round-Robin Tiebreak Tournaments (Jul 2026)

The tiebreak feature (`TweakInline.vue`, triggered from `Home.vue`) used to resolve only ONE adjacent pair of exactly-equal `calculatedTotal` movies at a time — pick a winner, the loser gets a flat `tweakValue -= 0.1`, done. A 4+ way tie got chipped away one random adjacent pair per day with no sense of a settled order. Replaced with a proper round-robin tournament, inspired directly by (but architecturally separate from) the Rate-Off game's bracket — Rate-Off itself (`games/bracket.js`/`RateOffGame.vue`) was later removed (see the Games Section above), but this module never imported it, so its removal changed nothing here.

- **New pure module: `src/assets/javascript/tieBreakTournament.js`** (store-free, same pattern the now-removed `games/bracket.js` used) — `findTiedGroup(sortedEntries, getScore)` expands outward from the first adjacent tie to the full **contiguous run** of equal-scored entries (ties are always contiguous in a sorted list); `createRoundRobinTournament(contestantIds, rng)` builds every unique pair (N choose 2); `currentMatch`/`recordMatchResult`/`isComplete` are an immutable state machine identical in spirit to a pick-a-winner bracket; `rankContestants` sorts by win count descending (falls back to original order for a tie-of-ties, e.g. a 3-cycle where everyone goes 1-1 — not worth resolving further); `tweakDeltaForRank(rank)` generalizes the old flat `-0.1` to `-0.1 * rank` (rank 0 = untouched, matching "winner never penalized").
  - **Match order (Jul 2026, bug report — "matchups came through in random order instead of doing all of one movie's matchups followed by the next")**: `buildSchedule`'s natural order is every one of contestant 0's matches, then contestant 1's remaining ones, etc — originally left unshuffled on purpose ("match order isn't a meaningful design decision... deterministic keeps this testable"). `createRoundRobinTournament`'s new optional 2nd arg `rng` (default `null`) shuffles the built schedule (local Fisher-Yates, not imported from `games/gameUtils.js` — keeps this module self-contained) when supplied; omitting it keeps the old stable order, which is why none of this file's own schedule-order-asserting tests needed to change. `TweakInline.vue`'s real call site passes `Math.random`.
- **Persisted across sessions.** The tournament state lives at `settings/tieBreakTournament` in Firebase. `Home.vue`'s `shouldShowTieBreakModal` checks "does a tournament record exist" (regardless of complete/incomplete — see below) vs. the daily quota (`settings.tieBreakTweak`/`lastTweak`); it does NOT own creating or advancing the tournament — `TweakInline.vue` owns that via `ensureTournamentStarted`.
- **Default is now "do the whole tournament in one sitting," with an explicit pause button (Jul 2026, follow-up feedback: "I now find that I wanna do a few in a row, especially when there's a bigger tournament").** The ORIGINAL design (see the now-superseded paragraph this replaces, in earlier history) re-stamped `settings/lastTweak` after **every single match**, which made `shouldShowTieBreakModal`'s daily-quota check go false immediately — so in practice a multi-match tournament could only ever advance one match per quota window (default: once/day), spread across however many days it took, whether the user wanted that pacing or not. `chooseWinner` no longer stamps `lastTweak` for a match that leaves the tournament still in progress — it only resets the clock at an actual stopping point: (a) `acknowledgeResults` (the "Done" tap after a 3+-contestant tournament's results screen), (b) the 2-way fast path's "nothing left to chain into" branch, or (c) the new **`saveForLater()`** method, wired to a "Save for later" button (`.save-for-later-btn`) shown only when `canSaveForLater` (`progress(tournament).total > 1` — same "not really a tournament" cutoff `progressLabel` already uses, so a plain 2-way pick never shows a pause button with nothing meaningful to pause). `saveForLater` stamps `lastTweak` and collapses the panel (`closeTweakInline`) WITHOUT touching the tournament record itself — progress is already persisted after every pick, so reopening (once the quota allows, or immediately with "force tiebreak to show") resumes exactly where it left off, same mechanism a natural browser close/reopen already relied on.
- **Trigger is state-driven (`needsNewTournament` computed), not change-driven (fixed Jul 2026 bug).** Originally `ensureTournamentStarted` fired from a watcher on the `showTweakModal` *prop changing*. That broke with the settings-panel "force tiebreak to show" testing toggle: forcing pins `showTweakModal` true permanently (bypassing the quota), so it only ever changes value once (mount) and never again — after finishing one tournament and clearing it, a second tied group would show its "you have a tie" notice but tapping it rendered a crash-to-blank panel, because no tournament had been (re-)created for it (nothing was watching for that anymore). Fixed by watching a `needsNewTournament` computed (`showTweakModal && !currentTournament && tiedGroupDbKeys.length >= 2`) instead, which re-fires whenever `currentTournament` drops back to null with something left to start, regardless of whether `showTweakModal` itself ever changes; `acknowledgeResults` also calls `ensureTournamentStarted()` directly rather than waiting on the watcher's next tick. The "current match" template branch additionally requires `firstResult && secondResult` (not just presence of a tournament) so a momentary null pair can never throw instead of just quietly not rendering.
- **Results-screen contrast fix (Jul 2026)**: the win-count text used Bootstrap's `.text-muted` (~#6c757d), which fails contrast against the `.tweak-container`'s `#4a4a4a` background (~2.3:1). Replaced with a custom `.result-wins` class using the same `#ccc` already used for the rank number (~6:1).
- **Frozen membership = the freeze-out rule, for free.** `contestantIds` is snapshotted once at tournament creation and never recomputed from a fresh scan. Since `findTiedGroup` (a fresh scan) is only ever consulted when there's **no** active tournament record, a movie rated mid-tournament that happens to now match the tied score simply can't be pulled in — it just waits for the next scan, which only runs after the current tournament resolves and its record is cleared. No explicit "exclude new arrivals" logic needed; it falls out of *when* detection runs.
- **`localTournament` optimistic cache** (`TweakInline.vue` data): Firebase's realtime listener updating `$store.state.settings.tieBreakTournament` isn't synchronous with a dispatch, so the component keeps its own just-written copy and prefers it over the store's value — without this the UI could flash a stale state between a pick and the listener catching up. A fresh mount (new session) has no local copy, so it reads straight from the persisted store value — that's what makes a tournament survive across page loads/days.
- **Results screen is new** (the old flow silently applied the -0.1 and closed): once the last scheduled match is recorded, `finalRanking` is attached to the tournament and `TweakInline` shows a "Tournament Complete!" standings list (poster + win count per rank) before applying anything. Score adjustments for **all** contestants are applied in **one batch** at this point (not incrementally per match, per the user's explicit design: "winners and losers get tracked in the round robin instead of having their scores modified right away"). Tapping "Done" clears `settings/tieBreakTournament` (dispatches `value: null`, same clear-a-path convention as `PersonalAwardsModal.vue`/`Insights.vue`), which is what lets the next scan start fresh.
- **A 2-contestant tie is now fully invisible-overhead, not just "unchanged in effect" (Jul 2026, bug report)**: round-robin on 2 entries is exactly 1 match, so score-wise it always behaved like the old pairwise flow — but the UI still showed tournament "trappings" (a `progressLabel` reading "2 contestants · match 1 of 1", and the "Tournament Complete!" standings screen requiring a "Done" tap) that made a 2-way tie feel like more ceremony than a simple pick. Per feedback ("that's not really a tournament... it should just go ahead and make the change and move onto the next one"): `progressLabel` now returns `''` whenever `progress(tournament).total <= 1`. `chooseWinner`, after applying the completed tournament's results, checks `updatedTournament.contestantIds.length <= 2` and — only for that case — skips the results screen entirely. `ensureTournamentStarted` now returns a boolean (was `void`) so callers can tell whether it actually started something. **3+-contestant tournaments still show progress and the standings/Done screen** — that ceremony is appropriate for a real multi-match tournament — but per the "one sitting by default" change above, matches within it no longer force a stop between each pick; only "Done" (after completion) or "Save for later" (mid-tournament) actually pause things.
- **2-way completion no longer auto-chains into a DIFFERENT tied group's tournament (Jul 2026, bug report superseding the paragraph above — "I was presented with a new tiebreaker... after doing the first round it didn't actually close... if it's just an individual matchup, that should count as my tiebreak for this time").** The 2-contestant fast path originally called `ensureTournamentStarted()` right after clearing itself, so if another tied group existed elsewhere in the library its first match appeared immediately in the same open panel — no visual break, which read as "it never closes," and because the fast path only stamped `lastTweak` when NOTHING was left to chain into, the daily-quota clock never got a chance to reset either. `chooseWinner`'s 2-way branch now unconditionally does `clearCompletedTournament()` + `closeTweakInline()` + stamps `settings/lastTweak`, exactly like a 3+-contestant tournament's "Done" tap already does — regardless of whether another tied group exists. The next scan (whenever the quota next allows) picks up any other tied group fresh at that later point. Matches *within* one already-started tournament (a 3+-contestant one, or the fast path when it's the only tie) are unaffected — this only stops chaining into a **new, unrelated** tournament.
- **Tap feedback: stuck-`:hover` scale/border replaced with a deliberate checkmark badge (Jul 2026, bug report — "the poster... gets a little larger... I do want an indication that I have clicked on one... a little checkmark").** `.poster-container:hover`/`.poster-wrapper:hover` (scale-up + border-brighten) were the same "stuck :hover on iOS, no real mouse to trigger `mouseleave`" pattern documented elsewhere in this file — the tapped poster visibly stayed "grown" after selection, reading as an unwanted glitch rather than feedback. Removed both `:hover` rules (the `:active` press-state pair was already there and is unaffected). New `selectedDbKey` data field is set to the winner's `dbKey` synchronously at the start of `chooseWinner`, drives a `.selected-checkmark` badge (green circle, `bi-check-lg`) absolutely positioned on whichever `.poster-wrapper` matches it, and is cleared back to `null` once the winner has been fully processed (end of `chooseWinner`, after the awaited save).
- **Poster prefetching for the WHOLE tournament, not just the current match (Jul 2026, bug report — "swaps out one of the posters, but not the other one... some way we can pre-cache the next setup").** The next match's two posters hadn't been fetched before, so they visibly popped in one at a time as each image's network/decode finished — not a Vue bug, just cold-cache image latency. Since a round-robin tournament's full contestant list is known upfront at creation, `prefetchTournamentPosters(tournament)` (new method) kicks off a `new Image(); img.src = ...` fetch for **every** contestant's w500 poster as soon as the tournament exists — called from `ensureTournamentStarted()` right after creating one, and again from a new `created()` hook for the case where the component mounts onto an **already-persisted** tournament (e.g. resuming after a page reload), which never went through `ensureTournamentStarted` for that same tournament. By the time any given match is actually shown, its posters are already warm in the browser's HTTP cache.
- **Spacing tightened up around the title and "Save for later" button (Jul 2026, bug reports).** With a 2-way tie, `progressLabel` renders nothing (see above), which left the posters looking "pulled too tight" right under the "Break the Tie" header — the title wrapper's `mb-2` became `mb-3` so the gap is consistent whether or not the subtitle line is present. Separately, "Save for later" felt cramped against the posters above it — its wrapper's `mt-2` became `mt-3`.

Tests: `src/test/tieBreakTournament.test.js` (pure module — group detection incl. tie-of-ties, schedule shape, immutability, full 4-way resolution, unshuffled-by-default vs. shuffled-with-rng match order + rng determinism), `src/test/TweakInline.test.js` (mount-based — auto-start on first tie, progress label, 2-way and 4-way full playthroughs, one-batch score application, freeze-out of a newly-tied movie against an already-running tournament, acknowledge-clears-state, `lastTweak` NOT stamped between matches / IS stamped at Done and at "Save for later", "Save for later" hidden for a 2-way tie, a 2-way completion always closes+stamps `lastTweak` even when another tied group exists, `selectedDbKey`/checkmark-badge set+clear+render, poster prefetching on tournament creation AND on mount into an already-persisted tournament).

- **A large tournament's final match "seemed frozen for 5-6 seconds" (Jul 2026, bug report) — a real perf bug, not just missing UI feedback.** `allMoviesRanked` used to be `[...allMoviesAsArray].sort(this.sortByRating)`, a naive comparator calling the moderately-expensive `getRating()` up to twice PER COMPARISON over the *entire* library (~1300 movies) — and `applyTournamentResults` fires one Firebase write per adjusted contestant, each of which can re-trigger this computed as `movieLog` updates land back, compounding the cost. Switched to `sortResultsFast` (`searchFiltering.js` — the same decorate-sort-undecorate fix already applied to `Home.vue`'s search/sort path, see "Search Recompute Performance" below) with `{ sortValue: 'rating', sortOrder: 'bestOrNewestOnTop', getRating }`, which computes `getRating()` once per item with identical resulting order. The now-unused naive `sortByRating` method was removed.
- **The spinner also never actually tracked the real save time, on top of that.** `chooseWinner` set `submitting = true` then back to `false` synchronously around `applyTournamentResults`'s Firebase dispatches, which were fire-and-forget (never awaited) — so `submitting` never reflected real elapsed time regardless of the sort-perf fix, and worse, the "Tournament Complete!" results screen (which is what actually shows after a 3+-contestant tournament's LAST match) had no spinner element in its template at all - only the "current match" screen did, and that screen is immediately swapped out once `tournamentIsComplete` flips true. Fixed: `applyTournamentResults` now returns `Promise.all(writes)` (each `setDBValue` dispatch mapped, `null`/no-write entries filtered out first) and `chooseWinner` (now `async`) awaits it before flipping `submitting` back to `false` — the LOCAL UI transition (showing next match / results screen / closing the panel) still happens immediately, only the spinner and the results screen's "Done" button (now `:disabled="submitting"`) wait on the real write completion. The results screen gained its own `v-if="submitting"` spinner + "Saving final scores..." text, mirroring the one the current-match screen already had.
- **Tap feedback on the tiebreak posters (Jul 2026, bug report — "something that just clearly indicates that I did click the poster").** `.poster-container` only had `:hover` (scale up, border brighten) — no feedback at all on a touch device, the same mobile-first gap already documented elsewhere in this file. Added `:active { transform: scale(0.95); }` plus a matching `:active .poster-wrapper { border-color: ... }`, alongside the existing `:hover` rules (harmless for mouse users, just redundant with the hover state).

## Trophy Case: "Most Decorated" row showed initials instead of images (Aug 2026)

Bug report: "in the trophy case I'm missing a bunch of images on that top row for the top winners they just have letters for all their names."

**Cause — a shape mismatch, same family as the stickiness one.** `mostDecoratedPeople` pushes whole WIN objects (`{year, expanded, …}`) into `person.wins`, but `winnerImage(expanded)` reads `.details`/`.movie` off an EXPANDED nominee. The template passed `person.wins[0]` (the wrapper), so both lookups were `undefined`, `winnerImage` returned `null`, and **every** person in that row fell through to the initial-letter placeholder. The category rows below always passed `win.expanded` correctly, which is why only this one row was affected. Fixed by passing `person.wins[0].expanded`. Note the sibling `@click="goToMovie(person.wins[0])"` on the same element is CORRECT as-is — `goToMovie` takes a win and reads `win.expanded` itself — so the two look inconsistent but both are right.

**Why the existing test didn't catch it**: `TrophyCase.test.js` already covered the Most Decorated row, but only asserted the `mostDecoratedPeople` computed and that the name appeared in `wrapper.text()` — never that an `<img>` actually rendered. Added a test asserting `.decorated-photo` is an `IMG` with the expected poster src (read from the component's own data rather than hardcoded, since wins are newest-year-first) plus a companion test that the placeholder still appears when there genuinely is no image. **Verified as a real regression guard** by reverting the fix: it fails with `expected 'DIV' to be 'IMG'`.

**`expanded.details` IS real** — I initially mis-read it as a dead branch (a `grep` for `details:` in `personalAwards.js` looked empty), then live verification showed the Best Actor row rendering actual face photos, which disproved that. The chain is: `PersonalAwardsModal.convertNomineeToMinimal` stores `minimal.profilePath = nominee.details.profile_path` at selection time, and `expandNomineeFromMinimal` rebuilds it as `expanded.details = { profile_path: … }`. So a person winner shows their real TMDB photo when a `profilePath` was captured, falling back to the movie poster when it wasn't. Worth remembering: **grepping one file was not enough to conclude a branch was dead** — the producer and consumer were two hops apart.

### Follow-up: people get PEOPLE pictures, never a poster (same day)
Report: "they are... some of them are movie posters, which isn't really what we want... I don't wanna show Steven Spielberg but then show the poster for one of his movies, that's not right."

`winnerImage` used to fall through to `expanded.movie.poster_path` for ANY winner without a stored profile path — so a person whose award predates the `profilePath` capture rendered as one of their films. Now it branches on winner type (`expanded.name` present = person, the same discriminator `winnerTitle` and the `trophy-subtitle` `v-if` already use):
- **Person** → stored `details.profile_path`, else a TMDB `/search/person` lookup by name (`ensurePersonPhoto`, the same cache shape SixDegreesGame uses: `undefined` = never looked up, `null` = looked up/in-flight with nothing found), else their **initial**. Deliberately never a poster — a wrong picture is worse than a letter.
- **Movie** → its poster, unchanged.

Lookups are driven by a `personWinnersNeedingPhotos` computed (distinct names across all categories that lack a stored path) via an `immediate` watcher, so a repeat winner costs one request no matter how many awards they hold. This makes Trophy Case the first page here to fetch on load; it's best-effort and degrades to initials.

Tests: `TrophyCase.test.js` — stored-photo case, the **"never substitutes a poster for a person"** guard (asserts the poster URL appears nowhere), the TMDB lookup being made/used and called exactly once for a two-time winner, no lookup when a photo was already stored, and movie winners still showing posters. `fetch` is stubbed in `beforeEach` to "found nothing" so unrelated tests get the initials path rather than a real request.

### Trophy Case leaderboards (Aug 2026)
Follow-up request: "movies with the most wins, movies with the most nominations... once we've unlocked nominations, we could also do people with the most nominations."

Unlocking nominations was the real work — `categorizedWins` only ever walked `category.winner`, so the whole nominee side of the stored data was untouched. New pure module **`src/assets/javascript/awardStats.js`**: `collectAwardEntries(personalAwards, library)` walks every year/category once and expands BOTH the winner and each nominee into `{ wins, nominations }` (flat lists of `{year, categoryKey, expanded}`), plus `rankPeople` / `rankMovies` leaderboards over either list. Store-free and unit-tested without mounting, per this repo's usual split.

Two modelling decisions, both deliberate and documented in the module:
- **A winner is also a nominee.** `PersonalAwardsModal` only lets you pick a winner from nominees you already selected, so `nominees` contains the winner. Nomination counts therefore include wins — which is what people expect ("Titanic: 14 nominations, 11 wins"), not double-counting.
- **A person's award counts for their film.** Every expanded nominee carries `.movie` (a movie-type entry, or a person expanded with the film they were nominated for), so both roll up identically. This matches how real tallies work — "Titanic won 11 Oscars" includes its acting and directing wins, not just Best Picture.

Ties break alphabetically so ordering doesn't depend on year-walk order; `minCount` defaults to 2 because a leaderboard where everyone has one award is just a list of every award. Each section hides itself when nothing clears that threshold, so a new/small awards history doesn't render empty shelves.

Three new sections join the existing Most Decorated (people by wins): **Most Nominated People**, **Most Awarded Movies**, **Most Nominated Movies**. `personWinnersNeedingPhotos` was widened to cover nominees as well as winners, since someone can be nominated repeatedly without ever winning and still needs a face. Movie rows use `.decorated-poster` — same footprint as the person photos so the rows line up, but `object-fit: contain` rather than `cover`, since cropping a poster loses the title.

Tests: `src/test/awardStats.test.js` (pure — collection across years, missing/partial data, nominees whose movie left the library, person-vs-movie discrimination, cross-category counting, remakes staying separate by id, wins-included-in-nominations, tie ordering, limit/minCount) and a `leaderboards` describe block in `TrophyCase.test.js` (a sweep topping Most Awarded Movies via its people's wins, nomination-only films outranking it on nominations, poster rendering + movie links, everything hidden when nothing repeats, and photo lookups firing for never-won nominees).

Note the original fix could NOT be visually verified end-to-end on the `testing-database` account: it has no repeat winners, so `mostDecoratedPeople` is empty and the row doesn't render at all there. Covered by the regression test instead.

## Acting-category gender eligibility, unified (Aug 2026)

While filling the test account with award data, the generated acting slates ignored gender (men nominated for Best Actress) because `AddRating.js` strips TMDB's `gender` from stored cast. User: "we should try to bring in gender. Just, if you're unsure about gender go ahead and count them as all genders."

**That surfaced a real bug in the app.** `PersonalAwardsModal` had TWO copies of the gender filter — one in the cast-grouping path, one in the person-filter path — and they had **drifted apart**:
- cast-grouping: actress ← gender `0 | 1 | 3`; actor ← `0 | 2 | 3`
- person-filter: actress ← gender `1 | 3`; actor ← `2 | 3`

TMDB's `gender` is an enum (`0` not specified, `1` female, `2` male, `3` non-binary), so the second path **silently excluded every "not specified" person from BOTH acting categories** — making them impossible to nominate anywhere, with no error and no way to notice. Which behaviour you got depended purely on which code path happened to load that person.

New pure module **`src/assets/javascript/genderEligibility.js`** — `isEligibleForActingCategory(gender, { isActress })` plus a `TMDB_GENDER` enum — is now the single source, used by both call sites. The rule matches the user's: anything that isn't a definite female/male reading (missing, `0`, or `3`) is eligible for **every** acting category. Rationale worth keeping: being wrongly offered a nomination is harmless (you just don't pick them); being silently unnominatable is not.

**Its own test caught a second bug in the first draft**: the guard was `typeof gender !== 'number'`, but `typeof NaN === 'number'` — so a garbled value sailed through as a definite reading and excluded the person from one side. Now `Number.isFinite`.

Tests: `src/test/genderEligibility.test.js` (definite female/male matching one side only, non-binary and not-specified counting for both, missing/null/NaN/string all treated as unknown, and the no-options default).

### Test-account award data (same session)
The `testing-database` account had no repeat winners, so Most Decorated never rendered. With the user's explicit go-ahead ("as long as it's only on the test account"), 10 new complete award years were generated from that account's own library (1991, 1993, 1998, 2000, 2001, 2018, 2020-2023), taking it from 35 awards across 3 years to 145 across 13. Deliberately untouched: **1994/1999/2015** (the user's real picks) and **1992**, which is left partially complete because it's the fixture that exercises Insights' "Resume Awards" flow.

Two things that made the data actually useful:
- Winners drawn purely from each year's top films almost never repeat a person (first pass produced exactly ONE multi-win person). A follow-up pass promotes anyone nominated across multiple years to winner in the categories they were nominated in — which preserves the "winner is always among the nominees" invariant `awardStats.js` relies on, rather than inventing winners.
- A second pass then re-ran every acting nominee through the real `isEligibleForActingCategory`, swapping 59 mis-gendered picks for genuinely eligible castmates from the same film (0 dropped, 0 remaining violations). It imports the app's own helper rather than reimplementing the rule, so the fixtures can't drift from the shipped logic.

Scripts were one-off and not committed. **Gotcha for any future admin-SDK script**: it must live INSIDE the repo — Node resolves `firebase-admin` relative to the importing file, so a script in the scratchpad fails with `ERR_MODULE_NOT_FOUND`. A backup of the pre-change awards is in the session scratchpad.

## Club Charts (Aug 2026)

Matt: *"It seems like there must be some more fun graphs we could build around film club
relationships. What sort of visualizations can we come up with?"* — then, on the
proposals: *"be creative, make them fun, make them pretty"* and *"I'd rather you add
something, and then later I decide to take it out as opposed to you not adding it at
all."* So: nine charts on their own screen at `/club-charts`, reached from a card on the
Film Club page. They'd have doubled that page's length inline.

### What the data allows, which shaped every chart

A published profile carries `ratings: { [tmdbId]: {r, at, t, p, c?} }` — a score, when
they watched it, title, poster, and the eight-criterion breakdown only behind the
`shareCriteria` opt-in. **There is no genre and no release date on a friend's rating.**

So anything cut by genre or decade can only be computed across the OVERLAP, joined to
your own library for those fields. That isn't a limitation worth fighting: every chart
here is about a relationship, and a relationship only exists where two libraries meet.
`buildOverlaps` does that join once and nearly every chart reads it.

### The nine

| Chart | What it answers |
|---|---|
| The Taste Map | scatter of each friend's average against yours on shared films, with the agreement diagonal — who runs hotter or cooler |
| How Much You Share | shared / only-theirs / only-yours, and what share of their library you've covered |
| Where You Agree | alignment sliced by decade and by genre |
| Who's Generous | everyone's score distribution side by side |
| The Contrarian Scoreboard | across films 3+ of you rated, how often each person is furthest from the group |
| Watched at the Same Time | films you and a friend landed on within a week, unplanned |
| Who's Been Watching | viewings a month per member over the last year |
| Your Blind Spots | the club's shared canon, minus you — each with an add-to-hat button |
| Where the Disagreement Lives | per-criterion, for friends who share their breakdown |

**Colour identifies a person, everywhere.** `memberColors` assigns from a curated palette
by sorted key rather than by hash — a hash gives no control over two friends landing on
near-identical hues, and the club is small. You are always `#f0f0f0`.

### Two things the first cut got wrong

- **Alignment bars on a 0–10 scale said nothing.** Against a real club every value came
  out between 8.6 and 9.7, so ten bars rendered identically. They're scaled to the range
  actually present now, with the true figure on every bar and the domain stated above
  them ("Bars are scaled to 8.6–9.7"). Scaled, the shape appears: 1930s highest, 2020s
  lowest, Science Fiction the weakest genre.
- The taste map's y-axis label was `their score →`, a right arrow on a vertical axis.

Contrarians needs three raters and Blind Spots needs two friends, so both correctly hide
themselves on a one-friend club rather than rendering something meaningless.

## Custom (honorary) awards, 2026-08-20

"It would be cool if for any given personal awards here, I could add custom awards. So if
I wanted to, I can name an award whatever I want and then assign it. So I can basically
hand out honorary awards."

The pleasing part is how little had to change. Every per-key helper in the modal already
defaulted sensibly for a key it had never seen — `isCategoryDisabled` → false,
`getCategoryDisabledReason` → null, `getCategorySortKey` → `'rating'`, `isActingCategory`
→ false — and all four display consumers already fell back to `|| categoryKey`. So a
custom award could ride the whole existing nominate-and-crown machinery instead of
needing a parallel path; the work was storage, a list that includes them, and name
resolution.

**Storage** is per year, beside that year's categories:

```
settings/personalAwards/<year>/customCategories/<key> = { name, createdAt }
```

with nominees and winner in `categories/<key>` exactly like a standard award's. A map,
not an array — Firebase hands a sparse array back as an object map, and a map makes
deletion a leaf write.

**The key is slug-derived rather than timestamped**, which is the one genuinely
interesting decision. `customAwardKey('Best Needle Drop')` is always
`custom-best-needle-drop`, so handing out the same award again next year produces the same
key and the Trophy Case aggregates it across years the way it does a standard category
("3× Best Needle Drop") with no extra work. The cost is that a duplicate *within* a single
year would silently overwrite the first, so the modal refuses one — as it refuses a name
that is already a standard category, and a name that slugs to nothing (pure punctuation
would otherwise be stored under a bare `custom-` prefix).

**Movie-type only.** The person path is gender-gated and specific to the acting
categories, and none of that generalises to an award someone invented; custom awards draw
on the year's films, the same pool Best Picture uses.

Two things that would have been quiet bugs, both caught by writing the test first and then
reverting the fix:

- **Loading has to read `customCategories` outside the `categories` branch.** An award can
  exist with nothing assigned to it yet, and that record has no `categories` key at all —
  so reading it inside the branch dropped every not-yet-assigned award on reload.
- **Removing an award has to delete `categories/<key>` too.** Orphaned nominees under a key
  nothing lists any more would keep the award alive in the Trophy Case and in every
  winner's award history — visible everywhere except the one screen that could remove it.

Name resolution outside the modal goes through `awardCategoryNameMap(personalAwards)`,
which merges the standard names with every year's custom ones. Whole-map rather than
per-year on purpose: the Trophy Case aggregates a category across years, and a movie's
award history walks every year at once, so an award invented in 2019 still has to render
by name on a card built in 2026. The Connections generator uses it too — without it, a
puzzle clue would have read "custom-best-needle-drop (The Groskers)".

### Honorary awards to people, same day

"I definitely need to be able to do honorary awards to people."

Fair — the fixed categories already cover actors and directors, so the awards a person
would *want* to invent are exactly the ones the built-ins don't reach: the composer, the
cinematographer, the casting director. Custom awards now carry a `type`, chosen on a
two-segment toggle when you name one, and a person-type award draws on the cast and crew
of that year's films.

Three things that mattered:

- **A custom award must never read as an acting category.** `isActingCategory` now returns
  false for any custom key explicitly. It would have been false anyway — slugs are
  lowercase and the check is `includes('Actor')` — but relying on letter case for
  correctness is luck, not design, and both gender gating and the lead/supporting sibling
  conflict hang off that one predicate. Writing the test against a cased key
  (`custom-Best-Actor`) is what turned it into a real guard; the lowercase version passed
  with the fix reverted.
- **It returns a flat list, not the movie-grouped shape.** The grouping exists for the
  acting grid's per-movie "load more cast"; a person-type custom award renders in the
  simple grid, each person over the poster of the film they did it on, exactly as Best
  Director does.
- **Cast is capped, crew is not.** Crew is already trimmed to `KEPT_CREW_JOBS` on the way
  into storage — a dozen or so per film — but cast is deliberately untrimmed because Six
  Degrees walks the full billing list, so a ten-film year would otherwise render hundreds
  of tiles.

Winners' photos come from the Trophy Case's existing name lookup rather than being
pre-fetched: doing it upfront would be a `/search/person` call for every cast and crew
member of the year, and the Trophy Case already resolves a person by name and falls back
to their initial. A saved winner carrying a `name` is what tells it this is a person and
not a film.

Awards created in v1.90.0 carry no `type` at all. They default to `'movie'`, which is
what they were, rather than being backfilled.

## The Awards tab loses its heading (2026-10-27)

A day after Awards became an Insights tab, Matt reported from his phone that everything
felt "pushed way too far down... way too much content before I even get to the awards".
Above the first category sat the Insights tabs (two rows of three), the ceremony strip,
the year strip, then the old page's "The 2006 Groskers / Your own annual awards" heading.
He floated hiding the Insights tabs on Awards and rejected it himself ("then it doesn't
work like the other tabs"). What shipped instead: the heading only renders in Home's
pop-up, boards keep only the Oscars ceremony caption, the strips sit closer together, and
the Insights tabs went to one row of six (measured: "Overview" is 44px at 12px bold in
Roboto Condensed, a 375px iPhone gives each tab ~54px). Held in reserve if it still feels
tall: fold the ceremony strip into one dropdown button beside the years.
