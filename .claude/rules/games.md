---
paths:
  - "src/components/games/**"
  - "src/assets/javascript/games/**"
  - "src/mixins/gameData.js"
---

# Games rules

Ten games built entirely from the user's own rated library. Full narrative and per-game
design history: `docs/history/games.md`.

## Architecture

**All game rules live in plain, store-free modules** under
`src/assets/javascript/games/`, unit-tested without mounting anything. Components in
`src/components/games/` are thin wiring + presentation. `src/mixins/gameData.js` supplies
`eligibleGameEntries`, `gameRatingFor`, `gamePosterUrl`, `recordGameWin`, `GAME_ICONS`,
`gameWinKey`, `todayStamp` and `lastPlayedGamePath`.

| Game | Route |
|---|---|
| Higher or Lower | `/games/higher-lower` |
| Reel Wordle | `/games/wordle` |
| Connections | `/games/connections` |
| Six Degrees | `/games/six-degrees` |
| Timeline | `/games/timeline` |
| Clue Budget | `/games/clue-budget` |
| Tag | `/games/tagline` |
| Trivia | `/games/trivia` |
| Stamp | `/games/stamp` |
| Poster Zoom | `/games/poster-zoom` |

All `requiresLogin`.

## Conventions that apply to every game

- **Persist identity, not derived data.** `localStorage` under
  `cinemaRoll.<game>.current` holds entry KEYS; entry objects are re-resolved from the
  current library on restore, falling back to a fresh round if a movie is no longer
  eligible. **A finished round is never resumed.** Exception: Trivia persists its facts,
  because Claude's output isn't deterministic.
- **Wait for the library, don't read it once.** Use
  `watch: { eligibleGameEntries: { immediate: true } }`, not `created()`. A deep-link
  load mounts before Firebase data arrives, and a one-shot read strands the game on "not
  enough movies" forever. Was a real bug in Six Degrees and Connections.
- **Exclude the round you just finished** when picking the next target, falling back to
  the full pool if that would leave nothing. Two separate "it keeps repeating" reports
  traced to this being missing.
- **Staleness guards must compare `entryKey`, not object identity.** Vue wraps
  `this.target` in a reactive proxy, so `!==` against a raw captured object never matches
  and the guard silently never fires. Hit in Clue Budget, Trivia and Poster Zoom.
- **Custom banner per game**: `created()` saves `bannerUrl` and swaps in the game's art
  plus `setHideHeaderLogo(true)`; `beforeUnmount()` restores both. Optional-chain all
  store calls (`$store.commit?.()`) — several test mocks stub `$store` bare.
- **Shared styling**: `_game-buttons.scss` (`.btn-game`, `.btn-game-primary/secondary`,
  `.full-width`, `.end-actions`) and `_game-inputs.scss` (`.game-input`), `@import`ed
  into each scoped style block.
- **`.end-actions`** is the end-of-round row (primary action + "Back to Games"). Labels
  must not wrap — sharing the row halves each label's width, and a wrapped label makes
  one button taller than the other.
- **Unlimited guesses, no hard loss state** is the house rule. Trivia is the deliberate
  exception: one guess, so you can't brute-force the suggestions list.
- **`padding-top` on the game root is a safety margin, not decoration** — `BackLink` is
  fixed at (6,6) of the viewport whether or not the header currently has height.
- **Typeahead dropdowns**: panel styling goes on `.suggestions` (background, border,
  `position: absolute`, `max-height` + scroll); rows stay transparent. Styling rows as
  bordered cards reads as a stack of separate boxes.
- **A destructive control ("New Puzzle") must not sit above the input mid-round.** Show
  the prominent version only after a win; mid-round use an understated text link.

## Win tracking

`recordGameWin()` writes `settings/games/wins/<key>` via `writeDurably`, keyed by
`gameWinKey(routePath)` + `todayStamp()` — both exported from `gameData.js` and used on
**both** sides so they can't drift. It's a marker, never a gate: a won game is still
playable. The five games with a discrete win state hook their win moment; the three
endless streak games count one correct answer. Games deriving `status` as a computed need
a `watch`, not an imperative call.

## Round history

`recordGameRound(metrics)` appends `{ at, ...metrics }` to `settings/games/history/<key>`
(capped at `HISTORY_CAP`, oldest first). Each game owns its metric shape — see
`gameHistory.js`'s per-game summaries and `gameStats.js`'s `METRICS` table, which is
where a new game declares its headline field and which direction is "better". The
single-target games (Wordle, Clue Budget, Trivia, Poster Zoom) also record
`movie: entryKey(this.target)` so Game Stats can show poster rows; a new guess-the-movie
game should do the same. Keep records small: settings ride along on every launch.

## Testing traps specific to games

1. `new Date('YYYY-01-01')` parses as UTC and shifts a year/decade in this repo's
   timezone — use mid-month dates in fixtures.
2. State set in `mounted()` isn't visible to a synchronous post-mount assertion; prefer
   `created()` for pure data setup.
3. `gameData.js` optional-chains `this.$store.state` itself — several mocks stub `$store`
   with no `state`. Don't tighten it without fixing them.
4. Fixtures reuse dbKeys, so persisted `localStorage` leaks between tests —
   `beforeEach(() => window.localStorage.clear())`.
5. To test the empty-then-populated library race, wrap mock getters in Vue's `reactive()`
   or the watcher never fires.
6. End-of-run blocks sit inside a `v-else` requiring a started run — call `start()` before
   setting `gameOver = true`, or nothing renders.
7. `recordGameWin` derives its key from `this.$route`, which most game tests don't mock —
   it silently no-ops there.

## Game typeaheads: one character is enough, and order does the work

Every guess dropdown goes through `rankTitleMatches` (`gameUtils.js`), never a bare
`matchesAllTokens` + `slice(0, 8)`. It exists because of report -P1Px9lCmg (2026-09-13):
the typeaheads demanded two characters, so "8" found nothing and **8½ could not be
guessed at all** — same shape as "M", "Us", "Pi", "9". A one-character term matches most
of the library, so the fix is ranking, not a lower threshold alone: titles that START
with the term, then titles with a word starting with it, then the rest, ties in library
order. Both sides are folded with `typeaheadText` — NFKD, so "½" spells out and "8 1/2"
(what the keyboard offers) finds "8½" too. Add any new title-guessing game to the
`rankTitleMatches` callers, and add the report's literal keystrokes to
`PosterZoomGame.test.js` / `gameUtils.test.js` when one comes in.
