---
paths:
  - "src/test/**"
  - "vitest.config.js"
---

# Testing rules

Run with `yarn test:run`. **Never run `yarn serve`** — see CLAUDE.md.

Coverage is strong on the algorithmic core (`searchFiltering.js` ~98%, rating calc,
favorites scoring, awards utils 100%) and absent on `Insights.vue` (3,000+ lines),
`LetterboxdScrapingService.js` (only its failure path is tested), `YearInReview`, `Outliers`, `ShareDBResults`.

## A component's tests must reach every interactive path, not just the newest one

`RatingCurveSettings.test.js` tested the curve preview exhaustively and never opened
either anchor picker. So when the curve-chart rewrite (47c58d1) swallowed `pickerPool`
and `pickerCandidates` in a hunk that was only meant to touch `curveChartOptions`, the
suite stayed green and both pickers shipped dead for six days — the feature the component
is named for. Coverage tends to pile up on whatever was last interesting; check what the
component can DO and confirm each entry point is mounted somewhere.

Corollary: **drive it through the DOM.** A missing computed throws in two places — the
method that reads it, and the template that renders it — and only the template's throw
blanks the section. `wrapper.vm.someComputed` would have caught one of those.

## Prove a test is a real regression guard

The convention here is to **temporarily revert the fix and confirm the test fails with
the bug's actual signature**, then restore. Several tests in this repo were found to pass
against broken code — most notably a Trophy Case test that asserted a name appeared in
`wrapper.text()` but never that an `<img>` rendered, so it stayed green while every image
on the row was a placeholder. Assert the thing that broke, not a proxy for it.

Where a pure function can be extracted, test it directly rather than through a mount —
`searchFiltering.js`, `tieBreakTournament.js`, `awardStats.js`, the games modules and
`scrollBehavior.js` all exist as separate modules partly for this reason.

**When reverting a COMMITTED fix to prove a guard, `git stash` cannot do it** — a clean
tree stashes nothing, and the pop then grabs whatever ancient `stash@{0}` the repo is
carrying (there are years-old WIP entries in this one; a pop conflicted one into
Home.vue on 2026-08-30 and the "pre-fix" run silently tested the fixed code). Use
`git show HEAD~1:<file> >| <file>` (note `>|` — zsh noclobber blocks plain `>` and the
"file exists" error otherwise leaves you testing current code again), then
`git checkout HEAD -- <files>` to restore.

## Every "can't find a movie" report becomes a roster test

Standing rule (Matt, 2026-08-30): "anytime that I report a bug on not being able to
find a specific movie, we need to write a test to ensure that we don't regress."

`UnfindableMovieReports.test.js` is that roster — one describe block per bug report,
keyed by report id, encoding the report's LITERAL searches as **typed text through the
DOM** (typed input only becomes the implicit general filter when no chips are active,
so a chip-based test exercises a different path than the thumb on the phone did).
Add a block for each new report; never delete an old one. Mechanism tests still live
next to their code (`ShortsSearchRescue`, `searchFiltering`) — the roster exists so the
exact reported experience can never silently come back.

## Mock requirements that break `mount()` if missing

- **Home.vue mounts** need the `allMoviesAsArray` getter and the `homePage*` state fields.
  `ChipFiltering`/`QuickLinksFiltering` were both broken by their absence.
- **Any file importing the store** needs a `firebase/database` mock exporting
  `serverTimestamp`, or the import fails.
- **`src/test/setup.js` globally mocks `firebase/auth`** — `getAuth()` runs at module
  load, so without it every test touching the store hits Firebase Auth's Node build and
  throws. Its `onAuthStateChanged` mock **must invoke its callback**, or `authReady` never
  settles and `initializeDB` hangs forever. The three files with their own `firebase/auth`
  factories override the global mock and each need the same treatment.
- `setup.js` also stubs `window.scrollTo` (jsdom doesn't implement it).
- Game tests: see `.claude/rules/games.md` for the `$store`/`$route`/`localStorage` traps.

## jsdom traps

- **jsdom never lays out elements** — `offsetWidth` is always 0. Stub it via
  `Object.defineProperty` on the ref.
- **Don't assert `v-show` with `isVisible()`** on a detached mount — it gave contradictory
  answers across runs for `SettingsSection`'s accordion. Assert what `v-show` actually
  writes: `wrapper.find(sel).element.style.display` is `'none'` or `''`. Also re-`find()`
  an element wrapped in `<component :is>` after every toggle; the element is swapped on
  re-render and a cached wrapper's `trigger()` silently goes nowhere.
- **`scrollIntoView` doesn't exist at all** — assign a stub before `vi.spyOn` can attach.
- A state update made inside a watcher's own nested `$nextTick` needs a **third**
  `await $nextTick()` beyond the two you'd expect.
- A **function ref** re-fires on every re-render, so a stub assigned to it gets clobbered
  mid-update.
- `App.vue` tests use `shallowMount` and stub `addEventListener` — App is the root
  component and never removes its listeners, so real mounts leak handlers across tests in
  the same file.
- Bundle-hash fixtures must be **lowercase hex**; the matcher is `[a-z0-9]+`.

## Fixture hygiene

- `new Date('YYYY-01-01')` is parsed as UTC and shifts a year/decade in this timezone —
  use mid-month dates.
- Use **relative** dates (`daysAgo`) where a window matters, so a fixture can't drift into
  or out of it as real time passes.
- `id: 0` is a legal value. Guard with `x == null`, not `!x` — this exact typo has been
  caught twice (`backfillBoxOffice.js`, Trivia's poster link).
- IndexedDB needs `fake-indexeddb`; jsdom has no implementation.
- Tests that exercise the real store (`OfflineDataFallback`, `flushPendingWrites`) import
  `store/index.js` for real and mock Firebase/axios/router/Sentry — prefer that over a
  hand-rolled mock store, which drifts from the real shape.

## The filesystem is case-insensitive — check before creating a test file

`src/test/YearInReview.test.js` existed; writing `src/test/yearInReview.test.js`
**overwrote it in place**, keeping the original's casing, and a later `rm` on the
lowercase name deleted it. APFS is case-insensitive by default: the two paths are one
file. `ls src/test/ | grep -i <name>` before creating one.

The full-suite output hides this — the *file* count stays the same, so it still reads
"144 files passed". The tell is the **test count** moving by less than the number you
added. `find src -name "*.test.js" | wc -l` is the honest file count.

## A test that changes state the fix doesn't need is not a guard

The Year in Review headshot fix (fetch on a watcher, not in `mounted()`) had a test that
set `selectedYear` after the library arrived. It passed against the broken code, because
changing the year triggered the old `selectedYear` watcher and refetched. The real
sequence is the data landing while the year stays put. Reproduce the bug's actual
sequence, not a convenient neighbour of it.
