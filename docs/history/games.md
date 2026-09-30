# Games — development history

> Archived from CLAUDE.md. Verbatim post-mortem narrative, kept for the hard-won
> detail. Durable rules extracted from this live in `.claude/rules/`.

## Games Section (Jul-Aug 2026)

A `/games` hub of ten games built entirely from the user's own rated library. **All game rules live in plain, store-free modules under `src/assets/javascript/games/`**, unit-tested without mounting anything; components in `src/components/games/` are thin wiring + presentation. `src/mixins/gameData.js` supplies `eligibleGameEntries` (entries with a poster, release date and ≥1 rating, respecting `settings.includeShorts`), `gameRatingFor`, `gamePosterUrl`, `recordGameWin`, `GAME_ICONS` and `lastPlayedGamePath`.

> **This section was condensed in Aug 2026.** It had grown to 169 KB of round-by-round design narrative — every banner revision, every animation attempt — which is sent on every request. The full blow-by-blow is in git history before the "Trim CLAUDE.md" commit. What follows is the part worth re-reading.

### The ten games
| Game | Route | Shape |
|---|---|---|
| Higher or Lower | `/games/higher-lower` | Tap the poster you think scored higher. Streak. |
| Reel Wordle | `/games/wordle` | Guess a library movie from year/decade/director/genre/runtime/rating clues. Unlimited guesses. |
| Connections | `/games/connections` | Four groups of four, by director/genre/decade/cast/keyword/title/awards. Unlimited guesses. |
| Six Degrees | `/games/six-degrees` | Build a shared-cast-or-director chain between two movies. |
| Timeline | `/games/timeline` | Place a movie into a chronological row. Streak. |
| Clue Budget | `/games/clue-budget` | Spend $100 on clues, then name the movie. |
| Tag | `/games/tagline` | Match a real tagline to one of 4 posters. Streak. |
| Trivia | `/games/trivia` | Claude-generated facts, hardest first. ONE guess. |
| Stamp | `/games/stamp` | Swipe to confirm/remove a keyword across movies. Writes to the library. |
| Poster Zoom | `/games/poster-zoom` | Name a movie from a 16x crop; tap the poster to zoom out. |

All `requiresLogin`. Entry point: a button in Home's results-actions row (`goToGames()`).

### Conventions that apply to every game
- **Mobile-first: `:active` only, never `:hover`** — a tapped element keeps a hover state on iOS with no mouse to leave it. This has been shipped as a bug more than once.
- **Persisted games store identity, not derived data.** `localStorage` under `cinemaRoll.<game>.current`, holding entry KEYS; the entry objects are re-resolved from the current library on restore, falling back to a fresh round if a movie is no longer eligible. **A finished round is never resumed.** Exception: Trivia persists its facts, because Claude's output isn't deterministic and re-fetching would hand back different ones.
- **Wait for the library, don't read it once.** Use `watch: { eligibleGameEntries: { immediate: true } }`, not `created()`. A direct/deep-link load mounts before Firebase data arrives, and a one-shot read strands the game on "not enough movies" forever. This was a real bug in Six Degrees and Connections.
- **Exclude the round you just finished** when picking the next target, falling back to the full pool if that would leave nothing. Two separate "it keeps repeating" bug reports traced to this being missing.
- **Staleness guards must compare `entryKey`, not object identity.** Vue wraps `this.target` in a reactive proxy, so `!==` against a raw captured object never matches and the guard silently never fires. Hit in ClueBudget, Trivia and Poster Zoom.
- **Custom banner per game**: `created()` saves `bannerUrl` and swaps in the game's own art plus `setHideHeaderLogo(true)`; `beforeUnmount()` restores both. All store calls optional-chained (`$store.commit?.()`) since several test mocks stub `$store` bare.
- **Shared styling**: `_game-buttons.scss` (`.btn-game`, `.btn-game-primary/secondary`, `.full-width`, `.end-actions`) and `_game-inputs.scss` (`.game-input`), `@import`ed into each component's scoped style block.
- **`.end-actions`** is the end-of-round row (primary action + "Back to Games"). Labels must not wrap — sharing the row halves each label's width, and a wrapped label makes one button taller than the other.
- **Unlimited guesses, no hard loss state** is the house rule (Connections, Reel Wordle). Trivia is the deliberate exception: one guess, so you can't brute-force the suggestions list.
- **`padding-top` on the game root** is a safety margin, not decoration: `BackLink` is fixed at (6,6) of the viewport whether or not the header currently has height.
- **Typeahead dropdowns**: the panel styling goes on `.suggestions` (background, border, `position: absolute`, `max-height` + scroll); rows stay transparent. Styling each row as a bordered card reads as a stack of separate boxes, and an absolute panel doesn't push the buttons down the page.

### Per-game notes worth keeping
- **Reel Wordle** — clue cells are a fixed `repeat(6, 1fr)` grid with `min-width: 0` and ellipsis; wrapping or horizontal scroll here has been reported twice. Genre shows an explicit fraction ("Drama (1/2)") because colour alone couldn't distinguish an exact set match from a partial one. Guess history renders newest-first via a `displayGuesses` computed; the underlying array stays chronological.
- **Connections** — `buildCandidateCategories` finds values shared by 4+ movies, then `generateConnectionsPuzzle` claims 4 with no movie in two answer keys. Difficulty tiers by kind (decade=1, genre=2, director/cast/title/awards=3, keyword=4), picking one per tier before falling back. **Breadth caps matter**: keywords 5-10 movies, genres ≤10% of the library — without them "Adventure" (212 movies) becomes a category and four random Dramas share nothing noticeable. Wrong guesses assign stable 1-4 hint numbers to the overlapping tiles.
- **Six Degrees** — TWO graphs: `graph` (cast capped at 10 per movie, directors exempt) for puzzle generation and shortest-path, `playGraph` (uncapped) for the player's autocomplete and hints. Reusing the capped one for suggestions made real connections invisible. `scorePathDifficulty` is a weighted composite: hops 0.4, billing 0.4, year gap 0.1, age 0.1. Chain row scrolls horizontally and auto-scrolls to keep the newest entry visible.
- **Timeline** — placement is a 3-step choreography (fly to gap → expand with flanking gaps → insert), all driven off one `stepDurationMs`. **The hard-won lesson: a helper that mutates reactive state as its last act, followed by more mutations in the caller, paints an intermediate frame** — `await` yields to Vue's scheduler in between. Keep them in one synchronous block. Also: `v-for` keys must be identity-based, not array indices, or insertion makes Vue reuse the wrong DOM nodes.
- **Clue Budget** — clue prices come from real TMDB signals (person popularity, keyword rarity via `/discover` `total_results`, company prolificness), with fixed fallbacks so a round is playable before any fetch resolves. **Purchased clues are snapshotted at purchase**, not re-derived, so a price arriving later can't retroactively change what you paid.
- **Trivia** — facts come from the `/trivia` AI lambda route. One guess per round.
- **Stamp** — the only game that WRITES to the library (`customKeywords`/`removedKeywords` leaf paths via `writeDurably`, offline-safe, only when something actually changed, with undo). Removal is asymmetric: a TMDB/AI keyword can't be deleted, so it goes on `removedKeywords`, which `computeFlatKeywords` subtracts. Judge blind — no "already has it" marker.
- **Poster Zoom** — see its own section below.

### Testing traps specific to games
1. `new Date('YYYY-01-01')` parses as UTC and shifts a year/decade in this repo's timezone — use mid-month dates in fixtures.
2. State set in `mounted()` isn't visible to a synchronous post-mount assertion; prefer `created()` for pure data setup.
3. `gameData.js` optional-chains `this.$store.state` itself — several mocks stub `$store` with no `state`. Don't tighten it without fixing them.
4. Fixtures reuse dbKeys across tests, so persisted `localStorage` leaks between them — `beforeEach(() => window.localStorage.clear())`.
5. To test the empty-then-populated library race, wrap the mock getters in Vue's `reactive()` or the watcher never fires.

**Not built** (designed, deferred): per-game filters, and a shareable Wordle-style result card.

## Custom Banners + Title Trim, Rolled Out to All Four Games (Jul 2026)

Six Degrees went through ~10 rounds of banner/UI iteration (see the section above). Once that landed, the user handed over three more user-designed banner images (same halftone/dot-gradient house style, each with the game's own name + "CINEMA ROLL GAMES" baked into the bottom-right corner) and asked for the generalizable lessons from that whole process to be applied to Higher or Lower, Reel Wordle, and Connections too - "take your time and think on the feedback I've given for the 6 degrees design. Then do your best to make the other ones perfect." This was a judgment call about WHICH lessons actually transfer, not a mechanical copy of every Six Degrees change:

- **Applied to all three** (clearly general-purpose):
  - **Custom banner + hidden logo**: each game's source PNG (2560×1440, ~3.7MB) was resized/re-encoded the same way as Six Degrees' - `sips -Z 1200 -s format jpeg -s formatOptions 82` → `src/assets/images/games/{higher-lower,reel-wordle,connections}-banner.jpg`, ~250-310KB each, visually indistinguishable at display size. Each component's `created()`/`beforeUnmount()` pair sets/restores `bannerUrl` and toggles `hideHeaderLogo` exactly like Six Degrees (Connections already had a `created()` hook for `start()` - the banner code was merged into it rather than adding a second `created()`, which isn't valid on a single component options object).
  - **`<h1>` title removed from all three** ("get rid of the title of the game and instead just have the description" - originally Six-Degrees-specific, but doubly justified everywhere now that every banner graphic has the game's name baked in, making an on-page `<h1>` genuinely redundant twice over). Each game's `.game-title` CSS rule is gone; whatever now renders first (`.game-subtitle` for Wordle/Connections, `.setup p` / `.streak-row` for Higher-or-Lower, which has no single persistent subtitle across its two states) picked up a `margin-top: 0.75rem` to preserve the h1's old top spacing.
  - **Banner tap-to-home** required no new work - it's the global `Header.vue` fix from the Six Degrees round, and applies automatically to any game that sets a banner.
- **Applied to Reel Wordle only** (Connections/Higher-or-Lower don't persist state at all, so the bug can't occur there): **a solved puzzle is no longer restored on the next visit**, mirroring Six Degrees' "don't resume a finished round" fix. `loadOrStartPuzzle()` now checks whether `saved.guessedKeys` contains `saved.targetKey` (i.e. one of the past guesses WAS the target - a win) and, if so, falls through to `startNewPuzzle()` instead of reconstructing the solved state.
- **Deliberately NOT applied** (considered and rejected as not actually fitting):
  - **Compact/rectangular button treatment**: this was specific to a bespoke Six Degrees control (the difficulty segmented picker); the other three games use the shared `.btn-game` pill styling, which was an intentional, separately-established design (see "Custom button look, scoped to Games" above), not something flagged as a problem.
  - **Dropping redundant labels under posters**: Six Degrees' placeholders had a genuine "unknown identity" to hide; Higher-or-Lower's title (always shown, only the SCORE is hidden), Wordle's guess titles, and Connections' tiles (which already dropped their captions in an earlier round) don't have an analogous redundant label to remove.
  - **"?" placeholder slots / horizontal scroll**: only meaningful for Six Degrees' open-ended, growing chain; the other three have fixed-size layouts (2 cards, a 4×4 grid, a vertically-stacked guess list) with nothing analogous to fill or overflow.
  - **Win-message-to-top**: reconsidered case by case rather than copied - Higher-or-Lower already surfaces status via an always-rendered top-of-page `.status-line` (an earlier, unrelated fix); Wordle's win banner pairs its message with a poster-reveal reward that would lose context if hoisted above the fold; Connections' win banner already appears exactly where the tile grid was, which reads as a natural continuation of solving the last group. None of these had the specific "buried, verbosely-worded box" problem Six Degrees' `.result-banner` had.
  - **Auto-complete-style friction reduction**: no natural equivalent found in any of the three (Higher-or-Lower is a binary tap, Wordle requires typing the exact title, Connections requires an exact 4-tile selection) - nothing to short-circuit the way "a person who's also in the target" could in Six Degrees.

Tests: banner set/restore + logo hide/show pairs added to `HigherLowerGame.test.js`, `ReelWordleGame.test.js`, `ConnectionsGame.test.js` (same shape as Six Degrees'); `ReelWordleGame.test.js` also gained the won-puzzle-not-resumed case. No test referenced the removed `<h1>`/`.game-title` in any of the three, so none needed updating for that part.

## Two "keeps repeating" bug reports fixed together (Jul 2026)

Three unresolved in-app bug reports (`yarn fetch-bug-reports`), two of which were the same underlying bug filed twice on different days. Both traced to the identical root cause pattern: a "pick something new" routine with no memory of what was JUST shown, so a small-enough candidate pool had a real, non-negligible chance of repeating.

- **Tag (`TaglineQuizGame.vue`) repeated the same tagline in back-to-back rounds.** `startNewRound()`'s candidate search (`attemptedKeys`, reset fresh every round) had nothing excluding the round that had JUST finished — Reel Wordle's `startNewPuzzle()` already solved this exact problem for itself (`excludeKey`), but the fix was never carried over here. Fixed the same way: `previousTargetKey` (captured from `this.target` before it's reset) is filtered out of the candidate pool for that round, with a graceful fallback — if excluding it would leave ZERO candidates (a genuinely tiny library, or one where every other candidate already failed the tagline check this round), the exclusion is dropped rather than dead-ending on "no tagline found" when a perfectly good repeat candidate exists.
- **Six Degrees' "Give me one" hint kept suggesting the same person** ("kept giving me Bruce Willis over and over again"). `nextHintStep`'s MOVIE branch always returned the raw BFS shortest-path's own next person, with no exclusion — unlike the PERSON branch, which already excluded `usedMovieKeys`. A well-connected hub actor sitting on the shortest path could dominate every single hint in a chain. Fixed by adding a `usedPersonNames` parameter (default empty, so existing callers with nothing used yet are unaffected): the natural shortest-path person is still preferred when unused (keeps hints matching the puzzle's own notion of "optimal" in the common case); when they're already in the chain, it scans every OTHER person credited on the current movie (via the capped `graph`, matching puzzle-generation semantics) for whichever unused connector's own best movie yields the shortest remaining path, mirroring the person-branch's own "iterate candidates, pick shortest" logic one level up; if truly nobody else connects this movie toward the target at all, it falls back to reusing the excluded person rather than returning no hint. `SixDegreesGame.vue`'s `giveHint()` now passes its existing `usedPersonNames` computed (previously only used for autocomplete-suggestion filtering) into the call.

Tests: `sixDegrees.test.js` — a two-parallel-2-hop-path fixture ("Hub" is the naive first-found connector, "Alt" is the alternative) verifying the natural pick, the fallback when Hub is excluded, and the last-resort reuse-Hub case when Alt doesn't exist either. `TaglineQuizGame.test.js` — a deterministic `Math.random` stub (always picks the first candidate) proving round 2's target excludes round 1's, which would fail on the old code (always re-picking the same first-in-array movie).

## Three more bug reports (Jul 2026): Wordle genre truncation, Trivia one-guess, Trivia poster link

- **Reel Wordle: multi-genre clue text was cut off** ("when I get more than one genre I can't see most of the second word"). The fixed 6-column `.clue-cells` grid's `.clue-value` rule is a hard single-line truncation (`overflow:hidden; text-overflow:ellipsis; white-space:nowrap`) — correct for every other cell (short, fixed-format values: a year, "1990s", an arrow) but genuinely destructive for Genre, whose value can be `"Drama, Comedy (2/2)"` — long enough to lose real signal, not just cosmetic overflow, and with no touch-accessible fallback (the `:title` tooltip only helps a mouse user). Fixed narrowly: a new `.clue-value.wrap` modifier (`white-space:normal; overflow-wrap:break-word`, `overflow`/`text-overflow` reset to not-clipping) applied ONLY to the Genre cell's value — every other cell keeps the original one-line guarantee unchanged. `.clue-cell` gained `justify-content:center` so the other 5 (unwrapped, shorter) cells in the same guess-row stay vertically centered when Genre's 2-line wrap makes that row taller. CSS-only; no test changes needed (matches this file's own established precedent for pure-CSS fixes).
- **Trivia: guessing became one-shot** ("it will be more fun if you only get one guess... that way you can't guess every movie I've ever rated"). The original design let a WRONG guess just cost a clue (unlimited guesses, "Next Clue" and a wrong guess were functionally the same action) — meaning a sufficiently persistent player could just tap through the whole suggestions list one at a time without ever really reasoning from the trivia. `submitGuess()` now always ends the round: correct → `win()` (unchanged); wrong → a new `lose()` (status `'lost'`, all facts revealed, no score/best persisted — same "terminal, no-score" shape as `giveUp()`'s existing `'revealed'` status, just with "Not quite — it was X" messaging instead of "It was X" to distinguish a wrong guess from an explicit give-up). `revealNextFact()` (the "Next Clue" button) is UNCHANGED and still free/unlimited — browsing facts before committing to your one guess costs nothing; only the actual guess is now final. Subtitle updated to state the rule upfront ("You get ONE guess — reveal as many facts as you need before you take it") so a player isn't surprised by a design change from what shipped originally.
- **Trivia: the revealed poster is now tappable** ("when you get the answer... you should be able to click on the poster and go to facts about the movie"). Wrapped in a `<button>` (`goToMovie(entry)` → `$router.push(`/movie/${entry.movie.id}`)`), same navigation Six Degrees' `goToChainItem` already uses for a movie chain-step. Mobile-first `:active`-only tap feedback (scale+opacity), no `:hover`. **Real bug caught by its own test**: the first cut guarded with `if (!entry?.movie?.id) return;` — a bare falsy check, same class of bug as `backfillBoxOffice.js`'s documented `!movie.id` typo — which treats a legitimate `id: 0` as missing. Real TMDB ids are never 0 so this was harmless in production, but it silently broke the test whenever the randomly-picked target happened to be the id-0 fixture. Fixed to `entry?.movie?.id == null`.

Tests: `src/test/games/TriviaGame.test.js` — the old "wrong guess reveals the next fact" test replaced with "a wrong guess ends the round immediately" (status `'lost'`, full reveal, no best-score dispatch, guess form gone); a new "Next Clue is still free and unlimited" test confirming browsing alone never ends a round; a new poster-click-navigates test. The pre-existing "New Round" test's button selector had to be narrowed (`.result-banner .btn-game-primary`) since `.result-banner` now contains TWO buttons (the poster + New Round) — `wrapper.find('.result-banner button')` would otherwise resolve to the poster button first.

## Six Degrees: directors as connectors, auto-scroll, win-comparison path (Jul 2026)

One report, three asks: "In the game of 6° I think I should be able to connect through a director as well as a performer. Also, it would be nice if after each correct [guess] it would scroll to the right for me. And finally it would be nice if at the end when I win, and it tells me what the shortest path was, I could click something to reveal that path. Ideally, it would reveal that path without losing my own path. It would just show me what could've been."

- **Directors are now connectors.** `buildCastGraph` → **`buildPeopleGraph`** (renamed, since "cast graph" is no longer honest — all call sites + tests updated). Cast is still capped per movie (default 10) for the reason that cap has always existed; **directors are deliberately exempt from it** — a movie has one or two, and a director is exactly the kind of strong, memorable connector the cap exists to PRESERVE, not the long tail of bit-part actors it exists to cut. A person who both directed and acted in the same movie merges to one graph node via the `Set`.
  - **Knock-on effect, deliberately left as-is**: `scorePathDifficulty`'s `billingIndexOf` returns `-1` for a director who isn't also in the cast, which every caller already clamps to `0` (top-billed) — so a director-connector scores as maximally prominent. That's correct rather than accidental: the billing component measures how hard a connector is to RECALL, and a film's director is about as recallable as it gets. Documented in-code so it doesn't read as an unhandled `-1`.
  - Subtitle updated to "Connect these two through shared cast members **or directors**."
- **The chain row auto-scrolls right after each new entry.** It's a fixed-height, horizontally-scrolling row that only ever grows, so a new entry landed off-screen. `scrollChainToEnd()` (called from `pick()`, which every guess AND every hint funnels through) scrolls to `scrollWidth` on `$nextTick`, smooth when `Element.scrollTo` exists and falling back to a plain `scrollLeft` assignment when it doesn't (jsdom, very old browsers). The element comes from a **function ref** (`chainRowEl`) rather than a named `ref`, because the row is now rendered inside a `v-for` (see below) where a named ref would resolve to an array.
- **After a WIN you can opt into seeing the shortest path alongside your own** — additive, unlike giving up. This is deliberately NOT the same as `revealPath`: an earlier bug report established that **giving up REPLACES** your row ("when I give up, the shortest path should replace my built path, not show both"), and that behavior is unchanged. New `comparisonChain` data field is kept strictly separate from `revealedChain` for exactly this reason — only `revealedChain` drives `status === 'revealed'`, so showing the comparison leaves the round a `'won'`.
  - **Only offered when there's actually something to show**: `canShowComparison` requires a win AND `optimalHops < hopsSoFar`. A player who already found the shortest path gets no button, because there's no "what could've been."
  - **Template restructured to a `chainRows` `v-for`** rather than duplicating the chain-step markup for a second row. That markup has been through ~10 rounds of iteration (placeholders, delete badges, tap-to-navigate, photo fallbacks) and a copy would inevitably drift. Rows carry `{key, label, items, interactive}`; `interactive: false` is what suppresses delete badges on the comparison row (tap-to-navigate is deliberately left ON there — exploring what could've been is useful).
  - `comparisonChain` is **not persisted** — it's a presentational peek at an already-finished round, and a finished round isn't resumed anyway (see `tryRestore`). Cleared at both round-reset points alongside `revealedChain`.
  - `revealPath`/`showComparisonPath` now share a `linksFromPath(path)` helper instead of each open-coding the alternating movie/person walk.

Tests: `sixDegrees.test.js` — directors as connectors, directors surviving a cast-heavy movie's cap, the director+actor merge case, `shortestPath` connecting through a director alone, and a no-crew-data tolerance case (the fixture gained an optional `directors` argument). `SixDegreesGame.test.js` — the scroll behavior and its fallback tested by calling `scrollChainToEnd()` directly, with a separate spy test that `pick()` triggers it (**a stub assigned to `chainRowEl` before `pick()` gets clobbered mid-update, because the template's function ref re-fires on every re-render** — worth remembering for any future test touching that ref); plus the comparison row's gating, the "adds a row without replacing" assertion, the "giving up still replaces" regression guard, and the new-game reset.

## Three small reports (Aug 2026): year direction, Wordle rating, exit-from-game

- **Year scroller now runs ascending left-to-right** ("the next year should be to the right of the current year, not the other way around"). New `availableYearsAscending` computed rather than flipping `availableYears` itself — that same list also fills the "Add Filter" Year `<select>`, where newest-first is the right default for picking a recent year. One source of truth for WHICH years exist, two display orders. A test pins both orders so they can't be conflated later.
- **Reel Wordle shows the guessed movie's own rating** next to its title, beside the year ("in addition to the year, it would also show me the rating on the movies after I guessed the wrong ones"). `clue.yourRating.value` already held it — it just wasn't rendered. Like the year, this is a plain "what did I guess" label; the Rating CELL below still shows only a direction arrow, so it gives nothing away about the target.
- **"Back to Games" now shares the end-of-run row with Play Again** across Higher or Lower, Timeline, Trivia, Clue Budget and Tag ("on all of the games where there's a play again button we should have that space shared... so we can exit"). Shared `.end-actions` class in `_game-buttons.scss` (two equal halves; overrides `.cta-btn`'s own `max-width`, which would otherwise leave a gap down the middle). The top-left `BackLink` already reaches the hub, but after finishing a run your thumb is at the BOTTOM of the screen — that's where the "I'm done" action belongs. Tag's two near-identical `v-if` blocks (Play Again / Try Again) collapsed into one with a conditional label while doing this.
  - **Test gotcha**: each game's end-of-run block sits inside the `v-else` that requires a started run, so setting `gameOver = true` alone renders nothing — call `start()` first.

## Bug report round, Aug 2026: game navigation + Connections tuning

**"Back to Games" beside "New Puzzle"** (two reports, Wordle and Connections). Both now use the shared `.end-actions` row that Timeline/Trivia/Higher-or-Lower/Tag already had.

**Wordle's "New Puzzle" was too easy to hit by accident** — *"Once you started the game and I accidentally pressed it a couple of times."* It was a full-width button pinned at the TOP, right above the input, and pressing it silently throws the round away. The prominent one now only appears once you've won (in `.end-actions`); mid-round there's just an understated `.give-up-puzzle` text link at the bottom of the page.

**`BackLink` was sending people home instead of back** — *"I'm clicking the back to Games button in 6° and it's just sending me home."* Two compounding causes, both real:
1. `.back-link-edge-swipe` (the left-edge swipe strip) is `position: fixed; width: 20px; z-index: 500`, and `.back-link` sits at `left: 6px` with **no z-index** — so the swipe strip painted over the leftmost ~14px of the link, *including part of the caret*. Taps there hit the strip, which only responds to a real swipe, so they did nothing.
2. The link is a small target sitting **on top of the header banner, which is itself tap-to-home** (added so a game hiding the logo still had a way home). Any near-miss therefore navigates home.

Fixed by giving `.back-link` `z-index: 600` (above the strip) and a proper touch target (`min-height: 40px`, roomier padding). The banner's tap-to-home was deliberately left alone — it was explicitly requested, and `.version-only` isn't a big enough affordance on its own.

**Connections genre breadth** — *"you should try to avoid using genres keywords that have a lot of [entries], for example adventure."* Keywords were capped at `KEYWORD_MAX_MOVIE_COUNT` but **genres had no cap at all**, so Adventure (212 of ~1,370 in the real library) and Drama (718) were valid categories — and four films drawn at random from 212 share nothing a player can notice. New `GENRE_MAX_LIBRARY_FRACTION = 0.1`, expressed as a **fraction** so it scales with the collection rather than being tuned to one library, floored at `GROUP_SIZE` so a small library still gets genre categories. Measured against the real library it keeps Western/War/Music/Horror/Documentary/History/Animation/Mystery/Family/Fantasy and drops Drama, Comedy, Thriller, Romance, Action, Adventure, Crime, Sci-Fi. **Decade is deliberately NOT capped** — it's the tier-1 easy way in, and "released in the 2020s" is a crisp checkable fact where "these four are Dramas" isn't.

**Does Connections use user tags?** (asked, not a bug) — it uses `computeFlatKeywords`, i.e. TMDB keywords + AI keywords + the user's own `customKeywords`, minus `removedKeywords`. It does **not** use *viewing tags* (`settings.tags['viewing-tags']`, attached per-viewing), which are a separate concept in this app. Not changed — that's a feature decision, not a defect.

**Not reproducible: Six Degrees' Spielberg report** — *"I use Steven Spielberg as a cast member and then it did not connect to the movie that Steven Spielberg directed."* Investigated against the REAL library rather than by inspection alone: built the actual `playGraph` and confirmed Blues Brothers resolves 66 people including Spielberg, and `moviesByPerson['Steven Spielberg']` resolves 32 films including the ones he directed. `pick()`'s auto-complete uses the uncapped graph, `usedMovieKeys` only holds chain movies, and suggestions aren't over-filtered. **No speculative fix was shipped.** Knowing which target movie she was heading for would make it findable.

## Stamp (Aug 2026)

Pick a keyword, then swipe through movies confirming or removing it. `stamp.js` (pure) + `StampGame.vue`.

- **It works on KEYWORDS, not viewing tags.** Built against `rating.tags` first and that was wrong. Two different concepts live side by side: `rating.tags` (per-viewing, user-authored, assumed correct) and `movie.keywords`/`chatGPTKeywords`/`customKeywords`/`removedKeywords` (per-movie, mostly machine-authored — what this game tidies). Confirm which is meant before building.
- **You judge blind** — no "already has it" marker; seeing the answer anchors the judgement. The reveal is the tally at the end.
- **Writes are asymmetric**: a removed keyword may come from TMDB or the AI, so it can't be deleted — it goes on `removedKeywords`, which `computeFlatKeywords` subtracts. Re-adding just drops it from `removedKeywords`.
- **Only writes when something changed** (`resolveSwipe` returns `added`/`removed`/`confirmed`/`declined`/`passed`; only the first two write), to leaf paths via `writeDurably`, reading the entry fresh from the store at decision time. Has undo.
- **Candidate selection**: the movies already carrying the keyword ARE its definition; everything else is scored by resemblance (`affinityScore` — director 4, keyword 3, cast 2, genre 1, decade 1, with per-movie caps). A round is 6 tagged + 10 high-affinity + 4 random; the random ones are a deliberate control so the game can surface what the scoring is blind to.
- Keyword eligibility is bounded 5-40 movies — one-movie keywords teach nothing, and "friendship" (359 movies) has no confirmable through-line.
- **Card stack**: renders `stackDepth` cards deepest-first so the next posters are already decoded — the original one-card version waited on a network fetch per swipe. Commit on distance OR velocity (velocity measured over the tail of the gesture, so a long drag ending in a flick counts). `will-change` is scoped to the top card while dragging only.
- **`transform` only, no `filter`/shadow** during drag — that combination left visual trails on a real device in Timeline.

**Found here, applied globally: an invisible full-height overlay for a gesture will cover real content.** `BackLink`'s edge-swipe was a fixed 20px-wide div at `z-index: 500` that had been silently eating taps on the left-hand button of every game screen. It now listens on `window` and filters by where the touch started.

Tests: `stamp.test.js`, `StampGame.test.js`.

## Games hub redesigned around the banner art (Aug 2026)

Feedback: *"it's just a fairly basic list of them all stacked. I think we could do something nicer for each of them and maybe make it a bit more compact."*

Every game already had bespoke banner artwork — its own icon, palette and slab-serif name — that it swaps into the header on entry. The hub was showing a generic amber Bootstrap icon instead and ignoring all nine. So the tiles now use that art.

- **One column of icon+name+paragraph → a two-column grid of 16:9 art tiles**, going 3-up at 600px and 4-up at 900px. Two across even on a phone: nine stacked full-width tiles were most of the old page's height, and the art stays legible at half width (~173px).
- **No name is overlaid on the art.** The artwork already carries the game's name; adding our own label would sit a second copy directly on top of the first.
- **Captions cut to one short line each** ("Which movie scored higher?"), which is what actually keeps every tile the same height and the grid even.
- **Won-today checkmark** moved onto the art as a corner badge, on a dark disc so it stays legible over any of the nine palettes. Still green rather than amber, still purely a marker that never gates play.

Two things measured rather than assumed while building it:
- **A 2:1 crop with `object-position` was tried and rejected** — it only saved 78px and risked cutting the composition of nine differently-laid-out banners (Trivia's "?" is top-left, Timeline's hourglass is left with the name bottom-right, etc.).
- **Reserving two caption lines was tried and rejected** — it left visible dead space under every one-line caption, 75px across the grid. The `-webkit-line-clamp: 2` stayed as a safety net for very narrow screens, but nothing reserves the space up front.

A screenshot suggesting the right column ran off-screen turned out to be a **screenshot-scaling artifact**, not a layout bug — `document.scrollWidth === clientWidth` throughout. Worth measuring before chasing.

Test note: `GamesHub.test.js` identified tiles by `.game-tile-name`, which no longer exists. It now reads the artwork's `alt` (the game name), which is the accessible equivalent.

## Poster Zoom (Aug 2026)

The tenth game, added so the hub grid is two full columns. A poster opens at an extreme crop and zooms out a step at a time until you name it; fewer zoom-outs is a better score. `posterZoom.js` holds the ladder, focal-point selection, crop geometry and scoring; the component turns those into CSS.

**Current shape:** ladder `[16, 11, 7.5, 5, 3.4, 2.3, 1.6, 1]`, posters fetched at TMDB's `original`, tap the poster to zoom out, "Give up" as an understated link, and a win outlines the region you actually saw.

### Things that cost real time — don't redo them
- **Tightened three times** (4.5x → 8x → 16x) because each opening was still guessable. Going tighter costs sharpness, which is why the fetch moved to `original` (measured across ten library posters: 1000x1500 to 2000x3000, vs w780's fixed 780x1170; the big ones are 1-2MB).
- **A random focal point is unplayable at these zooms** — sampled crops came back as flat sky or a plain black rectangle. Candidates are now scored against the real pixels (`zoomOriginCandidates` + `pickMostInterestingOrigin`, with the component supplying a canvas-based variance sampler) and the sampling canvas scales with the opening zoom. Best-effort: any failure falls back to a random point.
- **TMDB image CDN DOES send `access-control-allow-origin`.** An earlier note here claimed otherwise and called pixel inspection impossible. The load that "proved" it failed only because the image was already cached from a no-cors request, and Chrome won't reuse that entry for a CORS-mode request. **A failed CORS image load is not evidence about the server's headers — check them with `curl -I -H "Origin: ..."`.** The display `<img>` also sets `crossorigin` so both share one cache entry.
- **Fitting on a phone took four attempts.** A 300px-wide 2:3 poster is 450px tall on its own. A `vh` fraction can't work — it has no way to know the header banner's height, which is 16:9 of the SCREEN WIDTH on a phone. `height: 100%` on a flex-sized row silently does nothing (a flex-determined height isn't definite enough for a percentage). Cross-axis `stretch` sets the height but lets flex pick the width, giving a landscape box from a 2:3 ratio. **What works:** cap the root to a JS-measured available height, and set the poster's `max-height` from the measured stage height — capping by height is what makes `aspect-ratio` derive the width. The measurement subtracts everything rendered below (an early version missed the app footer exactly).
- **Any check of this screen's height MUST force the mobile header** (`.random-banner { display: flex }`, `.top-posters { display: none }`, container at 390px). `.random-banner` is `display: none` above 600px, so a desktop-width measurement is of a layout no phone ever sees — this produced a confident "it fits" that was wrong by 240px.
- **The poster gave itself away twice.** The `transform` transition animated from the previous round's revealed `scale(1)` up into the new tight crop; and even fixed, the crop jumped when scoring resolved. Reveal is gated on `posterReady = imageLoaded && originSettled`, and the transition only exists on `.zoom-image.ready`. A resumed round sets `originSettled` immediately.
- **A dead poster URL** used to render as a black square you were asked to identify. A failed load adds the movie to `failedPosterKeys` (filtered out of `zoomablePool`) and deals another; it can't loop, since the pool is finite and the gate takes over.
- **Rotation left the poster shrunk.** A rotation settles over a few hundred ms, so measuring at the event catches it mid-flight — `remeasureAfterSettling` re-measures at 50/150/400/800ms. And the stale value had nothing to correct it: **capping the poster smaller doesn't change the body's size**, so a `ResizeObserver` on `document.body` goes quiet. It also watches the stage, whose growing back to fill leftover space is the signal the body can't provide.
- **The winning crop outline**: `cropRectFor(index, origin)` — with `scale(Z)` about origin `o`, the visible window is `1/Z` wide starting at `o·(1 − 1/Z)`. The box is 2:3 rather than square because that's the shape of the viewport it was seen through. Dim outside is one spread `box-shadow` clipped by `overflow: hidden`. Delayed 0.5s past the zoom-out so it lands as a second beat, and skipped when the win came from the fully-zoomed-out step.

Tests: `posterZoom.test.js` (pure), `PosterZoomGame.test.js`.

### Tiebreak nudge halved to -0.05 per rank (Aug 2026)
Report: *"I feel like I just did a tiebreaker tournament and now I'm presented with a new tiebreaker tournament that has a lot of the same movies in it."* A tournament resolves a tie by nudging losers DOWN — into whatever scores sit below them, where landing on an occupied 0.01 slot manufactures a fresh tie containing some of the same movies.

**The trap: `tweakDeltaForRank` is not a score delta.** `tweakValue` is added to `overall`, which is weighted (2) and divided by 10 — the visible score moves by a FIFTH of the tweak, and `calculatedTotal` rounds to 2dp. So -0.05 is the smallest step that shifts the displayed score at all (exactly 0.01); the user's literal ask of "-0.01" would have moved the score by 0.002, vanished in rounding, and made the same tournament recur forever.

Halved from -0.1 (a 0.02 score step) to -0.05 (0.01). This makes collisions rarer, not impossible — ~1,300 movies share a few hundred 0.01 slots, so any fixed step can land on an occupied one. **Deliberately NOT hunting for an unoccupied slot**, per Matt: ties derived from these nudges are acceptable, they should just happen less often.

### Clue Budget fitted to one phone screen (Aug 2026)
Report: *"so many different things you can buy that it having a scroll on my phone... maybe the buttons could be smaller. We can do three across or something."*

There are **19 clue chips**, which is more than the report implies and more than three-across can absorb — measured, three-up still ran 251px past a 664px viewport. What actually got there, in order of how much each saved:

- **Shop 360px → 191px**: four across (six at ≥600px), chip `min-height` 46 → 34, smaller label/cost type, tighter gap. Labels wrap to two clamped lines rather than ellipsing — the whole word is more use than a truncated one, and the fixed height absorbs the extra line so the grid stays even.
- **"Production Company" → "Studio"** in `clueBudget.js`. The app already says "studios" everywhere else, and it was the longest label by some way.
- **Subtitle 76px → 24px**: it wrapped to three lines, then still carried 1.75rem of combined margin on a single line. The budget row directly below already shows the amount, so the sentence doesn't repeat it.
- **Give-up moved out of the shop grid** into an understated link (matching Reel Wordle's and Poster Zoom's) — it isn't a purchase, it ends the round, and it was occupying a chip slot.

**Superseded the same day** — see below; four-across made the chips too small to tap, so the deck was cut instead.

**It fits exactly at a 664px viewport** — a real phone PWA has more room. Note it only holds at the *start* of a round: `.purchased-clues` grows as you buy, which is inherent to accumulating information rather than a layout bug.

**Watch out when editing this file's CSS with a regex** — `.game-subtitle` uses separate `margin-top`/`margin-bottom`, so a substitution targeting `margin:` matches nothing and silently reports success.

### The update banner was racing the service worker (Aug 2026)
Report: *"I didn't get my refresh for new version banner. Did we lose that?"* Nothing was lost — it was losing a race it can't reliably win.

**`vue.config.js` sets `skipWaiting: true` (and `clientsClaim: true`), which is fundamentally at odds with a "click Refresh to update" prompt.** The banner is driven by `registerServiceWorker`'s `updated()` hook, which only fires while a new worker sits in the `installed` state — but `skipWaiting` means the worker activates itself immediately instead of waiting for the user. So the hook fires or doesn't depending on timing: you get the new version either way, you just aren't reliably told.

**Fix (deliberately the conservative one):** `App.checkDeployedBundle()` compares the `app.<hash>.js` filename the server is serving against the one THIS page actually loaded, and flags an update on a mismatch. It doesn't depend on worker state at all. It piggybacks on `checkForServiceWorkerUpdate`'s existing four triggers (`visibilitychange`/`pageshow`/`focus`/30-min interval) rather than adding its own cadence, and no-ops once the flag is already set.

**The cache-busting param is load-bearing.** Workbox precaches `index.html` and only strips params matching `ignoreURLParametersMatching` (`utm_`, `fbclid`), so an arbitrary `?updateCheck=<ts>` misses the precache entry and reaches the network — which is the entire point of the check.

**NOT done, and the better fix if this is ever revisited:** set `skipWaiting: false` so the worker genuinely waits, making the banner reliable by construction. That requires rewriting the Refresh button too — with a waiting worker, a plain `location.reload()` updates nothing, since it only activates once every tab closes; it would need to post `SKIP_WAITING` and reload on `controllerchange`. Left alone deliberately: getting it wrong strands users on a stale build, and it wants testing on a real device.

Test note: `App.test.js` uses `shallowMount` and stubs `addEventListener`, because App is the root component and never removes its listeners — real mounts leak handlers across tests in that file. Also, bundle-hash fixtures must be **lowercase hex**; the matcher is `[a-z0-9]+` and an uppercase fixture silently fails to match.

### Clue Budget: back to three across, with a shorter deck (Aug 2026)
Follow-up report: *"the buttons are too small now. Let's go with three buttons per row. If that's going to make the layout too tall we could lose some of the lesser categories."*

Four-across fitted but the chips were ~86px wide, which isn't a comfortable target. Three across only fits if the deck is shorter, so **the deck was cut from 20 possible clues to 12** rather than shrinking the buttons further.

**Cut** (the least likely to identify a film): Exact Year (Decade already covers the era, cheaper), Studio, Producer, Editor, Cinematographer, plus cast 4 → 2 and keywords 3 → 2. **Kept**: Decade, Runtime, Genres, Your Rating, Keyword ×2, Composer, Tagline, Writer, Director, Cast ×2. Twelve is four rows of three, the worst case, which still fits unscrolled. Chips are now 115×42 — 40px `min-height` is the usual minimum touch target.

Removing the Studio clue also removed the only consumer of `fetchCompanyRarity`, so that TMDB request per round is gone with it (`priceFromCompanyRarity` is kept and still tested — it's a pure exported helper).

**A regex nearly ate the wrong clues.** Deleting the blocks with a pattern that walked backwards from each `clues.push` silently swallowed the neighbouring `yourRating` and `composer` blocks too, because they sit directly adjacent. Caught by listing the surviving pushes rather than trusting the edit. Match the exact literal blocks instead.

### Clue Budget: deck back up to 15, chips at 46px (Aug 2026)
Follow-up: *"We have plenty of room. There are only 8 clues to buy now. We could easily fit 15. And I think you need to account for the fact that tagline isn't always present."*

The previous cut to 12 was too deep, for two reasons worth recording:

- **The 664px test viewport was a desktop window, not a phone.** Matt's device is 812pt tall, so the installed PWA has roughly 750px — about 90px more than I was budgeting against. Measuring in that window is right for catching gross overflow, but it is NOT the real ceiling.
- **A round rarely offers the theoretical maximum.** Tagline is fetched live and often absent, and crew completeness across the 1,368-movie library measures: director 100%, writer 96%, cinematographer 94%, cast≥3 97%, keywords≥3 94%, composer 85%. So a "12 max" deck plays as ~10.

**Restored**: Exact Year, Cinematographer (94% available, and a genuinely hard clue rather than filler), and a third cast member (97%). Max is now 15 = five rows of three, measured at 728px total — fits a real phone, does not fit the 664px test window. Chips are 115×46.

**Still cut**, as the least identifying: Studio, Producer, Editor. `priceFromCompanyRarity` remains exported and tested even though nothing calls it.

### Clue Budget: the shop now fills to 15 (Aug 2026)
Follow-up: *"It shows 10 clues now. Can't we get it to always be 15?"*

Capping by clue TYPE can't do it, because the types are patchy — tagline is fetched live and often absent, and across the 1,368-movie library composer sits on 85%, cinematographer 94%, writer 96%. So a "15 max" deck routinely played as 10.

`buildClueDeck` now **tops up to `TARGET_CLUE_COUNT` (15)** from the two lists that run deep: 94% of the library has 8+ cast, 85% has 6+ keywords. Extras alternate cast/keyword so neither takes over, and are priced by continuing each list's own direction — cast cheaper further down the billing, keywords dearer as they get nicher — with a floor and ceiling so the top-ups don't run away.

**Measured across the whole real library, worst case (no tagline, no live pricing): 94% of movies now yield a full 15.** The remaining 6% genuinely lack the data.

**Cast and keywords are no longer capped at a fixed count** — the cap is the deck as a whole. The old per-type cap tests were rewritten accordingly, and cost-ordering assertions became `<=`/`>=` because top-up entries share a floor/ceiling rather than continuing to diverge.

Measuring this needed a detour: the library dump runs through `firebase-admin` (CommonJS) but `clueBudget.js` is ESM, and Node treats `.js` as CJS here since `package.json` has no `type: module`. Two steps — dump to JSON with plain Node, then read it from a throwaway **vitest** file, which handles the ESM. Both removed afterwards.

### Game Stats, the fun round (Sep 2026)
Bug report from Matt, 2026-09-06: *"The game stats page I find it not particularly [fun] to look at. I feel like we could have more fun stats in there and more in-depth numbers of the different games and make the whole page just look more fun."*

The page had been one flat card per game — four label/value lines and a chip strip. It is now a sibling of Deep Stats, in that screen's own section/strip/poster-row language, with everything derived from what the games already record (`settings/games/history/<key>` round records, `plays` session counters, `wins` today-stamps). New pure module `src/assets/javascript/games/gameStats.js`; `gameHistory.js` keeps the original summary lines and chips.

- **The Scoreboard** on top: rounds, sessions, days played, and a day-streak tile that only appears at 2+ (consecutive calendar days with any round; yesterday keeps it alive so it doesn't read as broken at 9am). Callouts: hot streak, favourite game, won today X of 11, biggest day (3+ rounds), playing since / last round.
- **Per game**: the hub's banner art across the top, a one-sentence headline (biggest fact first — "Your best run is 11 in a row, set on Sep 4."), a full-width personal-best tile with the date it was FIRST reached (a tie doesn't move the date), the original summary lines minus the "Best …" one the tile already says, best/current win streak for win/loss games, a **form strip** (one bar per round, tallest = best whichever direction is "better", losses hollow, needs 2+ rounds) with a recent-vs-earlier trend sentence once there are 13+ scoring rounds, a **habits** line (favourite weekday and time-of-day slot, claimed only from 4+ rounds with a clear plurality), and the recent-rounds chips.
- **Movies**: the four single-target games (Wordle, Clue Budget, Trivia, Poster Zoom) now record `movie: entryKey(target)` on each round, so the card can show "The ones that got away" (lost rounds, most-often first) and "Nailed it" (best won rounds) as poster rows. Rounds from before this build carry no key and simply don't appear; a movie that has left the library is dropped with its round.
- **Drama on reveals**: cards rise in staggered by 110ms, the scoreboard numbers count up over 900ms, the personal-best value pops once its card has landed. A tap anywhere settles everything instantly; `prefers-reduced-motion` skips it all. jsdom has no `matchMedia`, which the component reads as reduced motion — so tests see final numbers, no timers needed.

Nothing shows a zero: every block hides when the records can't support it (`personalRecord`/`recentTrend`/`habits` return null, `movieFacts` returns empty lists). Stamp is a "volume" game with no record or form strip — its headline counts posters judged. Tests: `gameStats.test.js` (pure), `GameStatsScreen.test.js` (DOM), and one round-record assertion per single-target game; the movie-key and poster-resolution guards were proven by reverting.

## You or the Crowd?: scores, not ranks (2026-09-30)

The game shipped (2026-09-29) comparing RANKS — your percentile for a film among your own ratings against the crowd's percentile among theirs, the same trick `letterboxdCompare.js` uses for Insights, because a 0–10 weighted score and a 0.5–5 star average can't be subtracted. Matt's report the next day: "The comparison for the new game should be our scores, not our ranks. I don't know what it means for the rank to be higher or lower." Rank is right for a correlation and wrong for a quick yes/no question a player has to reason about.

Now the game (only the game — Insights still ranks) puts both on the star scale: your normalised score halved, which is exactly what ToggleableRating's star view shows, against the crowd's average. Near-ties inside 0.25 stars sit out. The reveal shows "You ★ 4.0" / "Crowd ★ 3.87".

Checked on the live library before shipping: scored this way the crowd out-scores Matt on about three films in four (48 "you" vs 162 "crowd" among the 261 films with a crowd rating then), so an unbalanced run is won by always tapping "The crowd did". `balancedDeck` deals equal numbers of each answer per run, and Start waits for a balanced deck of ten. The score test was proven by temporarily restoring the rank comparison.
