# Mixed Bug-Report Rounds — development history

> Archived from CLAUDE.md. Verbatim post-mortem narrative, kept for the hard-won
> detail. Durable rules extracted from this live in `.claude/rules/`.

## Five more reports (Jul 2026): tiebreak flash, Clue Budget feedback + rating clue, daily-win checkmarks, Connections award name

### The tiebreak flash — a real regression from the offline-support extension the day before
Bug report: "After I break a tie, I get the tie break message again just for a second or two. But it's annoying because it's just long enough that I try to click on it."

**Root cause, and why it was NEW**: `writeDurably` (added the previous day, see the Offline Support Extension section) did `await enqueueWrite(...)` **before** issuing the Firebase `set()`. `enqueueWrite` opens IndexedDB, scans the WHOLE pending queue for its path-dedupe, then writes — real, variable latency. A tiebreak fires several `writeDurably` calls back to back (`settings/tieBreakTournament`, N× `movieLog/<key>` score adjustments, `settings/lastTweak`), so an early write could reach the server and bounce an `onValue` snapshot back **while a later write hadn't even been sent yet**. Both listeners commit their branch WHOLESALE (`setSettings`/`setMovieLog`), so that snapshot — which legitimately predated `lastTweak` — clobbered the already-committed local value, `Date.now() - lastTweak` went back over the quota threshold, and the "You have a tie to deal with" notice re-rendered until the real `lastTweak` write finally landed. The pre-1.25.0 `setDBValue` path never had this window because it called `set()` immediately (Firebase's own client cache then included the pending write in every subsequent snapshot it fired).

**Two-part fix**:
- **Don't serialize the network write behind IndexedDB.** `writeDurably` now kicks off `enqueueWrite` and the network write together (`const queuedPromise = enqueueWrite(...)`, awaited later) rather than awaiting the enqueue first. Durability is unchanged — the IndexedDB record still lands regardless of what happens to the network write — the network write just no longer inherits IndexedDB's latency.
- **New `state.inFlightWrites` ({path: value}) + `trackInFlightWrite`/`untrackInFlightWrite` mutations + the `reapplyInFlightWrites(state, rootKey, data)` helper.** A write is tracked from its local commit until the server settles it (success OR failure — the durable queue owns retries either way), and **both** `onValue` listeners now re-top the incoming snapshot with anything still in flight before committing it. This closes the whole CLASS of "a snapshot that predates my just-made change briefly reverts it," not just the tiebreak instance — the movieLog listener gets the same treatment since a tiebreak's score adjustments are movieLog writes. The raw server data is still what gets written to the offline IndexedDB snapshot (`saveSnapshot`), only the in-memory state is re-topped. `untrackInFlightWrite` runs in a `finally` that also covers the offline early-return, so `inFlightWrites` can't grow unboundedly across an offline session.
- Tests: `flushPendingWrites.test.js`'s new `in-flight writes are not clobbered...` describe block. The firebase mock now **captures the real `onValue` callbacks** (`fireSnapshot(branch, data)`) so the listener's own clobber-protection is genuinely exercised rather than testing the private helper directly. **Verified as a real regression guard** by temporarily reverting the listener fix and confirming the key test fails with exactly the bug's signature (`expected 100 to be 999`).

### The other four
- **Clue Budget: a wrong guess said nothing** ("if I guess wrong it should say so. There's no real feedback right now") — `submitGuess` silently did nothing on a miss, indistinguishable from a tap that didn't register. Added `lastGuessFeedback` ("Not {title}. Try again."), rendered in an always-present `.guess-feedback` element toggled by `visibility` (not `v-if`) with a reserved `min-height`, so it can't reflow the clue shop below — same anti-layout-jump convention Connections' own guess feedback uses. Cleared on the next keystroke. **Guesses remain free** — this game charges for CLUES, not guesses — and there's a test asserting the budget is untouched by a wrong guess.
- **Clue Budget: "Your Rating" is now a buyable clue** (user request). Comes in through `extras.yourRating` rather than being read off the entry, because computing a rating needs `GetRating.js` + the Vuex weight getters, which this store-free module can't reach (same reason `tagline` comes in that way). Seeded into `liveExtras` synchronously at round start, so it's offered on the very first render with no network round trip. **Flat-priced at $12, deliberately**: unlike the person/keyword/company clues there's no TMDB signal to scale against, and how identifying a given score is depends entirely on the shape of the player's own library (a 9.4 narrows hard, a 6.5 barely at all) — a fake curve would be worse than an honest fixed cost. Guarded with `Number.isFinite`, which correctly offers a legitimate `0` rating but skips an unrateable entry. **Test-fixture note**: `ClueBudgetGame.test.js` now mocks `GetRating.js` — its fixtures carry only a `calculatedTotal`, not the individual criteria the real weighted math needs, so the real `getRating` returns `NaN` for them (which the guard correctly refuses to offer). Discovered by the test failing exactly as designed.
- **GamesHub: a checkmark on each game won today** ("I don't want to limit the number of times I can play a game in one day but it would be nice to have a checkmark on the game if I've won a game of that today... then I'll be able to play each one each day and feel satisfied"). Explicitly a marker, never a gate — there's a test asserting a won game is still tappable. New `gameWinKey(routePath)` (route's last segment) + `todayStamp()` (`toDateString()`, matching `settings/dailyAwardsYearDate`'s existing convention) exported from `gameData.js` and used on BOTH sides (the game recording, the hub reading) so they can't drift. `recordGameWin()` on the mixin writes `settings/games/wins/<key>` via `writeDurably` (offline-safe) and skips a redundant write if today is already stamped. **A stamp that isn't today's simply reads as "not won today"** — nothing to expire or clear.
  - **The judgment call, documented in-code**: the five games with a discrete win state (Wordle/Connections/Six Degrees/Clue Budget/Trivia) are unambiguous, but the three endless streak games (Higher or Lower/Timeline/Tag) never "finish" — one correct answer counts there, since the point of the checkmark is "I played this today and did something," not a difficulty gate.
  - **Wiring differs by game shape**: Wordle/Connections/Six Degrees derive `status` as a COMPUTED, so there's no imperative win moment to hook — they get a `watch: { status }`. The rest call `recordGameWin()` inline at their existing win/streak-increment point.
  - `recordGameWin` derives its key from `this.$route`, which **no pre-existing game test mocks** — so it silently no-ops in all of them (nothing broke), and the new tests in `TriviaGame.test.js` add `$route` explicitly.
- **Connections: the personal-award label said "(Personal)"** — a generic internal string. Now uses the user's own award name via `awardNameWithThe` (e.g. "Won Best Picture (The Groskers)"), threaded through as `awardsData.personalAwardName`. Per the report, the setting's own instructions tell the user to pick a name that reads naturally after "the", so prefixing is safe. Note the DEFAULT is `'Oscar'` (singular) → "(The Oscar)", not "(The Oscars)" — the existing tests were updated to pass an explicit `personalAwardName` and assert the real reported behavior, with one dedicated test pinning the default fallback.

## Five reports (Aug 2026): Six Degrees follow-ups, stickiness advance, bug-button move, and a diagnostics gap

- **Six Degrees: "I still don't see a way to reveal the shortest path after I find my own path."** My own over-engineering from the day before: `canShowComparison` also required `optimalHops < hopsSoFar`, i.e. it HID the button whenever the player matched the optimum, on the reasoning that there'd be nothing "could've been" to show. Wrong on two counts — matching the shortest path is precisely when you want it confirmed, and from the player's side an absent button is indistinguishable from a broken one. Condition dropped; the button now shows after every win, and a new `comparisonLabel` computed says which case it is ("You found it — the shortest path was also N hops:" vs "The shortest path was N hops:").
- **Six Degrees: "the scrolling is better but it should scroll so that I can still see my most recent addition."** The first cut scrolled to `scrollWidth` — but the chain row does NOT end at the newest entry: the "?" placeholders and the goal poster all sit AFTER it, so scrolling fully right pushed the thing the player just added back off the left edge. `scrollChainToEnd` now finds the newest REAL entry (each interactive, non-goal, non-placeholder step carries a `data-chain-index`) and scrolls only far enough to bring its right edge into view plus a `SCROLL_MARGIN_PX` margin — and returns without scrolling at all when it's already visible, so it can't yank the row around. Falls back to the old `scrollWidth` behavior if the element can't be found.
- **Stickiness: "after each one it should just immediately take me to the next."** Two things were in the way. (1) The entire save block sat behind a **2-second `setTimeout`** — a holdover from when the write had to round-trip before local state caught up; `writeDurably` commits locally first, so that was pure dead time between every entry. Removed. (2) Advancing relied on `showStickinessInline` merely never having been set false, so anything that knocked it back (a remount, a transiently-empty list) dumped the user on the notice banner with no way forward but tapping it again. Staying on the form is now asserted explicitly (`if (resultsThatNeedStickiness.length) showStickinessInline = true`), and the panel only collapses once the queue is genuinely empty. The `dbEntry` is also now built BEFORE the dispatch, since `writeDurably`'s synchronous local commit means `firstStickinessResult` already points at the NEXT movie the moment it's called.
- **Bug button moved to the bottom LEFT** (`.bug-report-trigger`, `right: 1rem` → `left: 1rem`). The panel itself is a centered overlay with no side anchoring, so nothing else needed to move.

### The one that couldn't be reproduced — and the diagnostics fix it prompted
Report: "I just navigated from the Wordle game by clicking on the banner of the header and return to the home screen where I see the banner image but the entire list of movies is empty." **Not reproduced** despite walking the exact path live (Home → scroll → Wordle → banner → Home) — the list rendered normally.

What the investigation DID establish is a real defect in the reports themselves: `buildAppStateSummary` (`bugReports.js`) was reading `homePageSearchValue`/`homePageSearchChips`/`homePageNumberOfResults` — the **persisted navigation** fields that `Home.mounted()` explicitly CLEARS as part of its restore. So a report filed from Home will show an empty search and no chips *no matter what is actually filtering the list*, which is exactly why this one was undiagnosable: nothing in the snapshot could distinguish "no results matched the active filter" from "the list failed to render". (`numberOfResultsShown` is the one field NOT cleared, so it reflects whenever Home was last left — also misleading if read as current.)

Fix: Home now publishes a small live summary (`liveDebugState` computed → `setHomePageLiveState` via an `immediate` watcher) covering the active quick link, typed search, chips, results rendered vs matched, library size, `numberToShow`, whether the grouped view is active, and the sort. `bugReports.js` includes it as `homeLive`, with the old fields kept (and now commented) for continuity with older reports. Purely diagnostic — nothing reads it for behavior, and it's never persisted. **If this report recurs, `homeLive` should immediately say which of the two it is.**

**Fixed in a follow-up (same day):** navigating from Home directly to a game route left the game page inheriting Home's scroll position — Reel Wordle opened scrolled halfway down its own page. `GamesHub.selectGame` had worked around this with its own `window.scrollTo(0)` before pushing, which covered exactly ONE entry path (a hub tile) and missed every other way into a game: Home's Games button, `BackLink` between the hub and a game, a deep link, the header banner.

Replaced with a router-level `scrollBehavior` (`src/router/scrollBehavior.js`, wired in `router/index.js`), **deliberately scoped to `/games*` only** — it returns `{top: 0}` for game routes and `false` (leave the scroll alone) for everything else. That scoping is the whole point: the app has never had a global scrollBehavior because `Home.vue` does its own scroll restoration (returning from a movie's detail page puts you back exactly where you were in the grid), and a blanket scroll-to-top would fight it. `selectGame`'s manual `window.scrollTo` was REMOVED rather than left as belt-and-suspenders, so there's exactly one mechanism. **`behavior: 'instant'` in the returned position is REQUIRED, not cosmetic** — and a first cut of this shipped WITHOUT it and did nothing at all. The app sets `scroll-behavior: smooth` on `<html>`, and with that in effect a plain `window.scrollTo({top: 0})` is a **silent no-op in this app** (verified live: position stayed put, and a `window.scrollTo(0, 300)` didn't move either, while the identical call with `behavior: 'instant'` worked immediately). Vue Router passes whatever `scrollBehavior` returns straight through to `window.scrollTo`, so the override belongs in the returned object. The GamesHub workaround this replaced happened to pass `{top: 0, behavior: 'instant'}`, which is exactly why IT worked — worth remembering for any future programmatic document scroll in this app.

**This turned out to be a much wider latent bug, found while verifying the above.** `document.documentElement.scrollTop = 900` is ALSO swallowed by the same CSS (the `scrollTop` setter honours the element's scroll-behavior) — and that assignment form is exactly what `Home.vue` used for its scroll restoration. So Home's "returning from a movie's detail page puts you back exactly where you were in the grid" had been **silently doing nothing**, on a 1300+ movie library. Verified live: setting `scrollTop = 900` left the position at 0. Fixed by routing all four of Home's document-scroll sites through a new `src/utils/scrollWindowTo.js` (`window.scrollTo({ top, behavior: 'instant' })`), which carries the full list of what does and doesn't work as its own comment. **Rule for this codebase: every programmatic document scroll must pass an explicit `behavior`** — `'instant'`, or `'smooth'` if animation is genuinely wanted (that path works; it's only the INHERITED CSS behaviour that fails). Tests: `src/test/scrollWindowTo.test.js`.

**And behind THAT was a second, independent bug in the same feature** — found because fixing the CSS issue still didn't make restoration work. `mounted()` deferred the restore into a `$nextTick` callback that read `this.$store.state.homePageScrollPosition`, but the "clear stored state after restoring" block a few lines below sets that to `0` **synchronously** — i.e. always before the deferred callback runs. So the `> 0` guard was false every single time and the page never moved. Fixed by capturing the value into a local const before the clear. **Net: Home's "put me back where I was in the grid" had two stacked defects and has apparently never worked**; either one alone was enough to break it, which is presumably why it went unnoticed for so long. Extracted as a pure function specifically so it's unit-testable — importing the real router pulls in `store/index.js` and initialises Firebase at module load, which is why nothing else in `router/index.js` has tests. Tests: `src/test/scrollBehavior.test.js` (hub, individual games, every other route left alone, malformed input); `GamesHub.test.js`'s old "scrolls to top before navigating" test inverted to assert the component does NOT scroll itself.

Tests: `SixDegreesGame.test.js` — the scroll tests rewritten around a stub row exposing `querySelector`/`getBoundingClientRect` (asserting it scrolls just far enough, and NOT at all when the newest entry is already visible), and the old "does NOT offer it when they matched the optimum" test inverted to assert the button now shows with the "You found it" label.

## The watchlist learning loop had been dead since its first run (Aug 2026)

Spotted in the console while working on something else, then fixed on request:

```
TypeError: (t || []).map is not a function
  at reconcileWatchlistLearning
  at buildWatchlists (watchlist.js)
```

`reconcilePending` opens with `(ratedTmdbIds || []).map((id) => String(id))`. Its one
real caller, `WatchlistScreen.buildWatchlists`, builds that argument with
`discover.js`'s **`ratedTmdbIds()`, which returns a Set** — as it should, since every
other consumer (`rankWatchlistCandidates`, `moviesFromPeople`, `hiddenGems`…) wants
`.has()`. A Set has no `.map`.

**Why it survived:** every existing test in `recommendationStats.test.js` passed an
array. The module was well covered and the coverage was of a shape nothing in the app
ever passes it.

**Why it was worse than a console error.** The sequence:

1. First ever watchlist visit — `pending` is empty, so `reconcileWatchlistLearning`
   returns early at its `if (!learning?.pending) return` guard, never reaching the
   crash. `recordWatchlistSuggestions` runs and writes `pending`.
2. Every visit after — `pending` now exists, `reconcilePending` throws, `buildWatchlists`
   rejects, and because the two dispatches were bare sequential `await`s,
   **`recordWatchlistSuggestions` never ran again.**

So the loop froze after one pass: no source was ever credited with a hit, and no new
suggestion was ever recorded. The lists themselves were fine — they're assigned before
the learning block — so there was nothing user-visible but the console entry, which is
exactly why it sat there.

Two fixes, because the type error and the fragility are separate bugs:

- `Array.from(ratedTmdbIds || [], String)` in `reconcilePending` — works on a Set, an
  array, or anything iterable.
- **The two dispatches are now guarded independently** in `buildWatchlists`. This is
  best-effort bookkeeping that runs after the page is already rendered; neither step
  should be able to take the other down, or fail the screen.

Verified live: the error is gone on the fixed bundle, and the loop immediately recorded
103 pending suggestions with per-source `suggested` counts across all five sections —
data it had never managed to write. (`hits` stay empty until one of those is rated,
which is correct.)

## Film Club round, the morning Brian's interop landed (Aug 2026)

Five reports, all from one sitting on `/film-club` — Movie Log users had just started
appearing in Cinema Roll. Four fixed here; the fifth ("what sort of visualizations can we
come up with?") is a design question, not a defect.

### The feed dead-ended on anything you hadn't seen

*"Clicking a poster on the recent friends feed takes me to that movie in my db. But if I
haven't seen that movie, it should instead take me nowhere. But we should have the
universal 'add to hat' button on it."*

MovieDetail is a **pure local lookup** — deliberately, see
`.claude/rules/detail-and-insights.md` — so a friend's film you've never rated rendered
an empty page. Now the tap is gated on `ratedTmdbIds`, and anything outside your library
carries a `SendToHat` icon and a "Not in your library" label instead. A feed item is a
bare `{id,t,p}` rather than a library entry, so `hatMovieFor` maps it onto the TMDB field
names `toHatMovie` reads.

### Hat movies now say where they came from

*"We should include a note on that hat movie that explains where it came from so it could
be a friendly recommendation... use plain language to label why that movie went into the
hat."*

`toHatMovie` had accepted a `note` since the integration landed and **nothing ever passed
one**. Threaded through: `SendToHat` gained a `note` prop, `addToMovieHat` forwards it,
and every call site supplies plain language — "Worth a rewatch", "From a director you
love", "Filling out 2019", "Loved by the film club", "Brian watched this (8.3)".
`addedBy` already says who; the note says why.

### The other two

- **Feed size**: published `recent` 20 → 40, the merged feed 30 → 60, and the feed row's
  posters run larger than the other rows' (116px against 92px). Friends only get the
  longer feed once they republish.
- **Friend rows**: were a name, a title count and a chevron. Now titles, how many films
  you've both rated, how closely you agree, when they last watched something, and four
  posters of what that was. `friendSnapshot` is deliberately **not** `compareWithFriend`
  — that returns twelve-item disagreement lists, shared loves and per-criterion gaps, all
  of it discarded by a row; this walks the overlap once for the two numbers shown. It
  reuses the same alignment definition (10 − mean absolute gap) so a row and the page it
  opens can't disagree.

## Charts review + the Movie Hat cluster (Aug 2026)

Nine of twenty-one reports from one morning's sitting.

### Club Charts, reviewed within the hour of shipping

- **The taste map plotted 0–10 and every dot sat in the same square inch.** Averages
  cluster hard around the middle. Both axes now zoom to the scores in play (4.6–7.2 on
  the real club). **One domain drives both axes on purpose**: the diagonal is the line
  y = x and only stays corner-to-corner while the axes match — zooming them independently
  would leave the "perfect agreement" line lying about where perfect agreement is.
- **Colour alone didn't say who was who**, so every bar in the agreement chart carries its
  friend's name as well as the figure.
- **Contrarian bars started at different x** because names have different lengths. Fixed
  width, clipped with an ellipsis.

### Movie Hat

- **The picker was clipped by the poster scroller.** It was `position: absolute` inside an
  `overflow-x: auto` row, so it was cut off and dragged the row's layout sideways. It is a
  **teleported bottom sheet** now — escapes every overflow and clipping context there will
  ever be, and gives each hat a full-width 48px row instead of a cramped chip. The result
  message had exactly the same problem and became a teleported toast.
- **"Heat is in Just Matt"** read as a status, and sat too close to "is already in" — now
  "was added to".
- **Hats sort by most recent use.** `lastUsedAt` is stamped on a successful add. The
  storage key comes from raw settings, never the getter's index — the getter is sorted
  now, so its positions stop matching stored ones the moment any hat is used, and Firebase
  hands a sparse array back as an object map.
- **A hat card shows its whole draw history**, newest first, as a scrolling poster row.
- **A magic wand became a hat.** Drawn inline as SVG; bootstrap-icons has no hat.
- **Adding from the watchlist takes the movie off it**, reusing the existing punt
  machinery (60 days, doubling) rather than inventing a second kind of hidden. The X
  button's label now says what a punt actually does, which was the other report.

**A bug I introduced and caught live:** punting immediately unmounted the card, which took
the confirmation toast inside it with it — you got no confirmation at all. The punt is
delayed four seconds so you read "X was added to Y" and then watch it leave, which reads
as cause and effect. Timers are cleared on unmount.

### Deep Stats, Awards, Insights and the Film Club badge (Aug 2026, same round)

- **Standouts listed more than it showed.** A card read "11 rated" and rendered six —
  `perFacet` capped the poster row at six while the count reported the whole bucket, which
  reads as a bug. `perFacet` defaults to null now and the row carries every match; it
  already scrolls sideways, so length is free.
- **Marathon Club's biggest days show their posters**, small (30×45) — they're a reminder
  of the day, not the subject. `biggestDays` already carried its entries.
- **Rewatches gained "Longest waits"**, the other end of the list that already produced
  "Quickest returns".
- **Years can sort by rank as well as chronologically.**
- **"The Oscars 2026" became "The 2026 Oscars."** The heading slots the year between a
  leading article and the name. The regex requires whitespace after "the", so a name like
  "Theatre Awards" isn't mangled — covered by test.
- **The "Fun Facts" header is gone**, boxes kept.

**The Film Club badge could never have worked.** The icon counts new ratings in friends'
**profiles**, but `Home.vue` only ever dispatched `attachSocialListeners` — never
`fetchFriendProfiles`. So `countNewFriendUpdates` always ran over an empty object and
returned 0, which is why Matt "hadn't seen it in a while". Home now fetches profiles, and
watches `socialFriendKeys` to refetch when the edges land (the same watcher
WatchlistScreen and FilmClubScreen already had — Home was the odd one out). The icon is
also the outline club now, matching the binoculars and sort glyphs beside it.

### Default sort, merged quick links, and splitting the performer watchlists

The last three of the round.

- **A default sort lives in settings** (`settings/defaultSort/{value,order}`, leaf writes).
  Home already remembered a sort for the session via `DBSortValue`; this is the one it
  opens on when there's nothing to restore. Precedence: restored sort → session sort →
  saved default → rating.
- **Quick links and tags are one list.** Tags used to sit behind their own "Tags ▸"
  collapse below an `<hr>`, which existed because a long tag list drowned the quick links.
  The combined list is capped at 40vh and scrolls, which is what made the separation
  unnecessary. *The scroll rule had to go at the top level of the style block* —
  `#quick-links-accordion` is a child of the search row, not of `.quick-link-types`, so
  the first attempt nested inside there never matched and silently did nothing.
- **Three performer watchlists instead of one**: actresses, actors, and "people you rate
  higher than most".

The last of those is a different question from the other two. `favoritePeople` finds who
you rate highly outright, which fills with people who happen to be in great films.
`peopleYouRateHigher` is a **lift** — your score against TMDB's `vote_average` on the very
same films — so it surfaces people you personally rate above the consensus. Films without
a usable `vote_average` are skipped rather than scored as zero, which would invent an
enormous lift.

**Gender isn't in the library** — `storedEntry.js` trims it — so the split needs TMDB, the
same way FavoriteActors/FavoriteActresses get it. `resolvePerformers` runs the
`/search/person` call and **keeps the id**, which `moviesFromPeople` then reuses instead
of searching for the same name a second time (covered by test: sabotaging the reuse makes
the call count go 1 → 2). A wide pool of twelve goes in before the split, because taking
the top three overall could be three actors and leave the actresses row empty. TMDB
reports 0 for "not specified"; those people appear in neither gendered row and the row
simply doesn't render.

The existing `WatchlistScreen` test mock returned `{ id: 777 }` with no gender, which is
not a shape TMDB ever produces — it made every gendered row come back empty.

### Two follow-ups on the hat work, both mine to fix

- **The hat card layout was busted, and it was a structural mistake.** `.hat-card` was
  `display: flex` — a ROW of poster plus body — and the history strip was appended as a
  third flex child, so a full-width scrolling strip got squeezed into a narrow third
  column. A row has nowhere to put a full-width element. Rebuilt as a vertical block:
  header (name, count), a last-drawn row (poster, title, Draw button), then the strip
  spanning the card. The regression test asserts `.hat-card > .hat-history` and *not*
  `.hat-last .hat-history` — putting the strip back inside the row fails it.
- **The hat icon was the right idea upside down.** "The hat should be flipped upside down
  and the + needs to be on the hat, not below the hat." It's a hat you draw *out* of, so
  the brim sits on top and the crown hangs below, opening upward, with the plus on the
  crown. The crown had to become an outline rather than a fill — a same-coloured plus
  drawn on a filled crown is invisible.

## Overnight round, 2026-08-20 (six reports)

Matt fetched a round of reports and went to bed: "Just fix what you can. I trust your
judgement." All six landed.

### The tiebreak loading state pushed the posters down (`v-show` vs Bootstrap)

"The new loading state on the tie breaker is forcing the two empty poster spots down and
the popping them back up. It's broken."

The swapping indicator added the day before was a flow sibling ABOVE the poster row, with
a `min-height: 180px` intended to hold the pair's place, and the row itself was hidden
with `v-show`. Except it wasn't hidden at all: `v-show` writes an inline `display: none`,
and the row also carries Bootstrap's `.d-flex`, which is `display: flex !important` — and
`!important` in a stylesheet beats a plain inline style. So the spinner's 180px stacked
ON TOP of a row that was still fully laid out, and the row snapped back up when the
spinner left.

Now one `position: relative` stage holds both, the indicator is `inset: 0` over the row,
and the row is hidden with a class of our own (`visibility: hidden`) — which keeps its
height reserved, keeps the `<img>`s loading (that's what lifts the gate), and refuses
taps. Zero layout shift either way.

**The existing test passed against the broken code.** It asserted
`element.style.display === 'none'` — exactly what `v-show` writes — and jsdom loads no
Bootstrap CSS, so it never saw the `!important` that beat it. Now in `.claude/rules/vue-ui.md`.

### A finished tournament immediately offered another one

"I just finished a tie break tournament and it is immediately offering me another one.
There is supposed to be a delay between prompts."

`acknowledgeResults` did stamp `lastTweak` — but then called `ensureTournamentStarted()`,
and Home pins the prompt open for as long as a tournament *record* exists, checking the
daily quota only when there is none. So the new record walked straight past the delay
that had just been set one line earlier.

That eager restart only ever existed for the "force tiebreak" testing toggle, where
`showTweakModal` is pinned true and the `needsNewTournament` watcher never re-fires. It's
now conditional on that state. In ordinary use a `justAcknowledged` flag blocks the
watcher until the prompt has actually closed once — deliberately, rather than trusting
Vue's flush ordering between the parent's prop update and the child's watcher to get
there first.

### Six Degrees ended on a tier picker instead of the house buttons

"When I complete a six degrees, let's lose the difficulty buttons and just have a new game
button and a back to games button. Just like we do in other games."

The third revision of this spot (a decoupled picker + New Game button was tried and
reverted once already). Now the standard `.end-actions` row; "New Game" replays whatever
tier `selectedDifficulty` holds. The gate screen keeps its picker — retrying at a
different tier is the only thing that gets you off it.

### The whole-list hat button, and the year lists

"The button we have for adding a whole watchlist to a hat it takes up more room than it
actually has value. Let's just get rid of it then we can tighten up those layouts a
little bit." Gone; section margin 1.75rem → 1.25rem, since that button was contributing
~40px of the gap between sections on its own.

"How did you choose which years to include in the get it to 10 watchlist... it seems like
an arbitrary number of lists. Maybe there's a way to combine those into a single list with
like a year selector above it... and then, if you could see on each one of those
selectors, how close we actually are."

They *were* arbitrary: `nearThresholdYears` returned the closest three of the years within
four of the threshold — neither "the newest few" nor all of them, which is exactly why it
read as arbitrary. Nothing is culled now (`reach`/`cap` default to `Infinity`, kept as
options), and the screen is one section with a sideways year picker, each tab labelled
with that year's own distance, closest to done on the left. Suggestions are fetched for
the selected year only and cached per year — previously three years were fetched up
front, which was affordable only because the list was capped at three.

### Film Club called people by their email handle

"It would be nice if we could use someone's real name when we mention them in film club."

Two separate causes. Your own name: `socialSettingsWithDefaults` fell from an
explicitly-typed display name straight to the email's local part, and nobody had ever
typed one — so Matt published as "mattgrosso". The sign-in provider hands back
`user.displayName` ("Matt Grosso") and the store was throwing it away. Now captured at
`completeLogin` **and** `verifyRestoredSession` (anyone already signed in never goes
through the former again), persisted to localStorage so a mention isn't briefly wrong
while auth settles, cleared on logout, and slotted between the typed name and the email.
Apple only returns a name on the first authorization, so a null never overwrites one
already captured.

A friend's name: `filmClubFriends` fell from their profile straight to their raw database
key — a sanitized email address — and profiles are fetched lazily because they're ~100KB
each. The directory row is already in memory and carries the same name; it's the middle
step now.

The six-hour publish throttle also gets a name-change bypass. Friends see you by whatever
was last published, so waiting up to six hours to stop calling you by your email handle
would be this same report, still on screen.

## Three more, later the same day (2026-08-20)

### The awards detail pane never said which category you were in

"When I click into a category on my personal awards, it doesn't actually say
anywhere what category I'm working on on that page so if I look away and forget, I have
to exit and come back."

The modal's header slot is `v-if="!selectedCategory"`, so drilling in hid the only
heading on screen and nothing replaced it. The tell was in the stylesheet: a
`.category-header h5` rule still sat there, pointing at a wrapper that no longer
existed — a dead rule left behind when the title was removed, and `getCurrentCategoryName()`
was still defined and called from nowhere.

The name goes in the **sticky** section, not the panel bar above it. The bar scrolls
away, and a name you lose the moment you scroll down a grid of nominees is the same bug
again.

### "You've had time to sit with"

"I don't like the language on the stickiness prompt like 'you've had time to sit with'
isn't that great? Can you reword that to me a bit more direct?"

Now "N movies are ready for a stickiness score." Every other prompt card states a plain
fact and leaves the verb to the action link — "2021 has enough films to hand out awards",
"Three films are sitting on the same score" — so this one does too, and says what is
actually wanted rather than narrating the passage of time.

### An unrated poster went straight to rating, or nowhere at all

"If a movie is presented in a watchlist or in film club and it's one that I have not yet
rated then... just clicking the poster should pull up some kind of a summary of the movie
so that I can investigate further."

Two different wrong answers to the same tap. On the watchlist, an unrated suggestion
dropped straight into the rating flow — which only makes sense for a film you have
already seen, and these rows are explicitly films you haven't. In Film Club, `openFeedItem`
returned early for anything not in your library, so the poster was simply inert: MovieDetail
is a pure local lookup and would have rendered an empty page.

`MoviePreview.vue` is the answer to both. Poster, year, runtime, genres, TMDB score,
overview, and the JustWatch availability inline rather than behind a second tap — "can I
actually watch it" is half of deciding whether to bother. Rating is a button inside the
sheet, the deliberate second step it should always have been.

Everything is fetched by TMDB id rather than threaded through from the row. The sources
feeding these rows carry wildly different shapes — discover results, person credits, a
friend's published profile with single-letter keys — and the id is the only thing common
to all of them.

Rated rows are untouched: "Worth a rewatch" and "Give these another shot" still go to
your own detail page, which is richer than any summary sheet.

Two things extracted on the way through:

- **`src/mixins/backgroundScrollLock.js`.** WhereToWatch's scroll lock holds BOTH `<html>`
  and `<body>`, and the comment explaining why (and why `window.scrollTo` is not a valid
  probe) was expensive to establish. A second sheet needed the same behaviour; copying
  that block would have been the start of it drifting.
- **`FilmClubScreen` had no `data()` at all**, so `v-model="directorySearch"` on the
  "Search people on other apps" box had nothing to write to and the filter never applied.
  Noticed while adding `previewing`; declared alongside it.

### Filling out the unrated-movie drawer

"Let's add director and cast and some other pertinent details to the unrated movie
drawer that you just added."

Director and cast were asked for by name. The other two are the ones that actually
change a decision about a film you have never seen:

- **The content rating** ("PG-13"), which sits with the year and runtime — the things
  you check before committing an evening. Null when TMDB has no certification for the
  region, which is common and has to read as unknown rather than as an empty badge.
- **What your Film Club made of it.** The strongest signal the app holds about a film
  nobody has rated for you, and it costs **no request** — the club profiles are already
  in memory. `friendRatingsFor` in `social.js` is the one-film counterpart to
  `friendsLoveUnseen`.

`append_to_response=credits,release_dates` rides on the existing details call, so this is
still exactly the two requests it was before any of it was added.

Pure extraction lives in `movieSummary.js`: `directorsFrom` uses `.filter()`, never
`.find()` (a co-directed film has two, and crediting only the first-listed is a mistake
this repo has made before), and matches on `job` rather than array position, since TMDB
orders crew by department. `topCastFrom` sorts by `order` explicitly — `order: 0` is top
billing, not a missing value, which is the `id: 0` trap in another guise.

Friends' scores go through `formatScore` because they are this app's own weighted sums.
The TMDB average deliberately does not: that is TMDB's number, published at one decimal,
and padding it to two would invent precision it does not have.

**The mock was lying, and reverting the fix is what caught it.** The first version of the
MoviePreview suite returned `credits` and `release_dates` from the details call whatever
the URL asked for, so the director, cast and certification tests all passed against a
component that never requested them — only two of five failed on the revert. The mock now
strips both unless `append_to_response` names them, and all five fail as they should.

### Prompts, permissions and a friend's poster strip (Aug 2026)

Four reports in one sweep, two of them about the personal-awards prompt.

**A threshold setting that only three of its four readers honoured.** Natalie: "Yesterday
I changed my personal award number so that I only need three movies and I haven't gotten
a pop-up because even though I know that for example 1997 has three movies." The setting
(`settings.awardsYearThreshold`, itself the fix for an earlier "an arbitrary number that I
came up with for me") was read correctly by `PersonalAwardsModal.yearsEligibleForAwards`
and by `awardsBrowsableYears` — but Home's `shouldShowAwardsModal`, the gate that decides
whether the prompt appears at all, carried its own inlined copy of the count with a
hardcoded `>= 10`. So lowering the number changed every screen except the one that offers
you the work, which is the only one she would have noticed. The count is now
`yearsMeetingAwardsThreshold` in `personalAwards.js` and there is one copy of it. The
"does this year still need work" predicate is deliberately *not* unified: three callers
answer it three slightly different ways (stored `availableMovieIds` vs rating dates), and
collapsing them was a bigger, riskier change than the bug called for.

**"Is it just once a day?"** Matt, on the same prompt: "I'm just curious if I will see
more than one prompt for personal awards per day and maybe that's a setting we ought to be
able to do kind of like we do for tiebreakers. Maybe we ought to go ahead and set that for
stickiness and personal awards." Three chores, three different answers to one question,
and only one of them (tiebreaks) was the user's to change: awards were hardwired to one
completed year per calendar day, and stickiness had no limit at all. `promptQuota.js` is
now the single answer, spacing rather than counting — N a day means no sooner than
`24h / N` after the last one, the shape the tiebreak setting already had.

Two things that shaped it:

- **Blank had to keep meaning "no limit" for stickiness.** Defaulting an unset
  `stickinessPromptsPerDay` to 1 would have been a regression shipped as a feature, so
  `promptsPerDay` returns `null` — a real answer, distinct from a missing one.
- **Legacy data reads as a timestamp rather than being migrated.** Every account carries
  only `lastAwardCompletionDate`, a `toDateString()` value that the old gate compared to
  today. `lastAwardsPromptAt` reads it as the start of that day, which reproduces the old
  behaviour exactly at one a day and needs no write.

The first draft put the quota check inside `shouldShowAwardsModal`'s "have settings
loaded yet" branch, where it only ran for users who had completed a year before. A test
for `awardsPromptsPerDay: 0` caught it.

**The motion permission asked once per screen, forever.** "It's annoying how often cinema
roll is now asking me for permission to detect motion. Honestly, if we can't reduce the
number of times that it asks then we should just get rid of that feature." The banner
tilt effect is built by three components — Header, MovieDetail, RateMovie — and the
permission state was a closure variable inside each `createBannerParallax`. Every movie
opened made a fresh instance that knew nothing, called `requestPermission()`, caught the
"needs a user gesture" rejection, armed its own click listener, and put the iOS dialog in
front of the next thing tapped. Denying didn't help: the `denied` flag died with the
instance and with the page.

The answer now lives at module scope and in `localStorage`: one in-flight request that
later instances await instead of queueing another dialog, one armed gesture listener, and
a "no" remembered on the device. A remembered "no" with no way back would be a trap, so
Settings grew a **Banner tilt effect** switch (`settings.bannerTilt`) that forgets the
stored answer when turned on — which is also Matt's stated fallback of getting rid of the
feature, in his own hands. The regression guard mounts three parallaxes on one window and
asserts exactly one armed tap between them; with the single-flight line removed it reads
three, the bug's real signature.

**A friend's recent films stopped at four.** "In film club, we show lists of each friend's
recent movies but they seem to be limited to just four movies. We should increase that so
it's a scrollable horizontal list. Don't mess with the size of the posters just load more.
And we don't want to load thousands of movies every time so these should be lazy loaded
only when I scroll to see more." The cap was `friendSnapshot`'s `recentCount = 4`, while
the published profile has carried 40 since "the recent feed on my film club could be
larger". `friendSnapshot` now returns everything and how many render is the screen's
business: eight at rest, eight more each time you scroll within a poster's width of the
end. Poster size is untouched, as asked. Lazy loading here is about image requests, not
data — the forty items are already in memory; it is forty `<img>` elements per friend that
would have hit TMDB.

## The anchor pickers were dead for six days (2026-08-30)

Natalie: "I try edit on my five in the library settings to change my normalized reading
it just crashes and removes all the normalized settings from the screen."

Both anchor pickers — "My lowest rated 10" and "This is a 5" — threw the moment they
opened. `pickerPool` and `pickerCandidates` were gone from `RatingCurveSettings.vue`'s
`computed` block, deleted by 47c58d1 ("Chart the two distributions, not the transfer
function", 2026-08-24). That commit rewrote `curveChartOptions`, which sat immediately
above them, and the two computeds went out with the tail of the same hunk. Nothing in
the diff mentions them; the commit message is entirely about the chart.

Her description is exact about the failure MODE, and the mode is the interesting part.
`openPicker` sets `this.picking = key` FIRST, then calls `resetPickerWindow()`, which
reads `this.pickerPool.length` and throws. But `picking` is already set, so the
`v-if="picking"` picker block has entered the render, where the template reads
`pickerCandidates.length` and throws again — this time during render, which is what tears
the whole section off the screen. "Crashes AND removes all the normalized settings" is
two symptoms of one missing pair, and a fix that only guarded the method would have left
the second half.

**The suite was green throughout.** `RatingCurveSettings.test.js` covered the curve
preview thoroughly — chart data, both series, the ladder table, the low-share warning —
and never once opened a picker. 2,988 passing tests, and the feature the component is
NAMED for had no coverage at all. That is the durable lesson, now in
`.claude/rules/testing.md`: coverage concentrated on the part of a component that was
most recently interesting says nothing about the rest of it, and a deletion is exactly
the kind of regression a green suite is supposed to make impossible.

Six new tests mount the picker for real and go through the DOM, not the vm: tapping
either anchor poster, tapping the empty slot's "Choose a movie" button, the
below-the-ten-anchor filter, search narrowing, and that choosing a card writes the
dbKey and closes the sheet. Asserting on `wrapper.vm.pickerCandidates` alone would have
caught the method's throw but not the template's, and the template's is the half that
blanks the screen.


## Three from one evening: the push that beat its own snapshot, the score switch, and Ties (2026-09-06)

**"I get a notice that my friend rated the movie but when I click on the notification,
it takes me to the movie and I don't see their rating included there."** Seth logged
Coyote vs. Acme at 3:14pm; Matt's report came at 3:37pm from `/movie/1204680`. The
production probe (Admin SDK) showed Seth's profile snapshot carrying the rating — by then.
Two roads could have left the page blank at 3:37, and the data can't say which, so both
were closed:

- **The rater's side.** `RateMovie` fired `announceLoggedMovie` and
  `publishSocialProfileNow` in the same breath, push first. The push is what makes a
  friend open the page, so it now leaves only when the publish promise resolves; a failed
  publish withholds it (the repo's standing rule: a notification for something the club
  cannot show is worse than a later one). Two new tests in `FriendLogAnnounce.test.js`
  hold the order and the withholding; reverting the chain fails both.
- **The reader's side.** Friend profiles are one-shot `get`s. An app open since morning
  holds the morning's snapshot, and `ensureClubData` only ever fetched what was *missing*.
  `clubFetchesNeeded` gained `fetchedAt`/`maxAgeMs`; `FriendsWhoSaw` asks for a copy no
  older than five minutes. The 2026-08-29 fix made the pills fetch their own data; this
  makes them fetch *current* data. Not the default for every surface — profiles are
  ~100KB each.

Not verified on the phone: whether iOS reloads the PWA on a notification tap or steers the
running one. The two fixes cover both.

**"You should have the option in your notifications to turn off the score."** A new
push pref, `friendLogScores` (default on), an indented switch under "A friend logs a
movie" in Home's Notifications card, and `pushCadence.friendLogBody`, which the Lambda now
calls so the choice is in the one tested file under `aws-lambda/`. Lambda redeployed from
the previously deployed zip's `node_modules` plus the repo's two source files.

**"Would be cool if I could see how many ties there are in the whole database."** A Ties
section on `/stats`, between Marathon Club and Years. The definition is the tournament's:
exact `calculatedTotal` equality at the fourth decimal (`findTiedGroup` is reused to name
the next-up group, so the two screens cannot disagree). Strip of four numbers, the next-up
group as a poster row, then the biggest ties by size. Two films that merely display the
same 7.16 are not tied, and `deepStats.test.js` says so — grouping at 2dp fails it.

## 2026-09-15: a stale clock, a spelled-out number, and a redundant caption

**"I just got a notification that said that District 9 was ready for its stickiness
rating. I tapped on that notification on my lock screen and opened up Cinema Roll to the
home screen but did not show me District 9 or any notification on there, any banner about
stickiness."** (-P1_e7pw0t5rtO7vlFj4, and -P1Xo9Blv0-axmB4zrWL thirteen hours earlier.)

The third report of this shape in three weeks, and the first two fixes were both correct
and both aimed at something else — 2026-08-28 taught the digest to publish the quota gate
so a push could not name work the app would refuse to show, and 2026-09-14 taught Home to
read `?open=` on a warm launch as well as a cold one. Neither was the cause this time.

Reproduced from production before touching anything, which is what made it findable.
District 9 was rated 2026-03-17, had already answered its one-week prompt, and crossed its
SIX-MONTH boundary at 15:19:36. The Lambda swept at 15:20:45 and named it correctly. Matt
tapped 37 seconds later. Everything downstream checked out: the quota gate was open, no
tournament was pinning the screen, and the URL he filed from had already been stripped of
`?open=`, which is proof the previous fix was working.

The cause was one line that had been there all along:

```js
const moreThanAWeekAgo = ratingDate < new Date().getTime() - ONE_WEEK
```

inside a computed whose only reactive dependency was the entries array. Vue re-runs a
computed when a dependency changes; the wall clock is not a dependency. On an installed
PWA that had been in memory since before the film matured, `resultsThatNeedStickiness`
held the empty list it computed when the library last changed, and held it permanently.
The push fires at the exact instant a film matures, so a notification tap is precisely the
moment this is guaranteed to be stale — which is why it only ever showed up as "I tapped
the notification and there was nothing there", never as ordinary use being broken.

`stickinessCandidates.js` now takes `now` as an argument, `Home.promptNow` is a reactive
clock, and `refreshPromptClock()` moves it on an interval, on `visibilitychange`, and on
the notification tap itself. The foreground handler is the one that carries this on a
phone — iOS suspends a backgrounded PWA's timers, so the interval never fires while the
app is away and can be half an hour late when it returns.

Two things fell out of putting the rule in one place. The candidate list existed three
times over (Home, StickinessInline, and pushDigest in its own shape), and the copies had
drifted: the digest picked the LAST rating in the array while both components picked the
latest-DATED one, so a rewatch logged out of order could be pushed about and then not
shown. And both component copies called `getRating` five times per entry across a filter
and a sort comparator — the exact trap CLAUDE.md names — over the whole library.

**"When I search for the movie 9 to 5, it doesn't come up even though I know I've rated
it."** (-P1_JRO10YcGNAXX0zzk.) He had rated it forty seconds earlier. The library holds it
as "Nine to Five", which is what TMDB called it that day; TMDB calls it "9 to 5" now.
"9to5" and "ninetofive" share no characters, so neither normalization nor the fuzzy
fallback could reach it, and a library picks up whichever spelling TMDB held per entry —
so this is a coin toss every entry makes, not one film's problem.

`numberWords.js` folds number words to digits on both sides. The design decision worth
keeping is comparing TOKENS rather than substrings: fold "seven" to a bare "7" and ask
whether the loose title contains it, and searching "seven" returns 1917. There is a test
for that, and it fails against the substring version.

**"In the nominees pane we don't need the name of the movie below the poster."**
(-P1_WpzyTRahOiZTWLK2.) Each Current Nominees poster carried its own title beneath it,
truncated at nine characters plus an ellipsis, so The Empire Strikes Back read "The
Empir...". Gone for movie categories. Acting categories keep theirs — that caption is the
person's name over a headshot, plus the roles, and no image says any of it.

## Empty watchlist rows, and the notification that went home (Sep 2026)

Two reports from Matt's phone, a day apart.

### "From directors you love" was empty, and the rows never changed

*"Some of these lists are empty like it says from directors you love and it says
zero of 13 watched but there's just nothing there and some of these lists don't
seem like they've updated in weeks... I would like these lists to be reevaluated
each time I load the page or maybe once a day."*

Probed against the live library before touching anything (`favoritePeople` →
TMDB credits → `rankWatchlistCandidates`, then checked the result against his
punts and his six hats): the directors row's top twelve were **all twelve in a
hat**. The screen hid hatted and punted films in `mediaItems`, i.e. AFTER
`rankWatchlistCandidates` had already capped the row at 12 — cap to 12, hide
12, show nothing. This is the same shape as the 2026-08-19 rewatch-row bug
(cap, then filter, leaves a permanent gap), which had been fixed for the
library-derived rows but not for the TMDB-fed ones; the comment on
`skipFromSuggestions` even claimed punts were "excluded INSIDE the candidate
builders", which was only true of `rewatchCandidates` and `anotherShotCandidates`.
The "hasn't updated in weeks" half is the same cause seen from the other side:
the ranking is deterministic, so every visit re-derived the same twelve, and
once he'd hatted them the row had nothing else to say. With 614 ids across his
hats, every row on the screen was shrinking the same way.

Two changes in `discover.js`:

- `rankWatchlistCandidates` takes `exclude`, applied before the cap (mirrors
  `rewatchCandidates`), and keeps `score` on each result.
- New `dailyPick(pool, now, { cap, reach, exclude })`: drops excluded films
  first, then picks `cap` of the top `reach` (default 2×cap) with a shuffle
  seeded by the calendar day — stable across reloads, different tomorrow — and
  shows them in rank order with match % rescaled to the visible row. A pool no
  bigger than the cap is shown whole.

`WatchlistScreen` now ranks each TMDB-fed row to a pool of `RANK_POOL` (36) and
renders `showing(pool)` — a computed closure over `skipFromSuggestions`, so
hatting a film from a row promotes the next candidate immediately (punts and
`movieHatMovieIds` are reactive) instead of leaving a gap until the next visit.
That also sidesteps the ordering problem where `ensureMovieHatContents` could
land after the pool was built. The learning loop records the shown slice, not
the pool. Tests: `discover.test.js` (exclude-before-cap, `dailyPick` × 5),
`WatchlistScreen.test.js` (a hatted film at the top of a 13-deep row is replaced
by the 13th, not left as an 11-film row); each confirmed failing with the bug's
signature against the reverted code.

### A friend's log for a film you haven't seen took you home

*"When a friend logs a movie that isn't in my library, tapping the notification
should take me to my film club."*

`push-notify.js` sends the friend-log push with `navigate: /movie/<tmdbId>`
regardless of whether the recipient has rated it (it can't tell). `MovieDetail`
is a pure local lookup and its not-found branch pushed `/` — so the tap looked
like it did nothing. The fallback is now `/film-club`: in practice a friend's
activity is the only way to arrive at an unrated id. One-line change, one test
(`MovieDetail.test.js`).
