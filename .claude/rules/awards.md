---
paths:
  - "src/components/PersonalAwardsModal.vue"
  - "src/components/TrophyCase.vue"
  - "src/components/TweakInline.vue"
  - "src/assets/javascript/personalAwards*.js"
  - "src/assets/javascript/awardStats.js"
  - "src/assets/javascript/otherAwards.js"
  - "src/assets/javascript/genderEligibility.js"
  - "src/assets/javascript/tieBreakTournament.js"
---

# Awards & tiebreak rules

Full narrative: `docs/history/awards.md`.

## Personal awards

Stored at `settings/personalAwards/<year>` as
`{ categories: { <key>: { nominees, winner } } }`, nominees/winner in "minimal" form
carrying a `movieId`. `PERSONAL_AWARD_CATEGORIES` lives in
`personalAwardsCategories.js` so consumers don't duplicate and drift from the list.

- **The modal must never auto-close.** Completion date is set only when the user clicks
  "Complete Awards". Eligibility logic must keep showing years with *partial* progress —
  three separate computeds got this wrong at once and made the modal vanish mid-work.
- **`getOptionId` special-cases `bestDirector`** to always return `movie-<movieId>`.
  A freshly-computed Director option is a movie-group with no top-level `id`; one restored
  through `convertNomineeToMinimal`/`expandNomineeFromMinimal` has the id promoted to top
  level. Without the special case they never match and saved directors don't highlight.
- **Acting grids load 3 cast per movie initially**, so `extractAndGroupPeopleByMovie`
  always appends already-nominated cast members regardless of the gender heuristic, with a
  dedupe guard in `loadMoreForMovie`.
- **Use the user's own award name.** `settings.personalAwardName` (default 'Oscar') via
  `awardNameWithThe`/`awardNameWithoutThe`/`awardNameSingular` in `personalAwards.js` —
  never hardcode "Personal" or "Oscar".
- **One year-size gate: `yearsMeetingAwardsThreshold(entries, settings)`.** Whether a year
  is big enough to have awards reads `settings.awardsYearThreshold`, and there were three
  copies of the count — the modal, the /awards strip, and Home's `shouldShowAwardsModal`,
  which still hardcoded `>= 10`. So lowering the setting changed every screen except the
  one that *offers* you the work: "I changed my personal award number so that I only need
  three movies and I haven't gotten a pop-up" (Natalie, 2026-08-22). Never re-derive the
  count; the "which years still need work" predicate is separate and stays per-caller.

## Prompt quotas

`promptQuota.js` answers "may this prompt appear yet" for all three home-screen chores.
Spacing, not counters: N a day means "no sooner than `ONE_DAY_MS / N` after the last one",
which is the shape the tiebreak setting already had and what Matt asked the others to
match (2026-08-22).

- `settings.awardsPromptsPerDay` (default 1), `settings.stickinessPromptsPerDay`
  (default **no limit** — stickiness never had one, and a blank box must not quietly
  become a cap), `settings.tieBreakTweak` (unchanged, still its own code path).
- `null` from `promptsPerDay` means no limit and is a real answer; `0` means never.
- Awards stamp `settings/lastAwardsPromptAt` on "Complete Awards"; stickiness stamps
  `settings/lastStickinessPromptAt` when the inline panel closes, so one sitting through
  the whole queue is one prompt.
- **`lastAwardCompletionDate` is still the only stamp on existing accounts.**
  `lastAwardsPromptAt(settings)` falls back to reading that date string as the start of
  that day, which reproduces the old `=== today` gate exactly at one a day. Don't migrate
  it away.
- The quota check lives OUTSIDE `shouldShowAwardsModal`'s settings-loaded branch. Nested
  inside it, someone who had never completed a year could not turn the prompt off.

## The chore prompts are judged against a REACTIVE clock, never `Date.now()`

`Home.promptNow` is that clock, refreshed by `refreshPromptClock()` — on a 5-minute
interval, on `visibilitychange` back to the foreground, and on a chore-notification tap
(`readChoreOpenRequest`). `stickinessCandidates.js` takes `now` as an ARGUMENT for the
same reason, and Home hands the same value down to `StickinessInline` as its `now` prop
so the card and the gate that renders it can never disagree.

**Never write `new Date()` inside a computed that decides whether a prompt appears.**
Vue caches a computed until a reactive dependency changes, and the wall clock is not
one. `resultsThatNeedStickiness` did exactly that, with only the entries array as a
dependency: on an installed PWA sitting in memory since before a film matured, the queue
stayed frozen at the empty value it had when the library last changed. Reports
-P1Xo9Blv0-axmB4zrWL and -P1_e7pw0t5rtO7vlFj4 (2026-09-15) are that bug — the push
Lambda fires at the INSTANT a film matures, so the tap always arrives into the stalest
possible state, and nothing short of a cold launch could dislodge it.

The foreground handler is the one that matters on a phone: iOS suspends a backgrounded
PWA's timers, so the interval is a fallback for a session left open on screen, not the
mechanism. `StickinessPromptClock.test.js` moves time while holding the library still —
if a test also changes the entries, it passes against the bug.

Note the older `forceModalReevaluation` counter is still what the tiebreak/awards/quota
gates hang off (they read `Date.now()` directly). `refreshPromptClock()` bumps both, and
must keep doing so, or the prompts disagree about what time it is.

## Custom (honorary) awards

Stored **per year**, beside that year's categories:

```
settings/personalAwards/<year>/customCategories/<key> = { name, createdAt }
```

with nominees/winner in `categories/<key>` exactly like a standard award's. That is the
whole design: everything downstream keys off the category key and already defaults
sensibly for one it doesn't recognise (`isCategoryDisabled` → false, `getCategorySortKey`
→ 'rating', `isActingCategory` → false), so custom awards ride the existing machinery
rather than needing a parallel path.

- **A map, never an array** — Firebase returns a sparse array as an object map, and a map
  makes deleting one a leaf write.
- **The key is slug-derived, not timestamped** (`customAwardKey`). Reusing a name next
  year yields the SAME key, so "3× Best Needle Drop" aggregates across years in the
  Trophy Case the way a standard category does. The cost is that a duplicate *within* one
  year would silently overwrite the first, so the modal refuses one.
- **A custom award goes to a film or to a person** (`type`, via `customAwardType`).
  Records written before person-type landed carry no `type`; they default to `'movie'`
  rather than being backfilled.
- **A person-type custom award is NOT an acting category.** `isActingCategory` returns
  false for any custom key — explicitly, not by relying on slugs being lowercase — because
  gender gating and the lead/supporting sibling conflict both hang off it and neither
  belongs to an award someone invented. Its pool is cast (capped at
  `CUSTOM_AWARD_CAST_DEPTH`, since cast is stored untrimmed) plus all stored crew, so the
  composer and the cinematographer are reachable; each option carries a `role` that is a
  character for cast and a job for crew. It returns a FLAT list, not the movie-grouped
  shape — that grouping exists for the acting grid's per-movie "load more cast".
- **Person winners get their photo from the Trophy Case's own lookup.** Custom person
  options deliberately don't pre-fetch `details.profile_path` — that would be a
  `/search/person` call per cast+crew member of the year. The Trophy Case already falls
  back to a name lookup, and a saved winner carrying a `name` is what tells it this is a
  person and not a film.
- **Read `customCategories` OUTSIDE the `categories` branch** when loading a year — an
  award can exist with nothing assigned to it yet, and that record has no `categories`
  key at all.
- **Removing one must delete `categories/<key>` too.** Orphaned nominees under a key
  nothing lists any more keep the award alive in the Trophy Case and in every winner's
  award history.
- Resolve names anywhere outside the modal with **`awardCategoryNameMap(personalAwards)`**
  — whole-map, not per-year, because the Trophy Case aggregates across years and a movie's
  award history walks every year at once. `PERSONAL_AWARD_CATEGORY_NAMES` alone renders a
  custom award as its raw storage key.

## A person's saved `id` is not stable — compare with `samePersonNominee`

`extractAndGroupPeopleByMovie` builds a cast option as `id: person.id || person.name`,
so what gets SAVED is whatever the film's cached TMDB cast happened to carry that day.
Matt's 1993 record holds all three shapes at once: `'Liam Neeson-424'` (the cast entry's
own synthetic id), `1524` (a real TMDB person id), `'Julia Roberts'` (the name fallback).
Re-fetching a film's cast changes the shape a FRESH grid option gets while the saved
nominee keeps the old one, so `nom.id === option.id` silently stops matching.

**Never compare people by `id`.** `samePersonNominee` / `personNomineeKey` /
`samePersonRole` in `personalAwards.js` are the only answer — name first (the one field
every shape carries), id as the fallback. `actingSiblingConflict` always did this; the
rest of the modal didn't, which is report -P1oV4wiVPs-5rAyJ9AN (2026-09-18): saved
nominees had no lit tile, no crown, and their × did nothing.

**Removal must never depend on the grid.** `toggleActorNomination` used to decide "is
this person nominated?" by re-finding their roles in `eligibleOptionsByMovie`. An empty
scan — their film dropped out of the year, or the grid hadn't loaded — skipped the remove
branch and then pushed the empty list, so the × was a permanent no-op with no way around
it. The nominee LIST answers that question; the grid scan only supplies the extra roles
when ADDING, and falls back to the tapped option itself.

## Acting-category gender eligibility

**One source: `genderEligibility.js`'s `isEligibleForActingCategory`.** Two copies had
drifted, and one silently excluded every TMDB `gender: 0` ("not specified") person from
*both* acting categories, making them unnominatable with no error.

Rule: anything that isn't a definite female/male reading — missing, `0`, or `3`
(non-binary) — is eligible for **every** acting category. Being wrongly offered a
nomination is harmless; being silently unnominatable is not. Guard with
`Number.isFinite`, not `typeof x === 'number'` (`typeof NaN` is `'number'`).

## Award statistics

`awardStats.js` — two deliberate modelling decisions, don't "fix" them:

- **A winner is also a nominee.** The modal only lets you pick a winner from selected
  nominees, so nomination counts include wins. That's what people expect.
- **A person's award counts for their film.** "Titanic won 11" includes its acting and
  directing wins.

Ties break alphabetically; `minCount` defaults to 2.

## Trophy Case images

**A person never gets a movie poster.** Branch on winner type (`expanded.name` present =
person): stored `details.profile_path` → TMDB `/search/person` lookup → their initial. A
wrong picture is worse than a letter. Movies get their poster. Note `expanded.details` is
real — populated two hops away in `PersonalAwardsModal.convertNomineeToMinimal`; grepping
one file is not enough to conclude that branch is dead.

## Round-robin tiebreak

`tieBreakTournament.js` is pure and store-free. `findTiedGroup` expands to the full
contiguous run of equal scores; `createRoundRobinTournament(ids, rng)` builds every pair
(pass `Math.random` to shuffle match order).

- **`tweakDeltaForRank` is not a score delta.** `tweakValue` feeds `overall`, weighted 2
  and divided by 10, then rounded to 2dp — so the visible score moves by a *fifth* of the
  tweak. `-0.05` is the smallest step that moves the displayed score at all. Anything
  smaller vanishes in rounding and makes the same tournament recur forever.
- **Membership is frozen at creation.** `findTiedGroup` only runs when no tournament
  record exists, so a movie rated mid-tournament can't be pulled in.
- **Scores are applied in one batch** at the results screen, never per match.
- Trigger on a `needsNewTournament` computed, not on `showTweakModal` *changing* — the
  "force tiebreak" testing toggle pins it true so it never changes again.
- A 2-contestant tie skips the tournament ceremony entirely and always closes + stamps
  `lastTweak`, never chaining into a different tied group.
- **Stamping `lastTweak` is not enough to enforce the delay.** Home pins the prompt open
  for as long as a tournament RECORD exists (so nothing steals the screen mid-tournament)
  and consults the daily quota only when there is none. So *creating* the next tournament
  right after "Done" walks straight past the delay that was just set — reported as "I just
  finished a tie break tournament and it is immediately offering me another one". Only the
  `forced` prompt state chains into the next tied group; otherwise `justAcknowledged`
  blocks `needsNewTournament` until the prompt has actually closed once, so the answer
  doesn't depend on Vue's flush ordering between the parent's prop update and the child's
  watcher.
