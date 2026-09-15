---
paths:
  - "src/components/Home.vue"
  - "src/assets/javascript/searchFiltering.js"
  - "src/assets/javascript/entityCounts.js"
---

# Home, search & filtering rules

Home.vue is the highest-traffic screen and the most performance-sensitive code here.
Full narrative: `docs/history/search-and-home.md`.

## Where the logic lives

Pure matching + sorting is in **`src/assets/javascript/searchFiltering.js`** — it reads
nothing from `this`; sort/rating deps are passed explicitly
(`{ sortValue, sortOrder, getRating }`). Home.vue keeps thin method wrappers of the same
names, so existing call sites and mount-based tests are unchanged. Entity count maps live
in **`entityCounts.js`**, shared with MovieDetail.

Still in Home deliberately (entangled with reactive state): `groupedByAllCategories`,
`unifiedFilteredResults`, quick-link computeds, `detectYearTypes`.

## Performance rules — these are load-bearing, not micro-optimisation

- **Use `sortResultsFast(array)`, never `.sort(sortResults)`.** Decorate-sort-undecorate;
  one `getRating` per item instead of ~3 per comparison. `sortResults` is kept only as the
  test oracle. **It returns a NEW array** — don't expect in-place mutation.
  `src/test/searchFiltering.test.js` asserts byte-identical ordering between the two, so
  **if you change sort logic, change both.**
- **`applyFilter` reads `result._search`**, precomputed once per library change by
  `buildSearchFields`. Don't re-normalize per keystroke.
- **`groupedByAllCategories` inlines its matching** rather than calling `applyFilter` 7×
  per movie (~9,100 dispatched calls per keystroke over 1,300 movies). If you edit either,
  keep them mirrored — every group compares through the same normalization.

## The money sorts (2026-08-25)

`budget`, `boxOffice`, `profit`, `returnPct` — all four in `BOX_OFFICE_SORTS`. The data
is optional: TMDB's `0` means "unknown" and is indistinguishable from a genuinely free
production, so `0` and `undefined` are treated alike (as everywhere else in the app).
About 77% of a mature library has both figures.

**Films with no figures sink in BOTH directions** (`isSortValueUnknown`, checked at the
top of both comparators). Flipping to worst-on-top to find the biggest flops has to show
flops, not three hundred blanks. `profit` and `returnPct` need both numbers; `budget` and
`boxOffice` need only their own. `returnPct` guards against a zero budget — the ratio
would be `Infinity` and would sort above every real film.

**Straight-to-streaming films sink on the BUDGET sort** (`isModernWithNoBoxOffice`): a
real budget, no gross at all, released `STREAMING_ERA_YEAR` (2015) or later. The era gate
is the load-bearing part — before it, a missing gross is almost always unrecorded history
(The Searchers, Breathless, Bringing Up Baby), and those budgets are real and belong in
the list. There is no way to ASK whether something played in cinemas: TMDB's release
types count a three-week awards-eligibility run as theatrical (The Irishman reads type 2,
Red Notice type 3), and `production_companies` names who MADE a film, not who released it
(Netflix appears on none of its own). Tested 2026-08-26 — don't redo that research.

This is the one place a sort key can be "unanswerable" rather than merely low, so if you
add another such key, change **both** comparators together — `searchFiltering.test.js`
runs the byte-identical oracle check over the money keys too.

## Normalization: both sides, always (2026-08-16)

`normalizeSearchText` — NFD accent strip, non-decomposing letters (ß→ss, ł→l), curly
quotes and every dash folded (dashes become **spaces**, so "Jean-Pierre" and
"Jean Pierre" reach one string), lowercase, whitespace collapsed. `looseSearchText` adds
"remove every remaining separator" and is used **only for titles**, where run-together
spellings ("spiderman") come up.

Apply it to stored text AND the query. Normalizing one side is what hid Adam's Rib from
an iPhone's curly apostrophe, and de-accenting only titles meant typing "Amélie"
correctly found nothing.

Two traps if you extend this:

- **The query is normalized once per movie**, so `normalizeSearchText` memoizes its last
  input. Keep that, or a 1,300-movie library pays NFD 1,300 times per keystroke.
- **Don't precompute a normalized copy of every searchable term for Fuse.** It's one
  extra object and string per director, actor, keyword, genre, studio and title, retained
  for a fallback that only fires on zero results; it was measurable in an unrelated
  library sort. Cast especially: `_search` is held for the whole library at once, and
  cast is deliberately untrimmed, so a second copy of every cast name is thousands of
  strings. One form per name.
- Perf harness: `yarn test:run src/test/Performance.bench.test.js`, read the `[bench]`
  lines. Not a correctness gate. Baseline: general 0.6ms, grouped 2.4ms.

## Typed text is a plain search — always (2026-08-29)

Matt: "why do we need a name search separate from a title search? Don't we have all
those sections within our search results for exactly this reason?"

`detectFilterType` used to be a six-step exact-match cascade (director → genre → cast →
company → keyword) that guessed which ONE thing a typed word named and committed that as
a typed chip. **It now returns `general` for everything except a year.** Years stay
because `general` never looks at `release_date`, so a typed "2010" would otherwise find
nothing.

Two failures made this necessary, and the second is the important one:

- It had to choose. "Alice" is Mary Alice's surname (`buildCastMembersCache` indexed bare
  surnames), so it committed a person chip and hid three Alice-titled films.
- **A typed chip switches the sections OFF** — `groupedByAllCategories` renders only for
  `general`. So the guess also removed the one mechanism that shows every reading at once.

The five `detect*Types` methods and the whole cast-name cache are **deleted**; the catalog
supersedes them. Precision is still available, but only deliberately: the typeahead
(passes `expectedType`), the Add Filter menu, quick links, tags, and the links on a movie
detail page. Those links now build their own chips (`MovieDetail.chipForClick`) instead of
handing off free text — they used to rely on the cascade to re-derive a type it already
knew, which is exactly what made a clicked keyword drag in films merely *titled* with the
word.

The "generic terms" blocklist (war, love, black, red, american…) that fell back to a flat
list is **gone too**. Those words are precisely the ones with several readings, so they
are what the sections are for; grouping costs ~2.4ms against the flat list's ~0.6ms.

### Identity survives as interpretations, not as a chip type

`searchInterpretations.js` answers "what could these words refer to?" as a **list**,
from `catalog.js` (which already resolved every library name to its TMDB id). This is what
keeps **More from** precise: a `general` chip carries no id, so without it typing
"Thriller" would offer films *called* Thriller. The text search still leads and the
leading interpretation is asked of `/discover` as well, then the two are **unioned**.

- **Union, never intersection.** "Films called Thriller that are also thrillers" is nearly
  nothing — the same trap as fetching two chips separately and intersecting them.
- Only the LEADING reading is asked. Several ANDed together over-narrow identically.
- Interpretations are computed from the filters the fetch was **started for**
  (`interpretationsFrom(filters)`), never from component state — the fetch is async and
  already has a stale-request guard for exactly this reason.
- Only ever populated for a **lone free-text chip**. A question the user already made
  precise is theirs, and reinterpreting it would be the old cascade arriving late.
- A whole name outranks a surname; matching is loose about punctuation on both sides, so
  "warner bros pictures" still reaches "Warner Bros. Pictures".

## Numbers spelled either way (2026-09-15)

`numberWords.js` folds number WORDS to digits on both sides and compares the result as
TOKENS — `buildSearchFields` precomputes `titleNumerals` (title only, one small array per
movie), and `titleMatchesValue(s, value)` is the one title test every path calls:
`FILTER_KINDS.general`, `FILTER_KINDS.title`, `groupedByAllCategories`'s title bucket,
`termMatchesAnyTitle` and `titleNamedByFilters`. **Add a title match anywhere else
through that helper**, not through a bare `titleLoose.includes`.

Report -P1_JRO10YcGNAXX0zzk: "9 to 5" found nothing, because the library holds the film
under the title TMDB had the day it was added — "Nine to Five". "9to5" and "ninetofive"
share no characters, so normalization and the fuzzy fallback were both helpless. A
library picks up whichever spelling TMDB held per entry, so this is general, not one
film's problem.

**Tokens, not substrings — this is the load-bearing part.** Fold "seven" to a bare "7"
and ask whether the loose title contains it, and searching "seven" returns 1917. The
price is that a numeral search names whole words ("fiv" won't reach "Five" this way),
which costs nothing: ordinary substring matching already covers every case where both
sides spell the number the same. This path only ever ADDS matches.

## Grouping and chips

**Group order is also matching priority** — via `usedMovieIds`, a movie matching several
categories lands in whichever group comes first. Order is data-driven
(`DEFAULT_GROUP_ORDER` + a `groupOrder` computed), reorderable by tapping any group
header, and persisted daily at `settings/groupOrderOverride` (reverts next day).

Multiple chips use **AND** logic. The result count badge uses `displayedResults` (what's
actually rendered), not `unifiedFilteredResults.length`.

**Grouping RE-SEARCHES, which is why typed chips can't use it — except people.** The
free-text grouped view takes the chip's bare VALUE (type discarded) and searches it
across Title / Director / Cast / Producer / Company / Keywords. Title is always one of
those, so every typed chip leaked movies its own filter excluded — a `tag:DARK` chip
showed everything with "dark" in the title (d4580ec). Grouping is therefore off for all
typed chips. Since 2026-08-29 this costs far less than it used to: typed text is a plain
search, so the sections are what a TYPED search gets, and a typed chip is now always a
deliberate act (a tapped row, a menu, a link) whose type is the whole point.

The one exception is `person`, and it works by a different mechanism: it does not
re-search at all. `personRoleGroups.js` **partitions `unifiedFilteredResults`** by the
role that person held on each film, so a leak is structurally impossible rather than
merely guarded against. It reuses `FILTER_KINDS.person`'s exact/surname matcher — it must,
or the sections would partition a different set than the count claims. If you add
grouping for another chip type, partition; never re-search.

## Places are a chip kind and a grouped section (2026-09-08)

`movie.locations` (Wikidata, `movieLocations.js` fetch + `places.js` shaping) reaches
search through `buildSearchFields().places` — both types, normalized, one list. The
`place` kind is an EXACT match (`York` must not reach `New York City`), local-only (TMDB
knows nothing about where a film was shot), and the general matcher also checks it, so
typing "Paris" finds the films through the flat pipeline. The grouped view has a
`place` bucket ("Set or Filmed There", after Keywords & Genres in `DEFAULT_GROUP_ORDER`)
whose inline condition mirrors `FILTER_KINDS.place` exactly, like every other bucket.
`countPlaces` feeds the catalog/typeahead, the Add Filter picker and MovieDetail's (N)
badges. Tests: `PlaceSearch.test.js`, `filterKinds.test.js`, `catalog.test.js`.

## Year chips get a scroller, not a chip

Any active `type === 'year'` chip (not `yearRange`/decades) swaps the chip row for
`.year-scroller` — every distinct year, ascending left-to-right, full-width via
`flex: 1 1 100%; min-width: 0`. Other active chips still render as badges below it.
`selectYear` replaces only year chips, leaving everything else alone.

Note `availableYears` (newest-first, for the Add Filter `<select>`) and
`availableYearsAscending` (for the scroller) are two display orders over one source —
don't conflate them.

## Fuzzy "Did you mean?"

Scoped to the user's own library, suggests but never auto-corrects. **Build the Fuse
index once** (`fuzzyIndex` computed) — inlining `new Fuse(...)` into the suggestions
computed cost ~40ms per keystroke. Gated to the zero-results state and to
`this.searchValue` only (never a committed chip's value).

The blur guard in `convertSearchToChip()` applies **only** when
`detectFilterType(searchTerm).type === 'general'` — structured filters (year, genre,
director, …) must always commit, or a valid filter is silently thrown away.

## Diagnostics

`liveDebugState` publishes a live summary for bug reports. The persisted `homePage*`
navigation fields are **cleared by `mounted()`**, so they never reflect current state —
read `homeLive` in a report, not those.

## Entity counts

Count directors with `.filter()`, not `.find()` — `.find` credits only the first-listed
of a co-directed film. Count crew by **job**, not array position: TMDB orders crew by
department, so a composer routinely sits past index 10. All counts respect
`settings.includeShorts` (`runtime <= 40`).
