// Build this week's newsletter BRIEF against live data, and print it.
//
//   yarn newsletter-dry-run              # this week
//   yarn newsletter-dry-run 2026-09-20   # as if it were run on that date
//
// The brief is everything the model is given and nothing it is allowed to
// invent — so if a number is wrong on the screen, it was wrong here first.
// Runs entirely from a laptop: no VAPID keys, no Firebase, no model call, no
// writes. That is the whole point of splitting newsletterSources.js out.
//
// Keys come from .env (TMDB, shared with the client) and .env.local (OMDb,
// server-side only — it must never reach the browser bundle).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const require = createRequire(import.meta.url);

const { shortlistReleases, anniversariesThisWeek, featureCandidates, issueBrief, weekKey } =
  require(path.join(root, 'aws-lambda/newsletterCompose.js'));
const { discoverReleases, enrichCandidate, anniversaryPool, trendingThisWeek } =
  require(path.join(root, 'aws-lambda/newsletterSources.js'));

const readEnv = (file) => {
  const full = path.join(root, file);
  if (!fs.existsSync(full)) return {};
  return Object.fromEntries(
    fs.readFileSync(full, 'utf8').split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
      })
  );
};

const env = { ...readEnv('.env'), ...readEnv('.env.local') };
const tmdbKey = env.VUE_APP_TMDB_API_KEY;
const omdbKey = env.OMDB_API_KEY;

if (!tmdbKey) {
  console.error('No VUE_APP_TMDB_API_KEY in .env');
  process.exit(1);
}
if (!omdbKey) {
  console.error('No OMDB_API_KEY in .env.local — critic scores will all be null.');
}

const asOf = process.argv[2] ? Date.parse(`${process.argv[2]}T12:00:00Z`) : Date.now();
if (!Number.isFinite(asOf)) {
  console.error(`Could not read "${process.argv[2]}" as a date (YYYY-MM-DD).`);
  process.exit(1);
}

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);

console.log(`\nIssue ${weekKey(asOf)} — window ${iso(asOf - 14 * 86400000)} to ${iso(asOf)}\n`);

const candidates = await discoverReleases(tmdbKey, iso(asOf - 14 * 86400000), iso(asOf));
console.log(`discover:   ${candidates.length} candidates`);

const worth = candidates.filter((m) => (m.vote_count || 0) >= 150).slice(0, 30);
console.log(`vote floor: ${worth.length} worth enriching`);

const enriched = new Map();
for (const movie of worth) {
  enriched.set(movie.id, await enrichCandidate(tmdbKey, omdbKey, movie));
}

// The dry run has no published profile to read, so nothing is excluded as
// already-seen — a real issue will be shorter than this one.
const shortlist = shortlistReleases({ candidates, enriched, now: asOf });
console.log(`shortlist:  ${shortlist.length} eligible\n`);

console.log('  title                            yr   RT    MC   available');
for (const row of shortlist) {
  console.log(`  ${pad(row.title, 32)} ${pad(row.year, 4)} ${pad(row.scores.rottenTomatoes ?? '—', 5)} `
    + `${pad(row.scores.metacritic ?? '—', 4)} ${row.where.summary}`);
}

const pool = await anniversaryPool(tmdbKey, asOf);
const anniversaries = anniversariesThisWeek(pool, asOf);
const trending = await trendingThisWeek(tmdbKey).catch(() => []);
const features = featureCandidates({ anniversaries, trending, now: asOf });
console.log(`\nfeature candidates: ${features.length} (${anniversaries.length} anniversaries from ${pool.length} pooled, ${trending.length} trending)\n`);
console.log('  film                               yr   claim');
for (const f of features) {
  const claim = f.reason === 'anniversary'
    ? `turns ${f.turning} in ${f.daysAway}d${f.alsoTrending ? ' + trending now' : ''}`
    : 'back in this week\u2019s most-watched';
  console.log(`  ${pad(f.title, 34)} ${pad(f.year, 4)} ${claim}`);
}

const brief = issueBrief({ shortlist, features, weekOf: weekKey(asOf) });
const out = path.join(root, 'newsletter-brief.json');
fs.writeFileSync(out, JSON.stringify(brief, null, 2));
console.log(`\nfull brief written to ${path.relative(process.cwd(), out)}`);
console.log(`(${JSON.stringify(brief).length} bytes — this is what the model is given)\n`);
