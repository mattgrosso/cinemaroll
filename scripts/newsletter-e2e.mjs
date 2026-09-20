// Build a REAL issue — model call and all — without signing anybody in.
//
//   yarn newsletter-e2e                          # profile from Matt's library
//   yarn newsletter-e2e --source <account-key>    # ...or somebody else's
//   yarn newsletter-e2e --show                    # print the issue in full
//
// The dry run (scripts/newsletter-dry-run.mjs) proves the FACTS half from a
// laptop. This proves the other half: that the deployed Lambda takes those
// facts, calls the model, and writes an issue that renders. It is the only
// way to exercise the model path, because a rebuild needs a Firebase ID token
// and the Google popup is not something an automated browser can complete.
//
// It runs entirely against the TESTER account (cinemaroll-tester-example-com),
// which the deployed rules scope to its own branch. Matt's own newsletter node
// is never touched — the only thing borrowed from a real account is a taste
// profile, computed here and written to the tester.
//
// Requires FIREBASE_ADMIN_KEY_PATH in .env.local.

import { readFileSync } from 'fs';
import { loadEnvLocal } from './loadEnvLocal.mjs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getDatabase } from 'firebase-admin/database';
import { buildNewsletterProfile } from '../src/assets/javascript/newsletterProfile.js';

loadEnvLocal();

const TESTER_UID = 'cinemaroll-tester';
const TESTER_KEY = 'cinemaroll-tester-example-com';
const DEFAULT_SOURCE = 'mattgrosso-gmail-com';

const arg = (name, fallback = null) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};
const sourceKey = arg('--source', DEFAULT_SOURCE);
const showAll = process.argv.includes('--show');
// Fire two rebuilds back to back. A rebuild is a frontier-model call, so a
// double tap costing two of them is exactly what the server-side cooldown
// exists to prevent — and the only way to see it work is to do it.
const doubleTap = process.argv.includes('--double-tap');

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
    .filter((l) => l.includes('='))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim().replace(/^["']|["']$/g, '')])
);
const WEB_API_KEY = env.VUE_APP_GOOGLE_API_KEY;
const ENDPOINT = env.VUE_APP_NEWSLETTER_API_URL;
if (!ENDPOINT) {
  console.error('No VUE_APP_NEWSLETTER_API_URL in .env — deploy the Lambda first.');
  process.exit(1);
}

initializeApp({
  credential: cert(JSON.parse(readFileSync(process.env.FIREBASE_ADMIN_KEY_PATH, 'utf8'))),
  databaseURL: 'https://movie-log-8c4d5-default-rtdb.firebaseio.com'
});
const db = getDatabase();

// The weighted score, for THIS SCRIPT ONLY.
//
// GetRating.js cannot be imported here — it reads the Vuex store at module
// load, which pulls in the Firebase client SDK and Vue. So the raw weighted
// sum is reproduced, reading the account's OWN weights out of its settings so
// a customised weighting is still respected. `buildNewsletterProfile` takes
// the scorer as a parameter precisely so a caller can supply one.
//
// This is a testing stand-in and nothing else. The profile the Lambda
// actually ranks against is published by the APP, through the real
// getRating — see newsletterProfile.js. If this drifts, the issue this script
// prints is slightly differently ordered than a real one; nothing in
// production reads it.
const DEFAULT_WEIGHTS = {
  love: 2.8, overall: 2, story: 1.25, direction: 1.1,
  imagery: 0.9, stickiness: 1.9, performance: 0.7, soundtrack: 0.3
};

const makeScorer = (settings) => {
  const configured = settings?.weights;
  const weightOf = (name) => {
    const found = Array.isArray(configured)
      ? configured.find((w) => w?.name === name)?.weight
      : configured?.[name];
    return Number.isFinite(Number(found)) ? Number(found) : DEFAULT_WEIGHTS[name];
  };
  const rawTotal = (rating) => {
    if (!rating) return null;
    const tweak = parseFloat(rating.tweakValue || 0);
    let stickiness = rating.stickiness;
    if ((!stickiness || stickiness > 5) && stickiness !== 0) {
      stickiness = parseFloat(rating.impression) || 1;
    }
    const total =
      weightOf('direction') * parseFloat(rating.direction) +
      weightOf('imagery') * parseFloat(rating.imagery) +
      weightOf('story') * parseFloat(rating.story) +
      weightOf('performance') * parseFloat(rating.performance) +
      weightOf('soundtrack') * parseFloat(rating.soundtrack) +
      weightOf('love') * parseFloat(rating.love) +
      weightOf('overall') * (parseFloat(rating.overall) + tweak) +
      weightOf('stickiness') * parseFloat(stickiness);
    return Number.isFinite(total) ? parseFloat((total / 10).toFixed(4)) : null;
  };
  // The latest-DATED rating, matching what the app scores a film on.
  return (entry) => {
    const ratings = entry?.ratings;
    if (!Array.isArray(ratings) || !ratings.length) return { calculatedTotal: null };
    const latest = [...ratings].sort(
      (a, b) => new Date(b?.date ?? 0) - new Date(a?.date ?? 0)
    )[0];
    return { calculatedTotal: rawTotal(latest) };
  };
};

// 1. A real taste profile, computed the way the client computes it.
console.log(`\nReading ${sourceKey}'s library…`);
const logSnap = await db.ref(`${sourceKey}/movieLog`).get();
const entries = Object.entries(logSnap.val() || {}).map(([dbKey, value]) => ({ dbKey, ...value }));
if (!entries.length) {
  console.error(`No movieLog under ${sourceKey}.`);
  process.exit(1);
}
const settings = (await db.ref(`${sourceKey}/settings`).get()).val() || {};
const profile = buildNewsletterProfile({ entries, getRating: makeScorer(settings) });
console.log(`  ${profile.libraryCount} films, average ${profile.libraryAverage}`);
console.log(`  top directors: ${profile.directors.slice(0, 4).map((d) => d.name).join(', ')}`);
console.log(`  loved genres:  ${profile.genres.loved.map((g) => g.name).join(', ')}`);

// 2. Hand it to the tester, and opt the tester in.
await db.ref(`${TESTER_KEY}/newsletter/profile`).set(profile);
await db.ref(`${TESTER_KEY}/newsletter/prefs`).update({ newsletter: true });
console.log(`\nProfile written to ${TESTER_KEY}, opted in.`);

// 3. A real ID token for the tester — custom token, exchanged the way the
//    browser would exchange it.
const customToken = await getAuth().createCustomToken(TESTER_UID);
const exchange = await fetch(
  `https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=${WEB_API_KEY}`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: customToken, returnSecureToken: true })
  }
);
const exchanged = await exchange.json();
if (!exchanged.idToken) {
  console.error('Could not exchange the custom token:', exchanged.error?.message || exchanged);
  process.exit(1);
}
console.log('Signed in as the tester.');

// 4. Ask for the rebuild. The endpoint answers 202 and does the work off the
//    request — an HTTP API integration times out at 30 seconds and a build is
//    ~30 API round trips plus a model call.
const before = (await db.ref(`${TESTER_KEY}/newsletter/current`).get()).val();
const beforeBuiltAt = before
  ? (await db.ref(`${TESTER_KEY}/newsletter/issues/${before}/builtAt`).get()).val()
  : null;

const askForRebuild = async () => {
  const r = await fetch(`${ENDPOINT}/newsletter/rebuild`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${exchanged.idToken}` },
    body: '{}'
  });
  return { status: r.status, body: await r.text() };
};

if (doubleTap) {
  await db.ref(`${TESTER_KEY}/newsletter/rebuildState`).remove();   // known state
  console.log('\nDouble tap — the second should be refused:');
  const first = await askForRebuild();
  const second = await askForRebuild();
  console.log(`  first :  ${first.status} ${first.body}`);
  console.log(`  second:  ${second.status} ${second.body}`);
  if (first.status !== 202) { console.error('  FAIL: the first was not accepted'); process.exit(1); }
  if (second.status !== 429) { console.error('  FAIL: the second was NOT refused — a double tap costs two model calls'); process.exit(1); }
  console.log('  cooldown holds.');
  process.exit(0);
}

console.log('\nAsking for a rebuild…');
const started = Date.now();
const { status, body } = await askForRebuild();
console.log(`  ${status} ${body}`);
if (status >= 400) process.exit(1);

// 5. Poll for the issue the async invocation writes.
console.log('Waiting for the model…');
let issue = null;
for (let tries = 0; tries < 60; tries += 1) {
  await new Promise((resolve) => setTimeout(resolve, 5000));
  const week = (await db.ref(`${TESTER_KEY}/newsletter/current`).get()).val();
  if (week) {
    const candidate = (await db.ref(`${TESTER_KEY}/newsletter/issues/${week}`).get()).val();
    if (candidate && candidate.builtAt !== beforeBuiltAt) { issue = candidate; break; }
  }
  process.stdout.write('.');
}
console.log('');
if (!issue) {
  console.error(`No issue landed within ${Math.round((Date.now() - started) / 1000)}s. Check the Lambda logs.`);
  process.exit(1);
}
console.log(`  built in ~${Math.round((Date.now() - started) / 1000)}s`);

console.log(`\n${'='.repeat(72)}\nISSUE ${issue.weekKey}${issue.testing ? '  (testing)' : ''}\n${'='.repeat(72)}\n`);
console.log(issue.intro, '\n');
console.log(`-- ${issue.picks.length} picks from ${issue.counts.shortlisted} shortlisted (${issue.counts.considered} considered) --`);
const claims = issue.counts.featureClaims || {};
console.log(`-- feature claims available: ${Object.entries(claims).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} --\n`);
for (const pick of issue.picks) {
  const scores = [
    pick.rottenTomatoes != null ? `${pick.rottenTomatoes}% RT` : null,
    pick.metacritic != null ? `${pick.metacritic} MC` : null
  ].filter(Boolean).join(', ') || 'no critic score';
  console.log(`${pick.title} (${pick.year}) — ${scores} — ${pick.availability}`);
  console.log(`  ${pick.why}\n`);
}
if (issue.feature) {
  console.log(`-- FEATURE: ${issue.feature.title} turns ${issue.feature.turning} --\n`);
  console.log(`${issue.feature.headline}\n${issue.feature.hook}\n`);
  console.log(showAll ? issue.feature.article : `${issue.feature.article.slice(0, 700)}…\n\n(--show for the whole thing)`);
}

// Sanity checks a human would otherwise have to do by eye.
console.log(`\n${'-'.repeat(72)}\nCHECKS`);
const problems = [];
for (const pick of issue.picks) {
  if (!pick.tmdb?.poster_path && pick.posterPath) problems.push(`${pick.title}: tmdb.poster_path missing`);
  if (!pick.availability) problems.push(`${pick.title}: no availability line`);
  if (!pick.why) problems.push(`${pick.title}: no reason given`);
  if (pick.rottenTomatoes === 0 || pick.metacritic === 0) problems.push(`${pick.title}: a zero score — should be null`);
}
if (profile.seenIds.includes(issue.picks[0]?.id)) problems.push('a pick is already in the library');
console.log(problems.length ? problems.map((p) => `  FAIL ${p}`).join('\n') : '  all picks well-formed');
process.exit(0);
