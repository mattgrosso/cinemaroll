// The Friday newsletter (Matt, 2026-09-20, after Brian's system: "once a
// week, the system would automatically go figure out what new release movies
// have been added to like streaming services and rental... gives a list of
// the best of those", plus "some movie from the past that was having an
// interesting anniversary... write up a nice article about that movie").
//
// Two entry modes, the same shape push-notify.js uses:
//
//   1. Scheduled (EventBridge, Fridays): build this week's issue for every
//      opted-in account, write it, and push once.
//   2. HTTP (API Gateway), Firebase-ID-token-gated:
//        POST /newsletter/rebuild  - rebuild this week's issue NOW for the
//                                    caller. The testing switch Matt asked
//                                    for; the app puts it behind devMode.
//   3. Async self-invoke ({ rebuildFor: <topKey> }): the work the HTTP route
//                                    asks for, done off the request.
//
// WHY THE REBUILD IS ASYNCHRONOUS. An HTTP API integration times out at 30
// seconds, hard, and a build is ~30 TMDB/OMDb round trips plus a frontier
// model call — the first real attempt came back 503 after exactly 30s with
// the Lambda still working. So the HTTP route verifies the caller, fires an
// Event-type invoke of this same function, and answers 202 immediately; the
// app polls until the issue lands. The scheduled Friday sweep has no such
// limit and does its work inline.
//
// THE DIVISION OF LABOUR, which everything here is arranged around:
//
//   TMDB   says what became available and where it can be watched.
//   OMDb   says what critics scored it.
//   The app says what Matt's taste is (newsletterProfile.js — the client
//          computes, because calculatedTotal is never persisted).
//   The model RANKS and WRITES, and is told the facts rather than asked to
//          remember them.
//
// That last line is the point. A film released this week is past any model's
// training cutoff, so asking it what critics thought is asking it to invent
// precisely what we most want to be true. Every number in a release blurb
// comes from the brief; the model's job is judgement and prose.
//
// Env vars (set on the Lambda, never committed):
//   FIREBASE_SA        - service-account JSON; admin RTDB via OAuth below
//   TMDB_API_KEY       - the same key the client uses
//   OMDB_API_KEY       - omdbapi.com, free tier (1,000/day; we use ~30/week)
//   ANTHROPIC_API_KEY  - read implicitly by the SDK
//   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT

const crypto = require('crypto');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const webpush = require('web-push');
const Anthropic = require('@anthropic-ai/sdk');
const {
  shortlistReleases,
  anniversariesThisWeek,
  featureCandidates,
  issueBrief,
  weekKey,
  issueDue,
  previouslyIssued
} = require('./newsletterCompose.js');
const {
  discoverReleases, enrichCandidate, anniversaryPool, trendingThisWeek, filmCard,
  personWithSignatureFilm, olderNamesake
} = require('./newsletterSources.js');

const FIREBASE_PROJECT_ID = 'movie-log-8c4d5';
const DATABASE_URL = 'https://movie-log-8c4d5-default-rtdb.firebaseio.com';
const FIREBASE_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
const APP_URL = 'https://www.cinemaroll.org';

const ALLOWED_ORIGINS = [
  'https://www.cinemaroll.org',
  'https://cinemaroll.org',
  'http://localhost:8080'
];

// MIRRORS push-notify.js — keep the two lists identical. The sweep discovers
// accounts by shallow-listing the root, so every shared node has to be named
// here or it gets treated as a person. The first draft of this file guessed
// the list from memory and got it wrong in both directions: it carried Movie
// Hat's roots (`requests`, `siteUsers`, which do not exist in this database)
// and omitted the club nodes and `testing-database` — the last of which IS a
// real readable account, devMode's, and would have been sent a newsletter.
const NON_ACCOUNT_ROOTS = new Set([
  'bugReports', 'social', 'clubDirectory', 'clubInbox', 'clubFeed',
  'mirrorFeed', 'testing-database'
]);
const QA_ACCOUNT_KEYS = new Set(['cinemaroll-tester-example-com']);

// One call a week, so this is the one route in the whole app where the model
// choice is not a cost decision (Matt: "This is only going to happen once a
// week. It's like one call. I think we should use the most advanced model").
const MODEL = 'claude-opus-5';

const client = new Anthropic();
const lambda = new LambdaClient({});

webpush.setVapidDetails(
  process.env.VAPID_SUBJECT || 'mailto:mattgrosso@gmail.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY
);

// --- HTTP plumbing -----------------------------------------------------------

let activeOrigin = ALLOWED_ORIGINS[0];
const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
});
const response = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders(activeOrigin),
  body: JSON.stringify(body)
});

// --- Firebase ID token verification (copied from push-notify.js) -------------

let certCache = { keys: null, expiresAt: 0 };

const fetchCerts = async () => {
  if (certCache.keys && Date.now() < certCache.expiresAt) return certCache.keys;
  const res = await fetch(FIREBASE_CERT_URL);
  if (!res.ok) throw new Error(`Could not fetch Firebase certs: ${res.status}`);
  const keys = await res.json();
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  certCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
};

const fromBase64Url = (value) =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const verifyIdToken = async (authorization) => {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header;
  let payload;
  try {
    header = JSON.parse(fromBase64Url(parts[0]).toString('utf8'));
    payload = JSON.parse(fromBase64Url(parts[1]).toString('utf8'));
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  const certs = await fetchCerts();
  const cert = certs[header.kid];
  if (!cert) return null;

  const signatureValid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey(cert),
    fromBase64Url(parts[2])
  );
  if (!signatureValid) return null;

  // Audience and issuer are load-bearing — without them a valid token from
  // ANY Firebase project is accepted.
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) return null;
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
  if (!payload.sub) return null;
  return payload;
};

// --- Admin RTDB access via service-account OAuth (copied from push-notify) ---

let dbTokenCache = { token: null, expiresAt: 0 };

const toBase64Url = (buf) =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const getDbToken = async () => {
  if (dbTokenCache.token && Date.now() < dbTokenCache.expiresAt - 60000) return dbTokenCache.token;
  const sa = JSON.parse(process.env.FIREBASE_SA);
  const now = Math.floor(Date.now() / 1000);
  const header = toBase64Url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = toBase64Url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/firebase.database',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600
  })));
  const signature = toBase64Url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), sa.private_key));

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${header}.${claims}.${signature}`
  });
  if (!res.ok) throw new Error(`OAuth token exchange failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  dbTokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in || 3600) * 1000 };
  return dbTokenCache.token;
};

const dbGet = async (path, params = '') => {
  const token = await getDbToken();
  const res = await fetch(`${DATABASE_URL}/${path}.json?${params}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`RTDB GET ${path} failed: ${res.status}`);
  return res.json();
};

const dbSet = async (path, value) => {
  const token = await getDbToken();
  const res = await fetch(`${DATABASE_URL}/${path}.json`, {
    method: value === null ? 'DELETE' : 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: value === null ? undefined : JSON.stringify(value)
  });
  if (!res.ok) throw new Error(`RTDB PUT ${path} failed: ${res.status}`);
};

// --- Push (copied from push-notify.js) ---------------------------------------

const buildPayload = ({ title, body, navigate = '/', tag }) =>
  JSON.stringify({ web_push: 8030, notification: { title, body, navigate: `${APP_URL}/#${navigate}`, tag } });

const sendToAccount = async (topKey, subscriptions, payload) => {
  let delivered = 0;
  await Promise.all(Object.entries(subscriptions || {}).map(async ([id, sub]) => {
    if (!sub || !sub.endpoint || !sub.keys) return;
    try {
      await webpush.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, payload,
        { TTL: 24 * 3600, urgency: 'normal' });
      delivered += 1;
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await dbSet(`${topKey}/push/subscriptions/${id}`, null).catch(() => {});
      } else {
        console.error(`Newsletter push to ${topKey}/${id} failed:`, error.statusCode || error.message);
      }
    }
  }));
  return delivered;
};

// --- The writing -------------------------------------------------------------

// The rules the model works under. Written as flat prohibitions because the
// failure mode is confident invention, and a model that is told "be accurate"
// will cheerfully invent accurately-shaped things.
const GROUND_RULES = `
ACCURACY RULES — these override every other instruction:
- Every number about a NEW RELEASE (scores, availability, year) must come from
  the brief below. If a field is null, say nothing about it — "no critic score
  yet" is an acceptable and honest line. Never estimate or infer one.
- Never invent a quotation. Not from a critic, not from a director, not from
  an actor. If you cannot recall an exact quote, describe the reception in
  your own words instead.
- Never state a specific box-office figure, budget, or award win that is not
  in the brief.
- For the older film you may draw on well-established, widely-documented film
  history. Stay on what is uncontroversial and general; if you are unsure
  whether something is true, leave it out. A shorter true piece beats a longer
  one with a fabricated detail in it.
- Do not claim the reader has or has not seen anything.`.trim();

const personaFor = (profile) => {
  if (!profile) return 'The reader is a serious film watcher; nothing more is known.';
  const list = (rows, label) => rows?.length
    ? `${label}: ${rows.slice(0, 8).map((r) => `${r.name} (${r.films} films, ${r.average})`).join(', ')}`
    : null;
  return [
    `They have rated ${profile.libraryCount} films, averaging ${profile.libraryAverage}.`,
    list(profile.directors, 'Directors they rate highest'),
    list(profile.writers, 'Writers they rate highest'),
    profile.genres?.loved?.length
      ? `Genres they rate highest: ${profile.genres.loved.map((g) => g.name).join(', ')}`
      : null,
    profile.genres?.coolOn?.length
      ? `Genres they rate lowest: ${profile.genres.coolOn.map((g) => g.name).join(', ')}`
      : null,
    profile.recentHighs?.length
      ? `Recently loved: ${profile.recentHighs.map((r) => `${r.title} (${r.score})`).join(', ')}`
      : null
  ].filter(Boolean).join('\n');
};

/**
 * One model call produces the whole issue — both sections, as JSON.
 *
 * One call rather than two because the sections should read as one voice, and
 * because at weekly cadence the saving is irrelevant next to the coherence.
 */
const writeIssue = async ({ brief, profile }) => {
  const prompt = `You are writing this week's issue of a private film newsletter for one reader.

${GROUND_RULES}

WHO YOU ARE WRITING FOR
${personaFor(profile)}

NEW RELEASES AVAILABLE THIS WEEK (facts; pick from these and nothing else)
${JSON.stringify(brief.releases, null, 1)}

FILMS WITH A CLAIM ON THIS WEEK (pick exactly one to write about)
Each carries a "reason":
  "anniversary" — a round birthday falls somewhere in the coming seven days;
                  "turning" is the number of years.
  "trending"    — an older film is back in this week's most-watched list,
                  which usually means something happened: a re-release, a
                  death, an awards run, a new film that references it.
  "person"      — somebody central to the film has a round birth or death
                  anniversary this week; "person" names them and says which.
  "original"    — a new release this week is a remake of, or shares its title
                  with, this older film. "relatedTo" names the new one. TREAT
                  THIS AS UNVERIFIED: the match was made on title and year
                  alone. If the two films are not actually related, do not
                  write about it — pick something else.
"alsoTrendingNow" means an anniversary film is ALSO back in circulation.

THE WEEK IS THE UNIT. Do not favour a film because its anniversary lands on
any particular day — you are not told which day, and it does not matter. A
75th is a bigger occasion than a 40th; write about whichever gives you the
better piece, and say plainly in the hook why THIS film THIS week.
Prefer variety across issues: a straight birthday is the least interesting of
these reasons, not the default.
${JSON.stringify(brief.features, null, 1)}

Return ONLY valid JSON, no markdown fence, in exactly this shape:

{
  "intro": "One or two sentences opening the issue. Warm, dry, not breathless.",
  "picks": [
    {
      "id": <the film's id from the brief>,
      "why": "2-3 sentences on why THIS reader specifically might want it. Name the concrete reason — a director they rate, a genre they reach for, a resemblance to something they recently loved. If the honest answer is that it is simply very well reviewed, say that instead of inventing a personal connection."
    }
  ],
  "feature": {
    "id": <the chosen anniversary film's id>,
    "headline": "A title for the piece.",
    "hook": "One sentence on why this film, this week — name the actual occasion (the anniversary, or that it is back in circulation).",
    "article": "500-700 words. Its making, how it landed at the time, what it influenced, why it still matters. Paragraphs separated by \\n\\n."
  }
}

Choose 4-6 picks, best first. If fewer than four releases are worth recommending, return fewer — a short honest issue beats a padded one.`;

  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = (message.content || []).map((block) => block.text || '').join('');
  // Opus is well-behaved about the no-fence instruction, but a stray fence
  // has cost this app a feature before (see claude-ai.js's trivia route), so
  // the extraction is defensive rather than trusting.
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('Model returned no JSON object');
  return JSON.parse(text.slice(start, end + 1));
};

// --- Building one account's issue --------------------------------------------

const buildIssue = async ({ topKey, profile, pastIssues = null, now, alwaysOn }) => {
  const tmdbKey = process.env.TMDB_API_KEY;
  const omdbKey = process.env.OMDB_API_KEY;
  const iso = (ms) => new Date(ms).toISOString().slice(0, 10);

  // A fortnight, not a week: a Friday-to-Friday window misses anything whose
  // providers landed a few days after its logged digital date, and the
  // already-seen and already-issued filters stop it repeating itself.
  const { pickIds, featureIds } = previouslyIssued(pastIssues, weekKey(now), now);
  const candidates = await discoverReleases(tmdbKey, iso(now - 14 * 86400000), iso(now));

  // Enrich only what could plausibly survive the floor — the network is the
  // expensive part, and enriching sixty titles to shortlist eleven is forty
  // nine wasted round trips.
  const worth = candidates.filter((m) => (m.vote_count || 0) >= 150).slice(0, 30);
  const enriched = new Map();
  for (const movie of worth) {
    enriched.set(movie.id, await enrichCandidate(tmdbKey, omdbKey, movie));
  }

  const library = new Set(profile?.seenIds || []);
  const shortlist = shortlistReleases({ candidates, enriched, library, issued: pickIds, now });

  // Two claims on the feature slot: a round birthday this week, or an old
  // film back in TMDB's weekly trending list. Both are fetched; ranking them
  // against each other is featureCandidates' job.
  const anniversaries = anniversariesThisWeek(await anniversaryPool(tmdbKey, now), now);
  const trending = await trendingThisWeek(tmdbKey).catch(() => []);

  // People from the reader's OWN profile, so this can only ever surface
  // somebody whose work they already rate. Deduped, and bounded at twenty
  // lookups a week — the odds of a round anniversary landing in any given
  // week are low enough that a small pool is a dead branch.
  const names = [...new Set([
    ...(profile?.directors || []).slice(0, 12).map((d) => d.name),
    ...(profile?.writers || []).slice(0, 8).map((w) => w.name)
  ])];
  const people = (await Promise.all(names.map((n) => personWithSignatureFilm(tmdbKey, n))))
    .filter(Boolean);

  // An older film sharing a title with one of this week's releases — usually
  // the thing being remade, and a piece that ties the issue together. Across
  // the whole shortlist, not the top few: MOANA sat eighth on a real week and
  // a five-deep check missed the clearest remake on the list.
  const originals = (await Promise.all(
    shortlist.slice(0, 10).map(async (row) => {
      const original = row.year ? await olderNamesake(tmdbKey, row.title, row.year) : null;
      return original ? { original, newTitle: `${row.title} (${row.year})` } : null;
    })
  )).filter(Boolean);

  // Ranked WITHOUT a limit so the tally below describes what was actually
  // available this week, not what survived the cut — the point of having
  // four kinds of claim is variety, and a tally of the top twelve would
  // report "all anniversaries" forever.
  const allFeatures = featureCandidates({ anniversaries, trending, people, originals, now, limit: 200 })
    .filter((f) => !featureIds.has(f.id));
  const features = allFeatures.slice(0, 12);

  if (!shortlist.length && !features.length) {
    return { empty: true, reason: 'nothing available and nothing worth featuring' };
  }

  const brief = issueBrief({ shortlist, features, profile, weekOf: weekKey(now) });
  const written = await writeIssue({ brief, profile });

  // Re-attach the facts to the model's judgement by id. The model returns an
  // id and a reason; the poster, scores and availability come from the brief,
  // never from the response — so a hallucinated field cannot reach the screen
  // even if one is emitted.
  const byId = new Map(shortlist.map((r) => [r.id, r]));
  const picks = (written.picks || [])
    .map((pick) => {
      const facts = byId.get(pick.id);
      if (!facts) return null;
      const extra = enriched.get(pick.id) || {};
      return {
        id: facts.id,
        title: facts.title,
        year: facts.year,
        director: facts.director,
        genres: facts.genres,
        posterPath: extra.posterPath || null,
        availability: facts.where.summary,
        streamingOn: facts.where.stream,
        rentOn: facts.where.rent,
        rottenTomatoes: facts.scores.rottenTomatoes,
        metacritic: facts.scores.metacritic,
        why: String(pick.why || '').trim(),
        // TMDB's own field names, because SendToHat hands this straight to
        // movieHat.js's toHatMovie, which reads `poster_path` and
        // `release_date` — a camelCase copy would send a hat a film with no
        // poster and no year. Stored rather than re-fetched so the hat button
        // works offline, the way everything else on a stored issue does.
        tmdb: {
          id: facts.id,
          title: facts.title,
          poster_path: extra.posterPath || null,
          backdrop_path: extra.backdropPath || null,
          release_date: extra.releaseDate || (facts.year ? `${facts.year}-01-01` : ''),
          overview: facts.overview || '',
          vote_average: facts.tmdbScore
        }
      };
    })
    .filter(Boolean);

  const chosen = features.find((f) => f.id === written.feature?.id) || features[0] || null;
  // The feature gets a hat button too (Matt, 2026-09-20: "it would be nice if
  // there was a button at the bottom of the article to add that movie to a
  // hat like we do for the other new releases"), so it needs the same
  // TMDB-shaped fields the picks carry.
  const featureCard = chosen ? await filmCard(tmdbKey, chosen.id).catch(() => null) : null;
  const feature = chosen && written.feature
    ? {
        id: chosen.id,
        title: chosen.title,
        year: chosen.year,
        // Why it was chosen, kept as DATA rather than left to the prose —
        // "how did you pick that movie?" should be answerable on the page.
        reason: chosen.reason,
        turning: chosen.turning ?? null,
        daysAway: chosen.daysAway ?? null,
        releaseDate: chosen.releaseDate,
        alsoTrending: Boolean(chosen.alsoTrending),
        person: chosen.person || null,
        relatedTo: chosen.relatedTo || null,
        headline: String(written.feature.headline || '').trim(),
        hook: String(written.feature.hook || '').trim(),
        article: String(written.feature.article || '').trim(),
        tmdb: featureCard
      }
    : null;

  return {
    weekKey: weekKey(now),
    builtAt: now,
    testing: Boolean(alwaysOn),
    intro: String(written.intro || '').trim(),
    picks,
    feature,
    counts: {
      considered: candidates.length,
      shortlisted: shortlist.length,
      picked: picks.length,
      // Which kinds of claim were even available this week. Worth storing:
      // the whole point of having four is variety across issues, and without
      // this there is no way to see whether three of them ever fire.
      featureClaims: allFeatures.reduce((tally, f) => {
        tally[f.reason] = (tally[f.reason] || 0) + 1;
        return tally;
      }, {})
    }
  };
};

const publishIssue = async ({ topKey, issue, push }) => {
  await dbSet(`${topKey}/newsletter/issues/${issue.weekKey}`, issue);
  await dbSet(`${topKey}/newsletter/current`, issue.weekKey);
  await dbSet(`${topKey}/newsletter/lastIssue`, issue.weekKey);

  if (!push?.subscriptions) return 0;
  const headline = issue.feature?.title
    ? `${issue.picks.length} new, plus ${issue.feature.title} at ${issue.feature.turning}`
    : `${issue.picks.length} new films worth your time`;
  return sendToAccount(topKey, push.subscriptions, buildPayload({
    title: 'This week in film',
    body: headline,
    navigate: '/newsletter',
    tag: 'newsletter'
  }));
};

// --- Entry points -------------------------------------------------------------

const runForAccount = async (topKey, { now, alwaysOn }) => {
  const node = await dbGet(`${topKey}/newsletter`);
  const prefs = node?.prefs || {};
  const decision = issueDue({ prefs, lastIssue: node?.lastIssue || null, now, alwaysOn });
  if (!decision.due) return { topKey, skipped: decision.reason };

  const issue = await buildIssue({ topKey, profile: node?.profile || null, pastIssues: node?.issues || null, now, alwaysOn });
  if (issue.empty) return { topKey, skipped: issue.reason };

  const push = await dbGet(`${topKey}/push`).catch(() => null);
  const delivered = await publishIssue({ topKey, issue, push });
  return { topKey, weekKey: issue.weekKey, picks: issue.picks.length, delivered };
};

const runSweep = async (now = Date.now()) => {
  const roots = await dbGet('', 'shallow=true');
  const accounts = Object.keys(roots || {})
    .filter((key) => !NON_ACCOUNT_ROOTS.has(key) && !QA_ACCOUNT_KEYS.has(key));

  const results = [];
  for (const topKey of accounts) {
    try {
      results.push(await runForAccount(topKey, { now, alwaysOn: false }));
    } catch (error) {
      // One account's bad week must not cost everyone else theirs.
      console.error(`Newsletter for ${topKey} failed:`, error.message);
      results.push({ topKey, error: error.message });
    }
  }
  return results;
};

// How often one account may rebuild. A rebuild is a frontier-model call, and
// the button is visible to anyone opted in, so this is where the spend is
// bounded — not by hiding the control behind a flag.
const REBUILD_COOLDOWN_MS = 45 * 1000;
const REBUILD_DAILY_CAP = 20;

/**
 * Whether this account may start a rebuild right now.
 *
 * Read-then-write rather than a transaction: the cost of losing a race here
 * is one extra model call, and the failure mode of a transaction against RTDB
 * REST would be a refused rebuild, which is worse for the thing the button
 * exists to do.
 */
const rebuildGuard = async (topKey) => {
  const now = Date.now();
  const day = new Date(now).toISOString().slice(0, 10);
  const state = (await dbGet(`${topKey}/newsletter/rebuildState`).catch(() => null)) || {};

  const since = now - (Number(state.lastAt) || 0);
  if (since < REBUILD_COOLDOWN_MS) {
    return { allowed: false, reason: `another rebuild started ${Math.round(since / 1000)}s ago — give it a moment` };
  }
  const usedToday = state.day === day ? Number(state.count) || 0 : 0;
  if (usedToday >= REBUILD_DAILY_CAP) {
    return { allowed: false, reason: `${REBUILD_DAILY_CAP} rebuilds already today` };
  }

  await dbSet(`${topKey}/newsletter/rebuildState`, { lastAt: now, day, count: usedToday + 1 });
  return { allowed: true };
};

// Mirrors databaseKey.js — the account key is the email with unsafe
// characters replaced. FROZEN list; see databaseKeyCharacters.json.
const UNSAFE_KEY_CHARACTERS = ['-', '!', '$', '%', '@', '^', '&', '*', '(', ')', '_', '+', '|', '~', '=', '`', '{', '}', '[', ']', ':', '"', ';', "'", '<', '>', '?', ',', '.', '/'];
const UNSAFE_KEY_PATTERN = new RegExp(`[${UNSAFE_KEY_CHARACTERS.map((c) => `\\${c}`).join('')}]`, 'g');
const emailToDatabaseKey = (email) =>
  (typeof email === 'string' && email ? email.replace(UNSAFE_KEY_PATTERN, '-') : null);

exports.handler = async (event) => {
  // The async half of a rebuild: one named account, ignoring the schedule.
  if (event?.rebuildFor) {
    try {
      const result = await runForAccount(event.rebuildFor, { now: Date.now(), alwaysOn: true });
      console.log('Rebuild:', JSON.stringify(result));
      return result;
    } catch (error) {
      console.error(`Rebuild for ${event.rebuildFor} failed:`, error);
      throw error;
    }
  }

  // EventBridge sends no requestContext; API Gateway always does.
  if (!event?.requestContext) {
    const results = await runSweep();
    console.log('Newsletter sweep:', JSON.stringify(results));
    return { ok: true, results };
  }

  activeOrigin = event.headers?.origin || event.headers?.Origin || ALLOWED_ORIGINS[0];
  if (event.requestContext.http?.method === 'OPTIONS') return response(204, {});

  const claims = await verifyIdToken(event.headers?.authorization || event.headers?.Authorization);
  if (!claims?.email) return response(401, { error: 'Sign in required' });

  const topKey = emailToDatabaseKey(claims.email);
  if (!topKey) return response(400, { error: 'No account key for that email' });

  try {
    // Every rebuild spends a frontier-model call, and the button is on screen
    // for anyone opted in — so the spend is bounded HERE rather than by
    // hiding the control. Two limits, doing different jobs: a short cooldown
    // stops a double-tap or a stuck retry costing twice, and a daily cap
    // bounds the worst case. Both are deliberately generous enough to iterate
    // against, which is what the button is for.
    const guard = await rebuildGuard(topKey);
    if (!guard.allowed) return response(429, { skipped: guard.reason });

    // Hand the work to a second invocation of this same function and answer
    // now — see "WHY THE REBUILD IS ASYNCHRONOUS" at the top. The caller is
    // already verified, so the async payload carries only the account key.
    await lambda.send(new InvokeCommand({
      FunctionName: process.env.AWS_LAMBDA_FUNCTION_NAME,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ rebuildFor: topKey }))
    }));
    return response(202, { building: true, topKey });
  } catch (error) {
    console.error(`Could not start a rebuild for ${topKey}:`, error);
    return response(500, { error: error.message });
  }
};

// Exported for tests and for the deployed rebuild path. The dry-run script
// uses newsletterSources.js directly — it must not import this file, which
// needs VAPID keys at module load.
exports.buildIssue = buildIssue;
exports.writeIssue = writeIssue;
