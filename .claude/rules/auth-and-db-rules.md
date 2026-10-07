---
paths:
  - "src/components/Login.vue"
  - "src/assets/javascript/databaseKey.js"
  - "src/assets/javascript/authErrors.js"
  - "scripts/generate-database-rules.mjs"
  - "database.rules.json"
  - "aws-lambda/*.js"
  - "src/utils/aiRequest.js"
---

# Auth & database rules

Full narrative: `docs/history/tooling-and-auth.md`.

## The tightened database rules are DEPLOYED (2026-08-14, supervised)

Live since 2026-08-14: default-deny, per-account access only, `bugReports` write-only,
share links readable, `testing-database` restricted to the owner account, and the
`updatedAt` index (delta-sync prerequisite). Verified at deploy time: unauthenticated
REST reads denied on settings/movieLog/bugReports; Admin SDK scripts unaffected.

`yarn deploy` does **not** touch rules — `firebase deploy --only database` is separate,
deliberately, and any future rules change should still be deployed **supervised**: a bad
deploy shows live users an empty library. `LibraryAccessBanner.vue` (driven by
`state.dbReadDenied`, set by the listeners' error callbacks) is the user-facing guidance
if a device loses read access.

**The global `firebase-tools` install is broken** (upstream ESM-only `uuid` under
`universal-analytics`). Deploy with a fresh `firebase-tools@13` install carrying an npm
override `{"uuid": "8.3.2"}` — Node is pinned to 18, so firebase-tools 14 (Node 20+) is
not an option yet.

## The constraint everything follows from

**A user's entire library is keyed by their email address**, sanitized to a database key.
So any auth provider must return a stable email — which rules out anonymous sign-in and
makes Apple's "Hide My Email" fine (stable per-app relay).

- **`databaseKey.js`'s `emailToDatabaseKey` is the single source of truth.** It
  deliberately does **not** lowercase — adding `.toLowerCase()` would silently re-key
  every existing account containing an uppercase character, pointing it at an empty
  database. Case is normalized in the login form instead.
- **`databaseKeyCharacters.json`** holds the character list because the rules generator is
  a plain Node script that can't import an ES module here. Don't regex-scrape it out of
  the JS — the list contains `','`.
- Every provider funnels through **`completeLogin(user)`**, which **throws** rather than
  proceeding if no email comes back. Silently dropping someone into a wrongly-keyed empty
  database is far worse than refusing the sign-in.

## Generated rules

`database.rules.json` is **generated** — `yarn generate-db-rules`. Never hand-edit it.
The rules language has no regex, only `String.replace` (which replaces *every*
occurrence), so the email→key transform is a ~29-call chain generated from the shared
character list. `src/test/databaseRules.test.js` reads the generated file, applies the
chain in JS with `replaceAll`, and asserts byte-identical output to `emailToDatabaseKey`.

`.indexOn: ["updatedAt"]` under `$topKey/movieLog` is required for delta sync. **Without
it the query does not fail** — Firebase downloads the whole node, filters client-side, and
logs only a console warning, so the saving would be exactly zero.

## The AI lambda is authenticated

`aws-lambda/claude-ai.js` verifies a **Firebase ID token** (node `crypto`, no
`firebase-admin`). The **audience and issuer checks are load-bearing** — without them a
valid token from *any* Firebase project is accepted. CORS is not the gate; it only
constrains browsers. Client side, `src/utils/aiRequest.js` is the only place that attaches
the token, so no caller can forget.

The API Gateway `$default` stage is throttled to rate 2 / burst 10. Note the AWS account's
Lambda concurrency limit is **10**, and overflow surfaces as **503**, not 429. None of
this is a spend cap — only a limit on the Anthropic API key is.

## Verifying an authenticated write without signing in

**Dead since the 2026-08-14 rules deploy.** The old trick (set
`localStorage.databaseTopKey = 'testing-database'` in an unauthenticated session and
navigate by hash) relied on the open rules; `testing-database` now requires the owner
account's token. Live verification that mutates data now needs a real signed-in session —
i.e. Matt driving his own device with the dev-mode toggle — or the Admin SDK for
server-side checks (which bypasses rules entirely and still works for scripts).

## Admin scripts

Must live **inside the repo** — Node resolves `firebase-admin` relative to the importing
file, so a script in a scratchpad fails with `ERR_MODULE_NOT_FOUND`. Use
`scripts/loadEnvLocal.mjs`, not Node's `--env-file` (that needs Node 20.6+; this repo is
pinned to 18.18). **If an admin script hangs for minutes with no output, check the
`databaseURL` first** — a wrong one doesn't error, it retries forever. The project is
`movie-log-8c4d5`.

## Movie Hat is a second, independent sign-in — and its 401s have three causes

`movieHat.js` / `movieHatAuth.js`. Movie Hat is a **different Firebase project**, so a
Cinema Roll ID token is worthless there: Cinema Roll holds its own session in a named
Firebase app (`movieHat`) with its own Google popup. Since Movie Hat's rules went on
2026-08-17 an unauthenticated hat request is refused outright, so **never fall back to a
tokenless request** — it can only 401.

Firebase answers a rules refusal with **401 and `{"error": "Permission denied"}`**, the
same status as an unusable token. Three very different problems, one status code, and
the old code threw the body away and reported `Movie Hat responded 401` for all of them.
`MovieHatAccessError.reason` is what separates them:

- `not-connected` — no Movie Hat session on this device. Sign in.
- `token-failed` — a session exists but `getIdToken()` failed (revoked, or offline).
  Distinct from the above on purpose: telling someone they were never signed in when
  they plainly were sends them looking in the wrong place.
- `denied` — a good token the rules still refused. **Almost always the wrong Google
  account**: hat access is per member address, so being connected as a second account
  (or as `movie-hat-tester@example.com`) is indistinguishable from being signed out
  unless you name the account. `DrawFromHat` names it.

Verify with the real thing before theorising — the rules, data and membership have all
been checked correct: `yarn mint-hat-token` in the movie-hat repo, exchange it at
`identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken`, then hit the REST
API with `?auth=<idToken>`. The tester reaches Dev Hat and nothing else, which also
demonstrates the rules working.

**Sign-in failures say which (2026-10-01).** A new user's "Cannot sign into Movie Hat"
arrived with nothing to go on. Now `movieHatSignIn.js` turns the Firebase auth code into
a sentence (blocked popup, network, Safari storage…; unknown codes still name the code),
`state.movieHatLastFailure` keeps the last sign-in or lookup failure, and bug reports
carry a `movieHat` block (connected-as, linked/found counts, access reason, last
failure). A lookup that fails AFTER a good sign-in throws with `movieHatStage: 'lookup'`
so the screen doesn't call it a failed sign-in. Settings hides "Find my hats" until
connected (it could only fail before), and a connected account in no hats is told hats
are by invitation.

**Read only what you need.** The hat read rule sits at `hats/$title/$hatKey`, so a child
path like `.../movies.json` needs no rule change. `ensureMovieHatContents` wants TMDB ids
only and used to call `fetchHat`, pulling whole hat nodes — history included, ~1.9MB
across Matt's six hats, one of them 882KB alone — every ten minutes, billed as egress on
Movie Hat's database. Use `fetchHatMovies`.

Note the client's `emailToMemberKey` **mirrors** `src/store/memberKey.mjs` in the
movie-hat repo, which also generates that project's rules. Change one, change both.

## The AI endpoint's spending caps

`aws-lambda/claude-ai.js` has two limiters, and they do different jobs.

**In-memory, per user, per minute** (`withinRateLimit`) — applies to every route. It is
per-container, so a burst spread across concurrent Lambdas slips through it and a cold
start wipes it. That is fine for what it is: a speed bump on the three routes that fire
automatically while you browse (~5k calls a day, which is why those can't carry a daily
per-person cap).

**Durable, per user AND global, per day** (`checkWatchlistQuota`) — applies to `/watchlist`
ONLY, the one route a person types into. Matt, when it was built: *"I don't wanna just
hand over my Claude prompt to just any number of users and have them abuse it... limit
usage in a way that most users won't notice, but if somebody really went crazy, they
would be held in check."*

- DynamoDB table **`cinemaroll-ai-usage`** (us-east-1, on-demand), key `pk`, TTL on
  `expiresAt`. The Lambda's role carries an inline policy `cinemaroll-ai-usage-table`
  granting only `UpdateItem`/`GetItem` on that table.
- Keys are `u#<uid>#<YYYY-MM-DD>` and `all#<YYYY-MM-DD>`. Limits: **60 per person per
  day, 800 across everyone.**
- The increment and the check are ONE conditional `UpdateItem`, which is what makes it
  safe under concurrency — two simultaneous calls cannot both see 59 and both proceed.
  A `ConditionalCheckFailedException` IS the "over limit" answer, not an error.
- It **fails open**. If DynamoDB is unreachable the request is allowed: a spending cap
  that takes the feature down when its ledger is unavailable trades a small bounded cost
  for a visible outage, which is the wrong way round. API Gateway's stage throttle is the
  backstop underneath.

**Adding a route needs THREE things, not one.** A new `route.endsWith(...)` branch in the
handler is invisible until you also add the API Gateway route and the Lambda invoke
permission — the permissions here are scoped per path (`.../*/*/watchlist`), not
wildcarded. Missing the route gives a 404 with no log line; missing the permission gives
a 500 with no log line, because the invocation never reaches the function:

```
aws apigatewayv2 create-route --api-id 2lyldox07e --route-key 'POST /watchlist' \
  --target integrations/9xdv8nl --profile personal
aws lambda add-permission --function-name cinemaroll-ai --statement-id apigw-invoke-watchlist \
  --action lambda:InvokeFunction --principal apigateway.amazonaws.com \
  --source-arn 'arn:aws:execute-api:us-east-1:298682183644:2lyldox07e/*/*/watchlist' --profile personal
```

**`/reviews` (critics' reviews, 2026-10-06) is asynchronous**, like the newsletter rebuild:
a search-and-judge call can outlast API Gateway's 30s. The route answers from DynamoDB
table **`cinemaroll-film-reviews`** (key `film#<tmdbId>`, TTL `expiresAt`, one answer per
film for everyone), else claims the film with a conditional put and Event-invokes the same
function with `{ reviewsJob }` (a top-level event key an HTTP caller can't set), answering
`pending`. **The request supplies only the id**: title, year and director come from
TMDB's record of it (`lookupFilm`, env `TMDB_API_KEY`; the pure `filmFromTmdb` is tested) —
on 2026-10-06 a smoke test sent Godfather Part III's title with The Little Mermaid's id and
the Mermaid's shared entry held Godfather reviews until it was deleted by hand. An unknown
id is a 404 and starts nothing. Only a lookup that starts a job counts against its own daily
caps (25 per person, 150 overall, ~20 cents each). Needs, beyond the code: the table, an inline role
policy (Get/Put on it, InvokeFunction on `cinemaroll-ai` itself), the function timeout at
120s, and the route + permission per the THREE-things rule. Uses the BASIC
`web_search_20250305` with `blocked_domains` — `allowed_domains` is refused outright when
it names a crawler-blocked site, and the dynamic-filtering search picked fewer reviews.

**Ask for structured data with a forced tool call, not with a JSON-shaped prompt.**
`/watchlist` first asked for JSON in the system prompt and prefilled the reply with
`{"movies":` to force the shape. The suggestions were good every time; reassembling the
document was what broke — the continuation sometimes re-emitted the colon
(`{"movies"::[`) and sometimes omitted the array bracket, both unparseable, and both
invisible until the raw reply was logged. `tools` + `tool_choice` has the API validate
the arguments against a schema and leaves nothing to parse. It also fixed vague prompts
("x", "one more"), which used to get a conversational reply and come back empty.

## The Letterboxd sync rides in the newsletter Lambda (2026-09-29)

`aws-lambda/letterboxd.js` (+ pure `letterboxdSync.js`, tested from
`src/test/letterboxdSync.test.js`) is bundled INTO `cinemaroll-newsletter` rather than a
function of its own: that Lambda already holds `FIREBASE_SA` and the account sweep, and
copying the key into a new function is exactly the kind of credential handling a session
shouldn't do. Entry points: EventBridge `cinemaroll-letterboxd-reviews` (rate 6 hours,
Input `{"letterboxdSweep":"reviews"}`) and `cinemaroll-letterboxd-films` (cron 09:15 UTC,
`{"letterboxdSweep":"films"}`), and HTTP `POST /letterboxd/sync` / `/letterboxd/film` on
the newsletter API (`lpou4xxxng`, `$default` route, so no route to add). The Lambda's
timeout was raised to **600s** for the film backfill; the handler now takes `context` for
the deadline. `letterboxdFilms` is a shared root and is in `NON_ACCOUNT_ROOTS` in BOTH
Lambdas — keep it there or the sweeps treat it as a person. **Adding a shared root means
redeploying `cinemaroll-push` in the same sitting:** the source list was updated but the
push Lambda wasn't, and within fifteen minutes Matt's phone announced that "Letterboxd
Films" had just signed up for Cinema Roll (2026-09-29).

**Deploy with `yarn deploy:newsletter` and check the zip.** The bundle directory under
`$TMPDIR` was once found with hollow `node_modules` (57 dirs, 83 KB zipped) and shipped a
Lambda that died on `Cannot find module 'web-push'` — the newsletter would have failed
that Friday. A healthy zip is ~13 MB / ~4,900 files; `rm -rf` the bundle dir and rerun if
it isn't. The script uses `~/aws-cli/aws` (the PATH `aws` is Intel on this Mac).

## The push Lambda (`aws-lambda/push-notify.js`, deployed as `cinemaroll-push`)

Web push notifications (2026-08-27). Same auth pattern as the AI lambda — Firebase ID
token verified with node crypto for the HTTP routes (`/push/test`, `/push/friend-logged`,
`/push/friend-request`). **"Did a friend's push go out?" is a CloudWatch search, not a
guess** (2026-10-06, Sky's V/H/S): every friend-log announcement logs
`Friend log from <key> (<title>): N live mutual(s), M push(es) delivered`, and a rejected
token logs `Rejected POST <path>`. No line at all means the client never announced
(offline, sharing off, an edit, or a placeholder id)
— plus a second entry mode: an EventBridge rule (`cinemaroll-push-hourly`, now
`rate(15 minutes)` — the name is historical) that runs the chore sweep with **admin**
RTDB access. Admin access
is an OAuth token minted from the service-account key (`FIREBASE_SA` env var) — no
firebase-admin dependency, the zip stays ~200KB, and the deploy needs no rules change
because everything lives under `{topKey}/push/` (owner-writable already).

**The design rule: the client computes, the server sends.** `src/assets/javascript/
pushDigest.js` publishes what's due (with FUTURE stickiness boundary timestamps so the
server counts forward in time); the Lambda only formats and sends. Never port prompt
logic into the Lambda — fix the digest instead.

**Cadence is NEWS, not STATE** (2026-08-28, Matt: notify "as the prompts come in", not
once a day). `aws-lambda/pushCadence.js` is pure, dependency-free CommonJS and owns every
send/don't-send decision; `src/test/pushCadence.test.js` imports it directly, which is
the only tested code in `aws-lambda/`. Keep it that way — the hard part of this feature
is not nagging, and it is entirely in that file.

The rule that makes frequent sweeps tolerable: a send requires something that wasn't true
last time we sent — more matured stickiness films than we've mentioned, a tiebreak where
there wasn't one, an unnamed award year. A `state/baseline` node records what's been said;
it ratchets **down** freely (so finishing chores re-arms them) and up only on a send.
Three further guards: a waking window, spacing = window / `pushesPerDay`, and **silence
while the app is open** (`digest.updatedAt` within 30 min — the prompts are already on
screen). A 24h staleness backstop re-mentions unfinished work so one ignored notification
isn't the last word. `prefs.cadence = 'daily'` restores the original single-nudge mode.

**The games reminder is a second stream** (2026-09-07, Matt: "an optional notification,
one that defaults to off... that reminds you to play the games every day, maybe even you
can choose per game"). `prefs.games` (default **false**), `prefs.gamesHour` (20), and
`prefs.gamePicks` (`{ [gameKey]: false }` mutes one; absent = on, so new games join
automatically). The digest carries `games.list` — every game's key, name and
`lastPlayedAt` (latest history round or win stamp) — and the Lambda's `gamesDue` names
only the games not yet played **today in the user's timezone** (`localDateKey`); a day
with everything played sends nothing. Once a day at the chosen hour, `state/gamesSentAt`,
tag `games` (never replaces a chores notification), no badge. All decisions in
`pushCadence.js`, tested alongside the chores.

**The digest is flushed when the app goes away** (2026-10-05: "I just received a
notification that two films were tied. I tapped the notification, it brought me to the
home screen. There's no tie being presented to me"). App.vue republishes the digest on a
5-second trailing debounce, and a backgrounded PWA runs no timers — so a change made just
before the phone went in a pocket never reached the server. Here: a tiebreak settled at
3:09 restarted the tiebreak quota (next one 5:33), the digest saying so never left, and
at 3:50 the sweep announced a tie from the pre-tiebreak copy that Home then refused to
show. `flushPushDigest` runs a PENDING digest from `visibilitychange → hidden` and
`pagehide`, the same pair `flushSocialPublish` uses (no-op when nothing is pending).
`App.test.js` guards it. Anything else the server decides from a debounced client
write needs the same flush.

**The icon badge is set by the app too, never just cleared** (2026-09-27: "never shows
badges when it has things I need to do"). `refreshAppBadge` (store) counts chores with
`appBadge.js` — a mirror of `dueFromDigest`'s arithmetic, pinned to it by
`appBadge.test.js` — on load, after each library/settings change (the digest debounce),
and on every visibilitychange both ways. Zero clears. Film Club logs aren't counted: a
friend-log push adds one, and the app's recount on open drops it. Change one badge rule,
change both.

**New sign-ups ping the owner only** (2026-09-28: "It would be cool if I knew when
someone signed up"). Each sweep compares the shallow root listing against
`mattgrosso-gmail-com/push/state/knownAccounts` (`OWNER_ACCOUNT_KEY`); `signupsDue` and
`composeSignupMessages` in `pushCadence.js` decide and word it, tested. The first run
(no stored list) is silent and just records everyone; the list only grows; more than
three at once becomes one summary. The key can't be turned back into an email in
general, so `emailGuessFromKey` restores common providers (gmail, icloud, Apple relay…)
and shows the raw key otherwise; the name is `settings/social/displayName` or the
directory name when a brand-new account has one. The sign-in (Identity Toolkit) user
list would give real emails, but was not wired up — the SA's scope for it is untested.

**New Alamo listings ping the owner only** (2026-09-28: "notify me when new movies are
listed for my local Alamo" — DC Bryant Street; he refreshes the showtimes page by hand to
catch films the moment tickets open). Alamo has an open JSON feed per market,
`drafthouse.com/s/mother/v2/schedule/market/dc-metro-area` (market ids are numeric and
sequential; Bryant Street is cinema `1101`, Crystal City `1102`). `THEATERS` in the Lambda
lists each theater's feed and a `listings` adapter (`alamoListings`, tested) that turns it
into one entry per *presentation* — a film and its Big Show advance screening are separate
bookable things, so both are separate news. `listingsDue` and `composeListingMessages` in
`pushCadence.js` decide and word it: silent first run, seen map at
`push/state/theaters/<key>` ({ slug: lastSeenAt }), more than three at once is one summary.
Unlike sign-ups the map is NOT grow-only: a listing off the board for 14 days is forgotten,
so a repertory return (next October's Halloween) is news again, while one feed hiccup is
not. An empty board is treated as a failed fetch, never as "everything left". Each push
`navigate`s straight to the listing's ticket page — `buildPayload` now passes absolute URLs
through untouched — which is untested on iOS's declarative path; if a tap lands in the app
instead, fall back to `/`. Adding a theater is adding a `THEATERS` entry with its own adapter.

**Three more theaters the same night** ("the AFI in Silver Spring … the Miracle Theater …
a really small independent theater in Fairfax" — Cinema Arts Theatre). None has a JSON feed;
each `THEATERS` entry fetches a public page and hands it to a pure, tested parser in
`pushCadence.js`: `afiListings` (silver.afi.com/now-playing, one `movie_item` per Vista film
id, no dates on the page), `veeziListings` (the Miracle's Veezi "Show Times" page — film code
from the poster URL, dates carry no year so `veeziDateTime` infers it, the `<div` and its
`class` sit on different lines), `boxofficeListings` (Cinema Arts is a Webedia/Boxoffice
Gatsby site: `/api/gatsby-source-boxofficeapi/scheduledMovies?theaters=X050X` gives ids +
days, titles come from the static query `page-data/sq/d/3836549025.json`, with a scan of the
index page's `staticQueryHashes` if that hash ever moves). All seeded 2026-09-28 from the
Lambda itself, so none of the sites block AWS. The schedule runs ahead of the static list, so a
scheduled id with no title there is LEFT OUT (2026-09-29: it used to show as "Movie 1000026622");
left out means unrecorded, so it's announced by name once the site rebuilds.

**The pecking order, and the IMAXs** (later the same night: "if a movie is showing at more
than one theater, there's sort of a hierarchy … I'll always go to the Alamo first … only show
an IMAX listing if there are no showtimes at the Alamo or any of the other theaters … rank
Udvar-Hazy the best, then the Mall, then Silver Spring"). `THEATERS` is ORDERED and the order
is the rule: the sweep fetches every board first, then walks the list, and a fresh listing is
dropped when any earlier theater's current board carries the same film (`uncovered` +
`titleKey`, tested — case, bracketed years, "in 35mm", "New Restoration", Alamo's event
suffixes all fold). If a better theater's board couldn't be read, the lower ones WAIT that
sweep rather than announce something the Alamo may have. Covered listings are still recorded.
Order: Alamo Bryant Street, Alamo Crystal City (added 2026-10-05: "probably my number two";
same market feed, cinema `1102`, fetched once a sweep for both via `alamoDcFeed`), Miracle, Cinema Arts, AFI (its slot is a guess Matt hasn't confirmed), then the
IMAXs: Udvar-Hazy, Air and Space (the Mall), Regal Majestic (Silver Spring), AMC Georgetown,
AMC Tysons. Regal Gallery Place has 4DX and RPX, no IMAX. AMC Hoffman Center was on the
list until 2026-09-29, when Matt asked for it off ("I don't really know where AMC Hoffman
Center is"); its `push/state/theaters/imax-amc-hoffman` seen map was deleted with it.
Removing a theater is deleting its entry and that key — the board is rewritten each sweep,
and `loadTheaterBoard` prunes the dismissals/reminders of films no longer on it.

The IMAXs are read from **CinemaClock** (`cinemaclock.com/movie-theaters/<slug>`), the one
source that isn't bot-walled: Regal, AMC, imax.com and www.si.edu all answer 403 to a plain
fetch (dashboard.si.edu mirrors the Smithsonian site, but its showtimes JSON was empty and
its per-date markup unseen). `cinemaclockListings` (tested against markup cut from the live
page) joins each film's `btntim aw<id>` to the per-format sections `data-earliest-date=…
class="… filimax … fie<id>"`, keeps only `filimax` sections for the chains (the whole
theater is IMAX at the Smithsonian ones), and drops a section with no `data-time` (on the
books, not scheduled). Note `data-mid` is a streaming id, NOT the showtimes id. AFI listings
are enriched with a first showtime from the film's own page (`afiFirstShowtime`) only when
about to be announced — the grid has no dates and 97 detail pages a sweep would be silly.

**Every screen at the chains, and the Showtimes screen** (still 2026-09-28: "I'd be
interested in the non-IMAX screens at these other theaters as well … it would also be great
if I could see this somewhere on Cinemaroll"). The chain entries no longer pass `imaxOnly`;
each film carries `imax` (any `filimax` section) and the push says "(IMAX)". The sweep ends by
writing `mattgrosso-gmail-com/theaters/board` (`boardForApp`, tested): theaters in pecking
order, each film with `firstShowTime`, `imax`, `firstSeenAt` and `coveredBy` (the better
theater's key, or null) — marked, not dropped, because the screen has a toggle. Seen-state
rows are `{ f: firstSeenAt, l: lastSeenAt }` (a bare number is an old row). The app side is
`ShowtimesScreen.vue` at `/showtimes` (parent Insights; card on Insights with a "new" pill keyed
to localStorage `showtimesSeenAt`), store `loadTheaterBoard` (one `get`, never a write),
`showtimesScreen.test.js` pins the wiring. **Trap:** changing what a board counts without
deleting `push/state/theaters/<key>` first announces the difference as news — the IMAX-only →
all-screens switch sent five pushes. Delete the key, deploy, let the sweep re-seed.

**Showtimes on the icon badge** (2026-10-05, opt-in: push prefs `showtimes`, default
`false`; a switch in the Notifications card). One per film still waiting: not dismissed,
not snoozed (reminder set, no `sentAt`), not `coveredBy`. `showtimesWaiting` exists twice —
`pushCadence.js` for the Lambda, `showtimesUnread.js` for the app — and
`showtimesBadge.test.js` pins them together. Every badge the Lambda sends goes through
`accountBadge` in push-notify.js (chores + extra + films when on), so a push never knocks
the number back down. The app re-reads the board for the badge at most every 15 minutes
(`THEATER_BOARD_FRESH_MS`), and App.vue recounts when prefs, board, dismissals or
reminders change.

**Posters and dismissals** (same night: "I'd rather see movie posters than names … a way for
me to dismiss things off of this screen … swipe it off or maybe hit an X"). Every adapter now
carries `poster` where the source has one (Alamo `show.posterImages[0].uri`, Veezi
`/Media/Poster?…code=`, AFI's Vista `FilmPosterGraphic/f-<id>`, Cinema Arts `movie.poster`);
CinemaClock has no art, so its listings carry `year` from the genre line and the app asks
TMDB (`src/utils/posterLookup.js`: `/search/movie` with the bracketed or feed year, hits and
misses cached in localStorage `showtimesPosters` for 30 days, module cache + shared in-flight
like personLookup). A feed poster that 404s falls through to the lookup. Dismissals live at
`theaters/dismissed/<theaterKey>/<slug> = at`, written by store `dismissListing` (optimistic;
`restore: true` undoes), pruned to the current board by `loadTheaterBoard`, and excluded from
the Insights "new" pill. The screen is one poster to a row on a phone (two/three on wide screens), X
in the corner, swipe RIGHT past 110px or a third of the card dismisses (the back gesture owns
the left 20px of the screen and the cards start 30px in); horizontal intent is decided once so
scrolling never fires it. Verified with synthetic TouchEvents in the tester's iframe (v1.118.9).
Dismissals are per listing and pruned when the film leaves the board, so a return years later
is shown and pushed again — Matt asked for exactly that.

**A dismissal covers that theater and every WORSE one, never a better one** (2026-10-06,
two rounds the same day). Morning: "At the Udvar-Hazy IMAX, I keep getting notifications for
the same movie over and over again" - films dismissed at one theater came back from another,
so a dismissal was made to cover the film at every theater. Afternoon, Matt: "I may dismiss a
movie from a lesser theater but would still want to see it at like my home Alamo". So now
`dismissedFilms` returns titleKey -> the board index of its BEST-ranked dismissal, and
`dismissedAtRank(gone, title, rank)` hides a copy at that rank or worse. Same in
pushCadence.js AND showtimesUnread.js (pinned by `showtimesBadge.test.js`), applied to the
badge, the Watchlist "new" dot, the screen, and `notifyAccountListings` (rank = the board
index `i`; logged "already dismissed here or at a better theater"). Bring back lifts the
copy's own dismissal and the film's dismissals at that theater or better (not worse ones).
Stored dismissals are still per `<theater>/<slug>`, and the board is in pecking order -
that ordering is what the rank means.

**Swipe left = remind me** (2026-09-28: "remind me again one week before the showtime. And if
it's already within one week, remind me again the day before"). `src/utils/reminderTime.js`
picks the first rung still ahead — a week before, the day before, three hours before — reading
the cinema-clock stamp as local time (a bare date is noon); no rung left or no showtime known
means a toast and a snap back — except NO date at all, which is a week's snooze from now
(v1.118.13: "if there isn't a date, snooze for a week, you can represent it then").

**Taps land in the app, links land on the theater** (v1.118.14: "Clicking on the notification
should not take me directly to their website … it should just take me to Cinema Roll, to the
Showtimes page … I don't ever want to go to that movie clock intermediate page"). Every listing
and reminder push `navigate`s to `/showtimes?focus=<theaterKey>/<slug>` (a summary to
`/showtimes`); the screen's `focusFromQuery` strips the query, un-hides the card whatever its
state, scrolls it into view and rings it for four seconds. CinemaClock is read-only: each chain
entry carries the theater's own `site` (regmovies.com/theatres/regal-majestic-1862, the three
amctheatres.com pages, si.edu/theaters/{airbus,lockheedmartin}) and that is the card's link.
The earlier absolute-URL pass-through in `buildPayload` is now unused by these pushes. The screen writes `theaters/reminders/<theater>/<slug>` =
{ remindAt, setAt, title, theaterName, url, firstShowTime } via store `remindListing`
(`reminder: null` cancels); the card is hidden while it waits (a "n reminders" chip shows them,
bell-slash cancels) and returns once the sweep stamps `sentAt`. Lambda: `remindersDue` +
`composeReminderMessage` (tested), tag `remind-<theater>-<slug>-<remindAt>`, tap goes to
tickets; owner only. Pruned with dismissals when the film leaves the board. AFI's grid has no
dates, so the sweep backfills `s` (first showtime) into the seen-state eight films a sweep
(`SHOWTIME_BACKFILL_PER_SWEEP`, via the theater's `enrich`) and `boardForApp` shows it.
Verified with synthetic touches on the tester (v1.118.10).

**Alamo links use the market's FULL slug** (2026-09-29 report: a poster "takes me to their
website but it's just a broken link"). drafthouse.com is a client-rendered app — every URL
answers 200 with the same shell, so curl can't tell a real page from a dead one; render it
(Playwright from meal-hat's node_modules, as perf-tour does). `/dc/show/<slug>` lands on
`/tickets/shownotfound`; `/dc-metro-area/show/<slug>?cinemaId=1101` is the film's page
(presentation slugs work too), and the theater is `/dc-metro-area/theater/dc-bryant-street`.
`alamoListings` reads the market slug from the feed's own `market[0].slug`. **The Alamo iPhone
app can't be linked into**: its apple-app-site-association claims only the Season Pass
sign-up paths, so no film or theater URL opens the app.

**Alamo links on the Showtimes screen open the Alamo APP, via a Shortcut** (2026-09-29: "can
we just open the Alamo app directly without any parameters? … I'll find the movie myself").
Both the posters and the heading use `theaterLinks.js`: `shortcuts://run-shortcut?name=Open%20Alamo`,
no `target` (an app link in a new tab leaves a blank one). Matt's phone needs a Shortcut named
exactly "Open Alamo" with one "Open App: Alamo Drafthouse" action. Why not the app's own scheme:
it publishes none, and the App Store won't install it on a Mac (`isIOSBinaryMacOSCompatible`
false), so its Info.plist can't be read. If a scheme ever turns up, swap `ALAMO_APP_LINK`. The
lambda's `url` fields stay web pages (reminders, the board); only the screen maps them.

**One push a sweep for new listings** (2026-09-29: "When a bunch of movies get found at theaters
there are too many notifications … I don't think the notification needs to mention the theater").
The sweep walks every theater first, then sends a single "New showtimes" push listing just the
titles (deduped, `LISTINGS_TITLES_SHOWN` then "and N more"), tap → `/showtimes`, and only then
writes each theater's seen-state. If that send throws, theaters with news are NOT recorded, so it
comes again next sweep. The earlier per-listing pushes, their `?focus=` taps and the "first
showing" wording are gone from listings (reminders keep all three).

**Years in captions** (v1.118.11: "it would be nice if the year of the movie was always listed …
sometimes it's in the title so let's not duplicate"). `lookupFilm` in `posterLookup.js` returns
{ poster, year } from the same TMDB search (cache rows without a `year` key are re-fetched once);
`titleWithYear` appends " (year)" unless the title already carries any four-digit year.
The lookup now runs for every card lacking a year, not just those lacking a poster.

**Anyone's theaters** (2026-09-30: "we should figure out how to get this configured so that
other people could set it up for their own local theaters … give a zip code … present them with
a bunch of theaters, and then they would have to rank them"). `ShowtimesSetup.vue` at
`/showtimes/theaters` (a "Your theaters" pill on the screen; a "Choose theaters" card when there's
no board). The push Lambda's `POST /theaters/near` turns a zip into a town (api.zippopotam.us)
and the town into CinemaClock's `/<town>-<st>/movie-theaters` page, parsed by
`cinemaclockCityTheaters` (nearest first, CLOSED dropped, `films: 0` = CinemaClock carries no
showtimes, offered but not addable). A small town has no page (301 to the index) and the screen
asks for "City, ST". The ranked list lives at `<account>/theaters/follow` = { zip, place,
theaters: [{ key, name }] }, max 12 (`followedTheaters`). A key is a CinemaClock slug, OR one of
Matt's `THEATERS` via its `cinemaclock` alias (so a DC friend picking Bryant Street gets the
Alamo feed; AFI and the Miracle are `films: 0` on CinemaClock and only work through the alias).
The sweep fetches every followed theater ONCE, then runs `notifyAccountListings` per account in
that account's order; Matt with no `follow` node still follows `THEATERS`. Generic theaters'
links go to a Google "<film> <theater> showtimes" search (never CinemaClock). Saving calls
`POST /theaters/refresh`, which builds that account's board at once (`announce: false`: seeds new
theaters silently, sends nothing, deletes seen-state of theaters taken off the list). Seeded rows
carry `z: 1` and the board reports them as `firstSeenAt: 0`, so a first board is never badged
"new". The Alamo Shortcut link is Matt's only (`theaterHref(…, { alamoApp })`). Verified as the
tester 2026-09-30 with 78704 (v1.120.22): save → board in ~8s. Known weak spot: CinemaClock has
no art, and the TMDB title lookup can pick the wrong film (AFS's "The Devils" got "The Devil's
Mouth").

**Testing it signed in** (2026-09-28, Matt: "you should be able to use the test user to test
this"). The sweep mirrors the board to `cinemaroll-tester-example-com/theaters/board` on every
run, and `scripts/copy-theater-board.mjs` does it on demand (Admin SDK; also prints poster
counts per theater). Then `yarn mint-test-token` and open the URL in Claude's own Chrome.
**Gotcha found doing this:** the router's `beforeEach` awaits `nextFrame()`, and a HIDDEN tab
never paints — the Login page sat on "Working…" and `#/showtimes` rendered nothing, with no
error anywhere. `nextFrame` now falls back to a 32ms timer when `document.hidden`
(`nextFrameHidden.test.js`); a backgrounded PWA mid-navigation had the same freeze. Lazy
images (`loading="lazy"`) also never load in a hidden document — flip them to eager from the
javascript tool before judging posters. Alamo's feed posters are 1080px wide; `alamoListings`
rewrites the imgix params to 342px (19KB vs 100KB each).

**Tapping a chore notification opens that prompt** (2026-09-13: "took me to the home
screen with the applicable notification already opened and ready to go").
`composeMessage` returns `open` — the chore its headline names, `stickiness` /
`tiebreak` / `awards`, in the same priority order Home uses — and the Lambda sends
`navigate: /?open=<kind>`. Home reads `?open=` once in `mounted()` into
`openChoreRequested`, strips it from the URL (a refresh must not re-open), and every
chore card takes it as `autoOpen`: `StickinessInline`/`TweakInline` expand themselves
the moment their prompt has something to show (two immediate watchers, because the
request and the library can arrive in either order), and `PersonalAwardsModal` reuses
its existing `autoOpen`. Any value of `open` counts — Home's own order decides which
prompt is on screen. `homeNotices.test.js` pins the wiring at source level.

Infra (all `--profile personal`, us-east-1): Lambda `cinemaroll-push` (nodejs22.x,
role `cinemaroll-push-role`), HTTP API `8rptihkn0l` ($default → Lambda, throttle 5/10),
env vars `FIREBASE_SA`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`. The
VAPID private key's only copies are the Lambda env and `.env.local`; the public half is
committed in `.env` (`VUE_APP_VAPID_PUBLIC_KEY`, with `VUE_APP_PUSH_API_URL`). Redeploy:

```
# The bundle is index.js (= push-notify.js) + pushCadence.js + feedRevision.js (the
# Film Club feed's revision token, CommonJS twin of src/assets/javascript/feedRevision.js)
# + node_modules (web-push and its deps — NOT the aws-lambda/node_modules on disk, which
# is the AI Lambda's). Start from the deployed bundle so the dependencies stay exactly as
# they are:
URL=$(aws lambda get-function --function-name cinemaroll-push --profile personal \
  --region us-east-1 --query 'Code.Location' --output text)
curl -s -o current.zip "$URL" && mkdir -p bundle && (cd bundle && unzip -q -o ../current.zip)
cp aws-lambda/push-notify.js bundle/index.js && cp aws-lambda/pushCadence.js aws-lambda/feedRevision.js bundle/
(cd bundle && zip -q -r ../function.zip .)
aws lambda update-function-code --function-name cinemaroll-push \
  --zip-file fileb://function.zip --profile personal --region us-east-1
```

Run `aws` from the repo root — `.tool-versions` pins the awscli version there and a
scratch directory has none.

Client pieces: `public/push-sw.js` (declarative-payload fallback renderer, pulled in via
`workboxOptions.importScripts`), `src/utils/push.js` (subscribe from a USER TAP only —
see the parallax lesson in vue-ui.md; self-heal refresh on app open), store actions
`loadPushState`/`savePushSubscription`/`savePushPrefs`/`publishPushDigest`, the
Notifications settings card in Home.vue, and the friend-log announce in RateMovie's
submit (new viewings only, never edits).

### A friend-log push and the profile publish must travel together

They are fed by different roads and only one of them is instant. The push leaves the
rater's browser the moment the save lands, reading nothing but the friend-edge graph. The
recipient's Film Club renders `social/profiles/<friend>/recent` — a **snapshot document**,
republished on `scheduleSocialPublish`'s 20-second coalescing window.

**A `setTimeout` does not survive an installed PWA being backgrounded**, and putting the
phone away is the normal end of a rating session. Seth rated Tenet at 5:21pm on
2026-08-30 and closed the app; his snapshot was last written 49 seconds *before* the
rating, Matt's phone buzzed anyway, and the Film Club had no such film — Home's six-hour
backstop (`cinemaRoll.social.lastPublish`) was the next chance, and it had just been
stamped.

So: `publishSocialProfileNow` (cancels the pending debounce, publishes, stamps) fires from
RateMovie's submit right beside `announceLoggedMovie`, and `flushSocialPublish` runs any
*pending* publish from App.vue's `pagehide` / `visibilitychange → hidden`. The flush is
deliberately a no-op when nothing is pending — backgrounding is constant, and writing a
~100KB document on every tab switch would be worse than the bug.

The invariant, guarded by `FriendLogAnnounce.test.js`: **anything that announces must also
publish — and the publish lands first.** Never notify the club about a film it cannot then
show. Since 2026-09-06 the announce is chained onto the publish promise (report
-P0sDPxbC4120byAaK5W: the push won the race and the film's page had no rating to show);
a failed publish withholds the push. Neither is awaited before `returnHome()` — the write
rides across the route change, which trades one round trip's exposure for no delay on the
transition.

The reader's half of the same bug: friend profiles are one-shot `get`s, so an app open
since morning holds the morning's snapshot. `ensureClubData` takes `maxAgeMs`, and
`FriendsWhoSaw` passes five minutes (`FRIEND_PROFILE_MAX_AGE_MS`), so a film's page always
shows a copy newer than any notification that led there. Other surfaces still fetch only
what's missing — profiles are ~100KB each.

Friend-log body: `prefs.friendLogScores` (default on) is the RECIPIENT's choice to hear
about the film without the number; a null score is the rater's sharing tier. Both cases
live in `pushCadence.friendLogBody`, where the tests are.

### Friend-request pushes (2026-10-01)

"I should get a notification so I know that they're in my film club now." Store
`sendFriendRequest` / `acceptFriendRequest` call `announceFriendRequest` (push.js,
fire-and-forget) AFTER their writes; `POST /push/friend-request` { toKey, kind:
'request' | 'accepted' } re-reads the graph and `pushCadence.friendRequestMessage`
(tested) refuses anything the graph doesn't show — a request needs my edge, their
inbox entry and no edge back; an acceptance needs both edges. Gated only on the
recipient's master switch (`prefs.enabled`), not `friendLogs`; tap opens `/film-club`;
tag per sender so repeats replace. QA accounts never receive one.
`FriendRequestPush.test.js` pins the ordering.

### End-of-day friends (2026-09-30)

"People at work who use this, who I would rather not see exactly when I watch a movie."
Each friend row on the Film Club screen has **Right away / End of day**; it is stored ON
the owner's own edge: `social/friends/<owner>/<friend>` is `true` or `'day'` (every edge
check is truthiness, so `'day'` still counts as a friendship). Three things read it:

- **The rules**: `social/profiles/<owner>` denies a friend whose edge is `'day'`; they
  may read `social/dayProfiles/<owner>` (any mutual friend may; the owner may only
  delete it — a client can never write the copy).
- **The Lambda**: `notifyFriendsOfLog` skips `'day'` friends. Every sweep,
  `releaseDayProfiles` rebuilds an owner's copy when their midnight (`push/prefs/tz`,
  default New York) has passed or their live profile's `updatedAt` moved, and pushes
  each end-of-day friend ONE notification naming what the new copy shows that the old
  didn't (`dayNews`, keyed id+date so a released rewatch counts). The first copy is
  silent; a copy with no end-of-day friends left is deleted.
- **The reader**: `fetchFriendProfiles` reads `dayProfiles` for a friend whose edge to
  ME is `'day'`.

`dayProfileFrom` (pushCadence.js, tested in `dayFriends.test.js`) withholds everything
watched since the owner's midnight — a rewatch falls back to its previous viewing (only
possible with a ratings map), a first watch leaves the feed, ratings, top shelf, crown
and counts — and turns every time into noon UTC of the owner's local date, marking feed
items `d: 1` with `pub` (the midnight it was released, which the Film Club badge counts
from). Readers show `d` items with `timeAgo(…, { dayOnly: true })`: calendar days, never
hours.

**Friends on other apps (2026-10-01)** get the same switch, but it is ONE switch
(`settings/clubFeedTiming`): every Movie Log friend reads the one public
`clubFeed/<owner>/<secret>`, and Movie Log treats a new feed URL as a new person, so
per-friend feeds would need Movie Log changes. The row says "Same setting for all your
friends on Movie Log". With it on, `publishClubFeed` parks the live feed at
`social/clubFeedLive/<owner>` = { feed, secret, tz } (owner-only rules) and never writes
the public path; the sweep's `releaseDayFeeds` rebuilds the public copy with
`dayFeedFrom` (pushCadence.js, tested in `clubFeedTiming.test.js`) when the owner's
midnight passes or the parked feed's marker moves, recording `release` beside it. The
copy's `marker` is the midnight (+1 per same-day rebuild), never a publish time. No push —
Movie Log notifies its own users. Right away deletes the node FIRST, then publishes live;
the node's absence is "off". Switching on leaves today's watches public until the next
sweep (up to 15 minutes).

## The newsletter Lambda (`aws-lambda/newsletter.js`, deployed as `cinemaroll-newsletter`)

The Friday newsletter (Matt, 2026-09-20, after Brian's system). Same auth
pattern as the other two — Firebase ID token verified with node crypto for the
HTTP route, service-account OAuth for admin RTDB — plus a scheduled sweep.

**The division of labour is the whole design.** TMDB says what became available
and where it can be watched; OMDb says what critics scored it; the APP says
what the reader's taste is; the model RANKS and WRITES and is told the facts
rather than asked to remember them. A film released this week is past any
model's training cutoff, so asking it what critics thought is asking it to
invent exactly what we most want to be true. Every number in a release blurb
comes from the brief, re-attached to the model's judgement **by id** after the
call — a hallucinated field cannot reach the screen even if one is emitted.

**The client computes the taste profile** (`src/assets/javascript/newsletterProfile.js`
→ `{topKey}/newsletter/profile`), for the same reason `pushDigest.js` exists,
only harder: `calculatedTotal` is never persisted, so a score only exists where
`getRating` runs. Never port the rating maths into the Lambda.

**Eligibility lives in `newsletterCompose.js`** — pure, dependency-free
CommonJS, tested from `src/test/newsletterCompose.test.js`, the same shape as
`pushCadence.js`. Three rules there were each found by running it against live
data, and each has a test:

- **A digital release date is not a release date.** TMDB logs re-releases and
  new physical editions with fresh `release_type` 4/5 dates, so a straight
  window query put FIGHT CLUB (1999) in a list of this week's new films.
- **Acclaim is RT + Metacritic, never IMDb.** Ranking on all three put BATMAN:
  KNIGHTFALL PART 1 second on the whole shortlist with no RT score, no
  Metacritic score and an IMDb of 8.1. IMDb's average is fan enthusiasm wearing
  a score's clothing — the exact inflation OMDb was added to correct for. It
  stays in the brief as context the model may mention; it gets no vote.
- **A missing score is null, never zero.** Direct-to-video, foreign and small
  documentary releases routinely carry none, and a zero deletes that whole
  class of film. Same distinction MovieDetail makes for box-office `0`.

**`NON_ACCOUNT_ROOTS` must stay byte-identical to push-notify.js's.** The first
draft guessed it and carried Movie Hat's `requests`/`siteUsers` while omitting
`testing-database` — which is a real readable account, devMode's, and would
have been sent a newsletter. A test asserts the two lists match.

**The rebuild is asynchronous, and has to be.** An HTTP API integration times
out at **30 seconds**, hard; a build is ~30 TMDB/OMDb round trips plus a
frontier-model call and measures ~52s end to end. The first attempt came back
503 at exactly 30s with the Lambda still working. So `POST /newsletter/rebuild`
verifies the caller, fires an `InvocationType: 'Event'` invoke of the same
function with `{ rebuildFor: <topKey> }`, and answers **202**; the store polls
`loadNewsletter` until `builtAt` CHANGES (the week key is the same issue being
replaced, so its presence proves nothing). The Friday sweep has no such limit
and works inline.

**The rebuild is NOT gated on devMode**, which was the first instinct and is
wrong: `devMode` repoints `databaseTopKey` at `testing-database`, while the
Lambda derives the account from the caller's ID token — so a devMode rebuild
writes to the real account and the app polls a different node, waiting forever.
The button shows for anyone opted in, and the spend is bounded server-side
instead: a 45s cooldown (a double tap costs one model call, not two) and 20
rebuilds per account per day. `yarn newsletter-e2e --double-tap` proves the
cooldown.

**The feature slot takes FOUR kinds of claim**, ranked against each other by
`featureCandidates`:

| reason | what it is | weight |
|---|---|---|
| `anniversary` | a round birthday in the coming seven days (10/15/20/25/30/40/50/60/70/75/80/90/100) | 45–100, by roundness |
| `person` | someone in the reader's own profile has a birth/death anniversary at a multiple of five, hung on their signature film | 55–95 |
| `original` | an older film sharing a title with one of this week's releases — usually the thing being remade | 72 |
| `trending` | an old film back in TMDB's weekly trending list, which means *something* happened | 65 |

A film with two claims takes the louder one and a bonus. **Measured rarity
matters here, and three of the four are thin**: on 2026-09-20 the tally was
16 anniversaries, 1 original, 0 person, 0 trending. TMDB's trending list is
dominated by new releases (all 20 entries were 2026 films), and a person's
round anniversary landing in a given week is a ~2% event per person — which
is why `personAnniversaries` takes every multiple of five rather than only
decades and quarters, and why the people pool is 20 names rather than 12. The
issue stores `counts.featureClaims`, tallied BEFORE the top-12 cut, so the mix
is visible over time rather than guessed at.

**`daysAway` is deliberately absent from the brief.** It was there, and the
model reached straight for it — picking a 40th falling on press day over a
75th four days later, and opening "forty years ago today". Matt, 2026-09-20:
"I don't care so much that the anniversary was exactly the day that the
newsletter was being written." The week is the unit; the surest way to stop
the model weighing the day is not to tell it. The screen says "this week" for
the same reason, with the exact release date at the end of the line for
anyone who wants it.

Two numbers found only by running it: `olderNamesake`'s `minGap` is **8**, not
12, because MOANA (2016) → MOANA (2026) is ten years and a twelve-year
minimum threw away the clearest remake on the list; and the remake check runs
across the top **ten** of the shortlist, not five, because Moana sat eighth.

The chosen film's occasion is stored as DATA (`reason`, `turning`, `daysAway`,
`releaseDate`), not left to the prose, so the page can answer "how did you
pick that movie?" — Matt's question, 2026-09-20.

**Deploy the Lambda with `yarn deploy:newsletter`, never by hand.** The prompt
inside `newsletter.js` is a template literal, and prose written about a
`field` with backticks terminates it. That shipped once and surfaced only as a
500 with `Runtime.UserCodeSyntaxError` in CloudWatch, AFTER the upload. The
script runs `node --check` on all three sources and again on the bundled
`index.js` before anything leaves the machine.

Model is **Opus** here, alone among the routes — one call a week, so the choice
is not a cost decision (Matt: "This is only going to happen once a week. It's
like one call. I think we should use the most advanced model").

Verify without signing anyone in: `yarn newsletter-dry-run` proves the facts
half from a laptop (no keys, no writes, no model); `yarn newsletter-e2e` proves
the rest, building a real issue against the TESTER account from a real
library's taste profile, via a custom token exchanged for an ID token.

Infra (all `--profile personal`, us-east-1): Lambda `cinemaroll-newsletter`
(nodejs22.x, 512MB, **300s**, role `cinemaroll-push-role` plus inline policy
`cinemaroll-newsletter-self-invoke`), HTTP API `lpou4xxxng` ($default, throttle
2/5), EventBridge rule `cinemaroll-newsletter-friday` at
`cron(0 13 ? * FRI *)`. Env: `FIREBASE_SA`, `TMDB_API_KEY`, `OMDB_API_KEY`,
`ANTHROPIC_API_KEY`, `VAPID_*`. Redeploy is the push Lambda's recipe with
`index.js` = `newsletter.js` plus `newsletterCompose.js` and
`newsletterSources.js`.

**`.env` must end with a newline.** Appending a line to it with `>>` when it
did not glued `VUE_APP_NEWSLETTER_API_URL` onto the end of
`VUE_APP_VAPID_PUBLIC_KEY`'s value, and `version.js`'s `dotenv.parse` rewrite
then silently kept the corrupted key and dropped the new one. It shipped in
v1.116.3 before anyone noticed. Check `tail -c 1 .env` before appending, and
prefer rewriting the file over appending to it.
