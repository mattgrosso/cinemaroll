---
paths:
  - "src/components/MovieDetail.vue"
  - "src/components/Insights.vue"
  - "src/components/Favorite*.vue"
  - "src/components/DeepStats.vue"
  - "src/assets/javascript/deepStats.js"
  - "src/assets/javascript/decadeChampionship.js"
  - "src/utils/personLookup.js"
  - "src/components/StickinessInline.vue"
  - "src/mixins/favoriteTuning.js"
  - "src/services/**"
---

# MovieDetail, Insights & Favorites rules

Full narrative: `docs/history/ui-and-layout.md`, `docs/history/search-and-home.md`.

## MovieDetail

- **Section order**: Genres → Awards → Cast → Keywords → Box Office → Country of Origin →
  Set In → Filmed In → Tags. "Country of Origin" is TMDB's production countries; it was
  headed "Made In" until 2026-09-08, when Matt couldn't tell it from Filmed In. Don't
  rename it back to anything that sounds like a place the cameras went. Set In / Filmed In are plain text from `movie.locations`
  (`places.js`); tapping a place runs a Cinema Roll search via a `place` chip (Matt,
  2026-09-08: "tapping Paris just does a search"), never a map app. No map on the page.
- **It is a pure local lookup — no live TMDB fetch on view.** That's deliberate. Optional
  data (box office, production countries) is `v-if`-guarded so older library entries just
  don't render the section, and a Settings-panel backfill catches them up.
- TMDB's `0` means "not available" and is indistinguishable from a genuinely free
  production — treat `0` and `undefined` identically as unknown.
- Awards content scrolls internally (`.awards-body`, `max-height: 150px`), matching the
  `.long-list` treatment on Cast/Genres/Directors. Don't collapse it behind a toggle.
- `formatTimeDifference`'s months branch runs to 730 days, so `'1 year'` is effectively
  unreachable (400 days returns `'13 months'`). Characterized by test, not a bug to fix
  blind.

## Letterboxd

Username-only, no OAuth — setting the username *is* the login. The
`letterboxdUsername`/`letterboxdConnected` computeds need **setters**, or `v-model` writes
are silent no-ops (this dropped new users' typed usernames).

`LetterboxdUrlService.generateUrls` passes `date` and `rating` to the deep link:

- **`date` is the date the movie was actually watched** (`mostRecentRating(result)?.date`),
  not today — a rewatch logs the viewing being logged. Falls back to today only when
  there's no usable date.
- Use `toLocalISODate`, **never `toISOString()`** — that's UTC and reports the previous
  day for an evening viewing in a western timezone.
- `rating` is the normalized 0–10 score halved to 0.5–5 stars; 0/missing omits the param.

## Insights

`estimatedMoviesThisYear` blends four movies-per-day rates equally — whole-year-to-date,
recent 2 weeks, recent 2 months, plus last year's seasonal shape — projected across the
remaining days.

The seasonal signal has **three independent guards**, any one of which disqualifies it
(returns `null`, meaning "leave this signal out", not zero): `MIN_LAST_YEAR_TOTAL = 12`
(also naturally excludes anyone who wasn't a user last year), `MIN_LAST_YEAR_TO_DATE = 4`,
and a `MIN_FRACTION = 0.15` floor so one lopsided year can nudge the blend without
dominating it.

The equal weighting is a design call, not a bug — favouring recent behaviour more heavily
is defensible but shouldn't be changed unilaterally.

Note two computed-side-effect lint errors here are suppressed with an inline disable +
TODO rather than rewritten — that logic has a documented bug history and no coverage.

## Places tab (2026-09-08)

Fifth tab, accent `#f0ad4e`. Three pure sources in `places.js`, tested directly:
`placeRows` → `favouritePlaces` (ranked by the average shrunk toward the library's own,
`RANK_SHRINK`, three films minimum — "I really like movies set in Paris" is a pattern,
one great film isn't) and `mostVisitedPlaces`; `countryCoverage` rolls set/filmed points
into countries through `countryLookup.js` (ray-cast against `worldCountries.json`, with a
nearest-vertex fallback so coastal cities don't fall in the sea) plus made-in via TMDB's
ISO codes. `CoverageMap.vue` shades countries by quantile — a choropleth, never dots,
because a country centroid can't lie on a shaded country — and **zooms** (pinch, drag
once zoomed, buttons, ctrl+wheel; `touch-action` is `pan-y` at 1x so a finger still
scrolls the page) with country names appearing where they fit. The stage is **square**
(a square window on the grid, world centred, ocean filling the rest) and pointer moves
are read from the **window** once a gesture starts — the world's own 2.5:1 strip was
too short to pinch in, and iOS dropped the gesture the moment a finger left the box. Data is Natural Earth
**50m** on a 4000-wide grid, tiny islands dropped and coastlines Douglas–Peucker'd (62K
gzipped, measured against 110m's 35K and raw 50m's 212K), loaded **lazily** when the tab
opens — `world` is a required prop, never imported by the component. The set/filmed choice
persists in `localStorage` (`cinemaRoll.insights.placeType`) — tests must clear it.
Every tap on a place hands Home a real `place` chip (`searchPlace`), the MovieDetail way.

## Years by box office (Ratings tab, 2026-09-13)

`BoxOfficeYears.vue` sits directly under `YearlyAverage` and is its deliberate twin —
same card, same rows, the other question: "a rank of years based on total box office
for the movies that I brought in". Release years, summed **worldwide** gross
(`movie.revenue`, TMDB's 0 = unknown, skipped and not counted), math in
`boxOfficeYears.js` (pure, tested). The toggle is the point: **today's dollars** (the
default, through `inflation.js`) or **as released**; a sum across eighty years in raw
dollars quietly favours the recent decades. Choice persists in `localStorage`
(`cinemaRoll.insights.boxOfficeDollars`) — tests must clear it. Tapping a year runs the
same year search the best-years list does.

## People by box office (Ratings tab, 2026-09-16)

`BoxOfficePeople.vue` sits directly under `BoxOfficeYears` and is its twin one more time
("highest grossing directors and highest grossing performers, and maybe even crew"):
same card, same dollars toggle (and the same `localStorage` key, so both cards open in
the same dollars), plus a sideways row of role pills persisted at
`cinemaRoll.insights.boxOfficeRole`. Math in `boxOfficePeople.js` (pure, tested): crew
matched by JOB the way `deepStats.js` does, performers by `TOP_BILLING` (5) only, one
credit per person per film. Tapping a name runs a plain search for it, so the sections
answer which roles the money came from.

## Deep Stats

`/stats` renders only; every section is a pure function in `deepStats.js` or
`decadeChampionship.js`, tested directly. Log Score for every group, whole-library
average as the Bayesian anchor throughout.

**Decade Championship (2026-09-02)** buckets by RELEASE decade, not watch year — it's
about the decade the work belongs to. Nobody qualifies on one film (`minFilms: 2`);
Matt's worry about thin decades is answered by the Log Score's Bayesian pull, not by a
higher floor. The engine returns FULL ranked lists (films to `depth`) and the screen
takes what it needs, because the cast list has to be walked past the top to fill Actor
AND Actress.

**One sideways row of winners, a portrait per person and a poster for the film; tap a
winner to unfold the field beneath.** Four layouts on 2026-09-02, and three are
rejected: full poster cards with three per category plus Producer/Genre/Studio ("too
much content"); one winner per row as a thumbnail ("too small of a portion of the
layout", and he missed the top three); a podium of three posters per row. Then: "people
portraits instead of movie posters for people... just a horizontally scrolling list...
one poster or photograph per winner", with the runners-up on tap. A person NEVER gets a
movie poster — portrait, or the not-available image (`Image_not_available.png`, the
PersonModal fallback).

- **The stored cast carries no gender.** Actor/Actress split takes one TMDB
  `/search/person` lookup per name (`personLookup.js`, cached by name at module scope
  so flipping decades is free), walked in rank order and RESUMABLE (`continueCastWalk`):
  one of each for the row, `depth` of each when Actor/Actress is unfolded, capped at
  `CAST_LOOKUP_CAP` per decade. Crew winners get a portrait via `ensurePortrait`. Someone TMDB can't find is skipped, as the Favorite sections do; a
  found person with no definite reading can win both (`genderEligibility.js`).
  **Offline the two collapse into one "Performer" row** rather than vanishing.
- Pass explicit weights to `personLogScore`: its destructuring default turns an
  `undefined` billingWeight into "no billing", which scored a decade's cast as crew.
  `decadeChampionship.js` normalises through `LOG_SCORE_DEFAULTS` for that reason.
- Tapping a person in the unfolded field opens the shared `PersonModal` with their
  DECADE credits only; a film goes to the movie.

## Favorite sections

Eight sections share `src/mixins/favoriteTuning.js`, which holds **only** type-agnostic
plumbing (TMDB details cache, Firebase load/save of tuner values, `bayesianAverage`,
boot). Every section keeps its own `tuningDefaults`, lever values, gather logic and
scoring quirks. The mixin holds zero tuning values.

**Gather/rescore split = no re-fetch while tuning.** `buildTopTwelveList` gathers once per
data load; `rescore` scores with current levers, lazily fetching only for the eligible
set, guarded by a `rescoreSeq` token that drops superseded async passes. Dragging a slider
must never re-hit TMDB (enforced by test).

**One person, one film, one credit.** Every section gathers by walking a film's cast or
crew and pushing an appearance per match, which double-counts anyone holding two
qualifying credits on one film (a writer credited "Screenplay" AND "Novel", an actor in
two roles). That inflates their film count past `minEntries` and feeds the same rating
into `personLogScore` twice, so it moves the RANKING, not just the displayed list. Run
appearances through `dedupeAppearancesByFilm` (`personCredits.js`) before the
deterministic sort — it keeps the best billing, so a lead isn't demoted by a second
credit further down the cast list. Measured before the fix: 264 doubled writer credits,
55 producer, 31 cast.

**`PersonModal.vue` is shared by all eight sections.** They each carried their own
near-identical copy, which is exactly how they drifted (inline styles on the portrait in
some, none in others, credits never sorted). Anything that should be true of "tapping a
favourite person" goes in that one component. It takes `person`, `roleLabel`, `rank` and
`libraryAverage` (from the mixin's `libraryAverageScore`), and emits `close` / `search` /
`select-film`.

**Biographies need `/person/{id}`.** The mixin's `getDetailsForCastMember` uses
`/search/person`, which carries id, name, profile_path and popularity — and NO
biography, birthday or place of birth. PersonModal makes its own lazy lookup when it
opens, one person at a time, cached by name across sections (a writer-director appears
in two lists) with misses cached too so a rate-limited lookup isn't retried on every
open. A failed lookup is silent: the films are the reason the modal exists.

Known-for bonus intentionally differs by section — Directors/Composers blend the role
sub-score; Writers/Cinematographers/Editors/Producers use plain `calculatedTotal`. Cast
sections re-gather each pass and gender-gate via cached lookups.

## Stickiness

Build updated ratings with `.map()`. See `.claude/rules/data-writes.md` — `{ ...array }`
corrupts the shape and silently zeroes the entry's score, which puts the movie back in the
stickiness queue permanently.

After saving, stay on the form and advance to the next movie; only collapse the panel once
the queue is genuinely empty. Build the `dbEntry` *before* dispatching, since the local
commit is synchronous and `firstStickinessResult` already points at the next movie.

## The Web (2026-09-09)

`/web` draws the library as one picture: films and the people who appear in more than
one, one thread per credit (`web.js`, pure and tested; `WebScreen.vue` draws it on a
canvas with d3-force). `?movie=<tmdbId>` / `?person=<name>` is the two-hop web around one
node; the card's "web around" button walks. Entry points: the Insights directory, the
Cast heading on MovieDetail, and "See their web" in `PersonModal`. Matt's brief:
"a visualization that lets me zoom in and pan around to look at the web of my whole
database."

Things learned laying out 3,600 nodes, all measured on Matt's real library:

- **`markRaw` the graph.** Vue proxies on thousands of nodes made every draw ~10x slower
  and the settle unwatchable.
- **The whole layout runs in a Web Worker** (`webLayout.worker.js`) and is remembered in
  `localStorage` keyed by the web's shape plus `LAYOUT_VERSION`; bump the version when
  the dials change.
- **Never give `forceManyBody` a short `distanceMax`.** A cutoff piles nodes into shells
  at exactly that distance from every hub — rings all over the picture. Leave it
  effectively off and use a coarse `theta` for speed instead. Use d3's default link
  strength (degree-aware); a fixed strength pinned every co-star at one radius.
- **Debounce the rebuild on the entries getter** — it changes many times a second while
  the library streams in.
- Label budgets are dials at the top of `WebScreen.vue`; a phone-width focus web names
  only the centre and its first hop until you zoom.
