// Gives the other-ceremonies dataset (Golden Globes, BAFTA, Cannes, Venice —
// scraped from Wikipedia list pages, titles only) a TMDB id and poster per
// row, by TMDB title search near the award year. Run once after the dataset
// changes; rows that already carry `tmdb` are left alone, rows that find
// nothing are left as they were (title still shows, just no poster or link).
//
//   node scripts/enrich-other-awards.mjs            # fills in the gaps
//   node scripts/enrich-other-awards.mjs --redo     # looks every row up again
import { readFileSync, writeFileSync } from 'fs';
const FILE = new URL('../src/assets/data/otherAwardsWinners.json', import.meta.url);
const KEY = (readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^VUE_APP_TMDB_API_KEY=(.+)$/m) || [])[1]?.trim();
if (!KEY) { console.error('no VUE_APP_TMDB_API_KEY in .env'); process.exit(1); }
const redo = process.argv.includes('--redo');
const rows = JSON.parse(readFileSync(FILE, 'utf8'));
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const search = async (title, year) => {
  const url = `https://api.themoviedb.org/3/search/movie?api_key=${KEY}&query=${encodeURIComponent(title)}${year ? `&primary_release_year=${year}` : ''}`;
  const res = await fetch(url);
  if (res.status === 429) { await new Promise((resolve) => setTimeout(resolve, 2000)); return search(title, year); }
  if (!res.ok) return [];
  return (await res.json()).results || [];
};
let found = 0, missed = 0, kept = 0;
const cache = new Map();
for (const row of rows) {
  if (row.tmdb && !redo) { kept++; continue; }
  const key = `${norm(row.title)}|${row.year}`;
  let hit = cache.get(key);
  if (hit === undefined) {
    hit = null;
    // Festival prizes go to the film's release year; the Globes and BAFTA
    // honour the previous year's films. Try the award year, then the year
    // before, then any year with an exact title match.
    for (const year of [row.year, row.year - 1, null]) {
      const results = await search(row.title, year);
      const exact = results.find((r) => norm(r.title) === norm(row.title) || norm(r.original_title) === norm(row.title));
      const pick = exact || (year ? results[0] : null);
      if (pick && (!year || Math.abs(Number(String(pick.release_date || '').slice(0, 4)) - row.year) <= 2)) { hit = pick; break; }
    }
    cache.set(key, hit);
  }
  if (hit) { row.tmdb = hit.id; row.poster = hit.poster_path || null; found++; } else { missed++; console.log(`  miss: ${row.ceremony} ${row.year} "${row.title}"`); }
}
writeFileSync(FILE, JSON.stringify(rows, null, 1) + '\n');
console.log(`found ${found}, missed ${missed}, kept ${kept}, total ${rows.length}`);
