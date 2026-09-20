# Cinema Roll

A personal movie rating and tracking app (Vue 3, Options API). Users rate movies across
weighted criteria, track viewing history, and get insights into their patterns.

**Live**: [cinemaroll.org](https://www.cinemaroll.org/) — S3 + CloudFront, via `yarn deploy`.
(Old hosts surge.sh and Vercel are dead — the stray Vercel project from a
June 2024 experiment was deleted in Aug 2026. Don't resurrect either host.)

## How this documentation is organised

This file holds only what's true in **every** session. Deeper guidance lives in
path-scoped rules that load automatically when you touch the relevant code, and the full
development narrative is archived and read on demand.

| Working on | Loads automatically |
|---|---|
| any `.vue` / SCSS | `.claude/rules/vue-ui.md` |
| `src/components/games/**`, `games/*.js` | `.claude/rules/games.md` |
| `Home.vue`, `searchFiltering.js`, `entityCounts.js` | `.claude/rules/home-search.md` |
| `store/**`, `utils/**`, `AddRating.js`, backfills | `.claude/rules/data-writes.md` |
| awards modules, `PersonalAwardsModal`, `TweakInline` | `.claude/rules/awards.md` |
| `MovieDetail`, `Insights`, `Favorite*`, services | `.claude/rules/detail-and-insights.md` |
| `src/test/**` | `.claude/rules/testing.md` |
| login, `databaseKey.js`, db rules, `aws-lambda/**` | `.claude/rules/auth-and-db-rules.md` |

Archived narrative — post-mortems, why decisions were made, what was tried and rejected.
**Read these with the Read tool when you need the detail**; they are deliberately not
imported, so they cost nothing until then:

- `docs/history/search-and-home.md` — chips, grouping, perf work, fuzzy search, onboarding
- `docs/history/games.md` — all ten games, round by round
- `docs/history/data-and-offline.md` — offline rating, PWA, cost control, delta sync
- `docs/history/awards.md` — personal awards, Trophy Case, tiebreak tournaments
- `docs/history/ui-and-layout.md` — layout bugs, image perf, MovieDetail, Insights
- `docs/history/tooling-and-auth.md` — lint/CI, sign-in, bug reporting, versioning
- `docs/history/mixed-bug-rounds.md` — assorted bug-report rounds
- `docs/history/geography-removed.md` — maps feature, built and removed; read before any
  second attempt

> Reference other files by plain backticked path. **Never with `@`** — that's an import,
> and imported files load into context at launch, which defeats the whole structure.

## Rules that always apply

### Never interfere with the dev server

The user keeps `yarn serve` running in another pane and relies on it continuously.
**Do not run `yarn serve`, `pkill`, or anything that touches existing processes.** Use
`yarn test:run` for verification, and ask the user to check features in their own server.

### Mobile-first: `:active`, never `:hover`

This is an iOS-installed PWA. A tapped element keeps its hover state with no mouse to
leave it. This has shipped as a user-visible bug more than once.

### Always check contrast

Dark themes throughout. Verify text is legible against its actual background before
shipping any UI change. Bootstrap's `.text-muted` fails against this app's dark panels.

### Keep tests current, and prove they guard something

Write tests first where practical. When a feature lands, update existing tests, add new
ones, remove stale ones. The convention here is to **temporarily revert a fix and confirm
the test fails with the bug's real signature** — several tests in this repo were found
passing against broken code.

### Keep this documentation updated

When you learn something durable, put it in the right place:

- a rule that applies to one area → the matching `.claude/rules/*.md`
- a fact true in every session → this file
- the story of what was tried and why → the matching `docs/history/*.md`

Keep this file **under ~200 lines**. It grew to 275KB once — ~74k tokens on every single
request — which is what prompted this structure.

## Hard constraints

**Node is pinned to 20.20** (`.tool-versions`, and CI), raised from 18.18 on
2026-08-16. That lifted the three constraints it used to force: ESLint is now **10**,
`firebase-admin` is **^13**, and `--env-file` is available (scripts still use
`scripts/loadEnvLocal.mjs`, which works fine — swapping it is optional cleanup, not a
requirement).

ESLint 10 needed `eslint-plugin-vue` **10** and an explicit `vue-eslint-parser`
dependency: 10 removed `context.getSourceCode()`, which older plugin versions call.

**`.yarnrc` sets `--ignore-engines`.** It was there for `@achrinza/node-ipc`, a
transitive dependency of `@vue/cli-service`'s dev server, which capped `engines` at
Node 19. The Vue CLI dev server went away with the Vite move (2026-09-14), so that
particular excuse is gone — the flag is now unexamined rather than justified. Try
removing it, and don't let it quietly excuse a real incompatibility.

## Rating system

Weighted criteria, combined into `calculatedTotal`:

| Criterion | Weight |
|---|---|
| Love | 2.8 |
| Overall | 2.0 |
| Stickiness | 1.9 (÷2) |
| Story | 1.25 |
| Direction | 1.1 |
| Imagery | 0.9 |
| Performance | 0.7 |
| Soundtrack | 0.3 |

`GetRating.js` is uncached and moderately expensive — never call it inside a sort
comparator (see `.claude/rules/home-search.md`).

**Precision (2026-08-21): scores are computed to FOUR decimals, displayed at TWO.**
"The score is the rank" — Matt rejected keeping a separate ranking order, so
sorting precision comes from decimals the screens never show (`formatScore.js` is
the only display path; a template rendering `calculatedTotal` raw is a bug, and
`scorePrecision.test.js` guards the known ones). Tiebreak tournament verdicts
land on the fourth decimal (`tweakDeltaForRank`, −0.0001 score per rank) so a
verdict re-orders its group without moving any displayed number. Old tournaments
wrote ±0.01-scale tweaks; they're deliberately not migrated — they encode real
verdicts, and rescaling would change displayed scores. `calculatedTotal` is never
persisted, so the precision change applied to the whole library retroactively
with no data migration.

## Data

Firebase Realtime Database, keyed by the user's sanitized email:

```
/{user-email-key}/
  ├── movieLog/            # rated movies
  ├── settings/            # preferences, tags, personal awards, game wins
  ├── newsletter/          # prefs, the client-published taste profile, issues
  └── academyAwardWinners/ # cached awards data
/bugReports/               # write-only by clients; triage via Admin SDK
```

External data: TMDB (movie metadata), OMDb (Rotten Tomatoes + Metacritic, newsletter
only, server-side key), a `film-awards-api` on Railway (Academy Awards),
`src/assets/data/otherAwardsWinners.json` (Golden Globes / BAFTA / Cannes / Venice,
scraped from Wikipedia wikitext), Letterboxd (scraping + deep links).

## Layout

- `src/components/` — Vue components (~40)
- `src/components/games/` — the ten games
- `src/assets/javascript/` — pure, store-free logic (search, rating, awards, games)
- `src/mixins/` — `gameData.js`, `favoriteTuning.js`
- `src/store/index.js` — Vuex + Firebase
- `src/utils/` — IndexedDB queues, bug reports, small helpers
- `src/test/` — ~79 Vitest files
- `aws-lambda/` — the AI endpoint, push sender and weekly newsletter (separate
  deployables, not linted). See `.claude/rules/auth-and-db-rules.md`.
- `scripts/` — db-rules generator, bug-report triage

**Preference: extract pure logic into `src/assets/javascript/` and unit-test it directly**
rather than only through component mounts. That's why `searchFiltering.js`,
`entityCounts.js`, `tieBreakTournament.js`, `awardStats.js`, `storedEntry.js`,
`syncStamp.js` and the games modules exist as separate files.

## Commands

| | |
|---|---|
| `yarn serve` | dev server — **the user runs this, not you** |
| `yarn test:run` | run tests (use this to verify) |
| `yarn test:coverage` | coverage |
| `yarn lint` / `yarn lint:fix` | `eslint .` (flat config, not vue-cli-service) |
| `yarn build` / `yarn deploy` | build (Vite) / deploy to AWS S3 + CloudFront |
| `yarn preview` | serve the built `dist/` locally — how a production build gets eyeballed |
| `yarn generate-db-rules` | regenerate `database.rules.json` — never hand-edit it |
| `yarn newsletter-dry-run` | build this week's newsletter BRIEF from live data — no keys, no writes, no model call |
| `yarn newsletter-e2e` | build a REAL issue end to end (model included) against the tester account |
| `yarn fetch-bug-reports` | unresolved in-app bug reports, newest first |
| `yarn resolve-bug-report <id…>` | mark reports resolved |

### Versioning — apply real judgment

Only `yarn deploy` bumps the version (since 2026-08-15; `yarn build` builds the
current version, so check-builds are free, and a failed build rolls the bump
back — no more gap numbers). Non-interactively the bump **defaults to PATCH**.
Set it explicitly:

```
VERSION_BUMP=minor yarn deploy
```

PATCH for fixes and tweaks; MINOR for a genuine new user-facing capability (a new game, a
new section, offline support); MAJOR only for a breaking change. When in doubt, patch.

**After deploying, always tell the user the resulting version.**

The version reaches the screen as the **house build stamp** (2026-08-22, a blanket
policy across all of Matt's apps): one muted line reading
`v1.96.4 · built Aug 22, 1:32 AM`, rendered in the footer — on screen everywhere — with
the version half alone in the header's corner badge. `vite.config.mjs` sets
`VUE_APP_BUILD_TIME` when the build starts (via `define`; `vue.config.js` did it before
2026-09-14), so the time is the BUILD's, never the page load's: a tab left open for a week keeps showing the build it's still running.
`src/assets/javascript/buildStamp.js` is the only formatter.

## Environment

- `VUE_APP_GOOGLE_API_KEY` — Firebase/Google
- `VUE_APP_TMDB_API_KEY` — The Movie Database
- `VUE_APP_ENABLE_APPLE_SIGNIN` — leave unset until Apple sign-in is configured
- `VUE_APP_BUILD_TIME` — not in `.env`; set by `vite.config.mjs` per build (see above)
- `FIREBASE_ADMIN_KEY_PATH` in `.env.local` (gitignored) — for the triage scripts
- `VUE_APP_PUSH_API_URL` / `VUE_APP_VAPID_PUBLIC_KEY` — push notifications
  (`aws-lambda/push-notify.js`; details in `.claude/rules/auth-and-db-rules.md`)

## Open work

- **Tightened Firebase database rules deployed 2026-08-14** (supervised). Unauthenticated
  reads are denied everywhere; the `updatedAt` index is live. The unauthenticated
  `testing-database` sandbox trick no longer works — see `.claude/rules/auth-and-db-rules.md`.
- **Delta sync is fully live (phases 2/3, 2026-08-17).** Launches normally download
  only changes since `lastSync`; full download + shadow comparison every 3 days per
  device. Watch `yarn delta-shadow-report` and the in-app error log for `[delta-shadow]`
  divergences. Details in `.claude/rules/data-writes.md` and
  `docs/history/data-and-offline.md`.
- **Places (second attempt, 2026-09-08) is live**: Wikidata filming/story locations as
  search chips, "Set In / Filmed In" on the movie page, and an Insights **Places** tab
  (favourite places, most visited, a country coverage map). No dot maps this time —
  `docs/history/geography-removed.md` explains why the first attempt was pulled and
  what this one kept. Street-level "near me" is round two, and the data is city-level.
- **The Web (2026-09-09) is live**: `/web`, the library as a zoomable, walkable
  picture of films and shared people. Rules and the layout lessons in
  `.claude/rules/detail-and-insights.md`.
- Known issues: rating a perfect 10, database sharding as the library grows.

## Testing against real data

Use the Firebase `testing-database` path (via the in-app dev-mode toggle) for anything
that mutates data. **Never use the real account for that.**
