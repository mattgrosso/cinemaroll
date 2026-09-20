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

**Ask for structured data with a forced tool call, not with a JSON-shaped prompt.**
`/watchlist` first asked for JSON in the system prompt and prefilled the reply with
`{"movies":` to force the shape. The suggestions were good every time; reassembling the
document was what broke — the continuation sometimes re-emitted the colon
(`{"movies"::[`) and sometimes omitted the array bracket, both unparseable, and both
invisible until the raw reply was logged. `tools` + `tool_choice` has the API validate
the arguments against a schema and leaves nothing to parse. It also fixed vague prompts
("x", "one more"), which used to get a conversational reply and come back empty.

## The push Lambda (`aws-lambda/push-notify.js`, deployed as `cinemaroll-push`)

Web push notifications (2026-08-27). Same auth pattern as the AI lambda — Firebase ID
token verified with node crypto for the HTTP routes (`/push/test`, `/push/friend-logged`)
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
# The bundle is index.js (= push-notify.js) + pushCadence.js + node_modules (web-push and
# its deps — NOT the aws-lambda/node_modules on disk, which is the AI Lambda's). Start from
# the deployed bundle so the dependencies stay exactly as they are:
URL=$(aws lambda get-function --function-name cinemaroll-push --profile personal \
  --region us-east-1 --query 'Code.Location' --output text)
curl -s -o current.zip "$URL" && mkdir -p bundle && (cd bundle && unzip -q -o ../current.zip)
cp aws-lambda/push-notify.js bundle/index.js && cp aws-lambda/pushCadence.js bundle/
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
