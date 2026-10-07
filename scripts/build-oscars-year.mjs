// Adds one ceremony to the Academy Awards dataset from its Wikipedia article.
//
//   node scripts/build-oscars-year.mjs 98 --dry     # parse and print, no TMDB, no writes
//   node scripts/build-oscars-year.mjs 98           # resolve films/people on TMDB, append
//
// Writes the same records to the upstream source (~/code/film-awards-api/
// AcademyAwards.json, string fields, names as a JSON string) and to the served
// file (public/data/academy-awards.json, numbers and arrays), so the two stay
// in step without rebuilding film-awards-api's SQLite. Replaces any records
// the ceremony already has. After running: bump ACADEMY_AWARDS_LATEST_YEAR in
// src/store/index.js so cached devices refetch, then deploy.
//
// The article's "Awards" table is one {{Award category|…|[[Academy Award for
// X|Label]]}} per category, winners as `* '''… ‡'''`, nominees as `** …`.
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { homedir } from 'os';

const number = Number(process.argv[2]);
const dry = process.argv.includes('--dry');
if (!Number.isInteger(number)) { console.error('usage: build-oscars-year.mjs <ceremony number> [--dry]'); process.exit(1); }
const SERVED = new URL('../public/data/academy-awards.json', import.meta.url);
const UPSTREAM = `${homedir()}/code/film-awards-api/AcademyAwards.json`;
const KEY = (readFileSync(new URL('../.env', import.meta.url), 'utf8').match(/^VUE_APP_TMDB_API_KEY=(.+)$/m) || [])[1]?.trim();
const UA = { 'User-Agent': 'CinemaRoll/1.0 (mattgrosso@gmail.com)' };

const ordinal = (n) => { const r = n % 100; const s = r >= 11 && r <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' })[n % 10] || 'th'; return `${n}${s}`; };
const ceremony = `${ordinal(number)} Academy Awards`;
const page = ceremony.replace(/ /g, '_');
const api = `https://en.wikipedia.org/w/api.php?action=parse&page=${page}&prop=wikitext&format=json&formatversion=2`;
const wikitext = (await (await fetch(api, { headers: UA })).json()).parse.wikitext;

// --- the ceremony -------------------------------------------------------------
const dateText = (wikitext.match(/^\|\s*date\s*=\s*(.+)$/m) || [])[1] || '';
const dateMatch = dateText.match(/([A-Z][a-z]+) (\d{1,2}), (\d{4})/);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ceremonyDate = dateMatch ? `${dateMatch[3]}-${String(MONTHS.indexOf(dateMatch[1]) + 1).padStart(2, '0')}-${dateMatch[2].padStart(2, '0')}` : null;
const filmYear = ceremonyDate ? Number(dateMatch[3]) - 1 : null;
if (!ceremonyDate) { console.error('could not read the ceremony date from the infobox'); process.exit(1); }

// --- categories ---------------------------------------------------------------
// Dataset names (left) for the article's link targets (right): the dataset
// kept each category's historical name, so these follow the 97th's rows.
const CATEGORY = {
  'Best Picture': 'Best Picture', 'Best Director': 'Best Director', 'Best Actor': 'Best Actor', 'Best Actress': 'Best Actress',
  'Best Supporting Actor': 'Best Supporting Actor', 'Best Supporting Actress': 'Best Supporting Actress',
  'Best Original Screenplay': 'Best Original Screenplay', 'Best Adapted Screenplay': 'Best Adapted Screenplay',
  'Best Animated Feature': 'Best Animated Feature', 'Best International Feature Film': 'Best Foreign Language Film',
  'Best Documentary Feature Film': 'Best Documentary', 'Best Documentary Short Film': 'Best Documentary Short',
  'Best Live Action Short Film': 'Best Live Action Short', 'Best Animated Short Film': 'Best Animated Short',
  'Best Original Score': 'Best Original Score', 'Best Original Song': 'Best Original Song', 'Best Sound': 'Best Sound',
  'Achievement in Casting': 'Best Casting', 'Best Production Design': 'Best Production Design',
  'Best Cinematography': 'Best Cinematography', 'Best Makeup and Hairstyling': 'Best Makeup',
  'Best Costume Design': 'Best Costume Design', 'Best Film Editing': 'Best Editing', 'Best Visual Effects': 'Best Visual Effects'
};
const PERSON_FIRST = new Set(['Best Director', 'Best Actor', 'Best Actress', 'Best Supporting Actor', 'Best Supporting Actress']);
const ACTING = new Set(['Best Director', 'Best Actor', 'Best Actress', 'Best Supporting Actor', 'Best Supporting Actress', 'Honorary Award']);

// --- wikitext cleaning ------------------------------------------------------------
const clean = (s) => s
  .replace(/<ref[^>]*\/>/g, '').replace(/<ref[^>]*>[\s\S]*?<\/ref>/g, '')
  .replace(/<small>[\s\S]*?<\/small>/g, '')
  .replace(/\{\{ill\|([^|}]+)[^}]*\}\}/g, '$1')
  .replace(/\{\{abbr\|([^|}]+)[^}]*\}\}/g, '')
  .replace(/\{\{snd\}\}/g, ' – ')
  .replace(/\{\{[^}]*\}\}/g, '')
  .replace(/\[\[[^\]|]*\|([^\]]+)\]\]/g, '$1').replace(/\[\[([^\]]+)\]\]/g, '$1')
  .replace(/'''/g, '').replace(/‡/g, '').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
const italics = (s) => { const m = s.match(/''([^']+(?:'[^']+)*)''/); return m ? m[1].trim() : null; };
const splitNames = (s) => s.split(/,\s*|\s+and\s+|\s*&\s*|;\s*/).map((x) => x.replace(/^and\s+/, '').trim()).filter((x) => x && !/^(producers?|directed by|in collaboration with)$/i.test(x));
const stripRoles = (s) => s
  .replace(/,?\s*producers?\b/gi, '').replace(/Production Design:\s*/gi, '').replace(/Set Decoration:\s*/gi, '')
  .replace(/Music and lyrics by\s*/gi, '').replace(/Music by\s*/gi, '').replace(/lyrics by\s*/gi, '').replace(/directed by\s*/gi, '')
  .replace(/in collaboration with\s*/gi, ', ').trim();

function parseEntry (raw, category, isWinner) {
  const text = clean(raw.replace(/^\*+\s*/, ''));
  const film = italics(text);
  let names = [];
  let title = film;
  let notes = null;
  if (PERSON_FIRST.has(category)) {
    names = [text.split(' – ')[0].trim()];
  } else if (category === 'Best Original Song') {
    const song = (text.match(/"([^"]+)"/) || [])[1];
    notes = song ? `"${song}"` : null;
    names = splitNames(stripRoles((text.split(' – ')[1] || '').split(';')[0]));
  } else if (category === 'Best Foreign Language Film') {
    const country = (text.match(/\(([^)]+)\)/) || [])[1];
    notes = country || null;
    names = splitNames(stripRoles(text.split(' – ')[1] || ''));
  } else {
    const after = (text.split(' – ')[1] || '').split(/; based on|; in collaboration/)[0];
    names = splitNames(stripRoles(after));
  }
  return { category, isWinner, title, names, notes };
}

const section = wikitext.slice(wikitext.indexOf('===Awards==='), wikitext.indexOf('===Governors Awards==='));
const entries = [];
let current = null;
for (const line of section.split('\n')) {
  const head = line.match(/\{\{Award category\|[^|]*\|\[\[Academy Award for ([^|\]]+)\|([^\]]+)\]\]\}\}/);
  if (head) {
    current = { category: CATEGORY[head[1]], original: head[2] };
    if (!current.category) { console.error(`unknown category link: ${head[1]}`); process.exit(1); }
    continue;
  }
  if (!current || !/^\*/.test(line)) continue;
  const isWinner = /^\*\s/.test(line) && !/^\*\*/.test(line);
  entries.push({ ...parseEntry(line, current.category, isWinner), original: current.original });
}
// Governors Awards: honorary and humanitarian, people only.
const governors = wikitext.slice(wikitext.indexOf('===Governors Awards==='), wikitext.indexOf('===Films with multiple'));
let governorsHeading = 'Honorary Award';
for (const line of governors.split('\n')) {
  const heading = line.match(/^====\s*(.+?)\s*====/);
  if (heading) { governorsHeading = heading[1].replace(/^Academy /, '').replace(/s$/, ''); continue; }
  if (!/^\*\s*\[\[/.test(line)) continue;
  const name = clean(line.replace(/^\*\s*/, '')).split(' – ')[0].trim();
  // The dataset files every Governors Award under 'Honorary Award'; the
  // actual award (Jean Hersholt Humanitarian Award, say) goes in the notes.
  entries.push({ category: 'Honorary Award', original: governorsHeading, isWinner: true, title: null, names: [name], notes: governorsHeading === 'Honorary Award' ? null : governorsHeading });
}

console.log(`${ceremony} (${ceremonyDate}, ${filmYear} films): ${entries.length} entries, ${entries.filter((e) => e.isWinner).length} winners`);
if (dry) { entries.forEach((e) => console.log(`${e.isWinner ? '★' : ' '} ${e.category.padEnd(26)} ${String(e.title).padEnd(36)} ${e.names.join(', ')}${e.notes ? `  [${e.notes}]` : ''}`)); process.exit(0); }

// --- TMDB -----------------------------------------------------------------------------
const norm = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const tmdb = async (path, params = '') => {
  const res = await fetch(`https://api.themoviedb.org/3${path}?api_key=${KEY}${params}`);
  if (res.status === 429) { await new Promise((resolve) => setTimeout(resolve, 2000)); return tmdb(path, params); }
  return res.ok ? res.json() : null;
};
const films = new Map();
async function film (title) {
  if (!title) return null;
  if (films.has(title)) return films.get(title);
  let hit = null;
  for (const year of [filmYear, filmYear - 1, filmYear + 1, null]) {
    const data = await tmdb('/search/movie', `&query=${encodeURIComponent(title)}${year ? `&primary_release_year=${year}` : ''}`);
    const results = data?.results || [];
    hit = results.find((r) => norm(r.title) === norm(title) || norm(r.original_title) === norm(title)) || (year ? results[0] : null);
    if (hit) break;
  }
  const ids = hit ? await tmdb(`/movie/${hit.id}/external_ids`) : null;
  const out = hit ? { tmdb: String(hit.id), imdb: ids?.imdb_id || null, release_date: hit.release_date || null, img: hit.poster_path || null } : null;
  if (!hit) console.log(`  film not found: ${title}`);
  films.set(title, out);
  return out;
}
const people = new Map();
async function person (name) {
  if (people.has(name)) return people.get(name);
  const data = await tmdb('/search/person', `&query=${encodeURIComponent(name)}`);
  const hit = (data?.results || []).find((r) => norm(r.name) === norm(name)) || (data?.results || [])[0] || null;
  const ids = hit ? await tmdb(`/person/${hit.id}/external_ids`) : null;
  const out = { name, imdb: ids?.imdb_id || null, tmdb: hit?.id ?? null, img: hit?.profile_path || null };
  people.set(name, out);
  return out;
}

const served = JSON.parse(readFileSync(SERVED, 'utf8')).filter((r) => r.ceremony !== ceremony);
let id = Math.max(...served.map((r) => r.id));
const fresh = [];
for (const e of entries) {
  const f = await film(e.title);
  const names = [];
  for (const n of e.names) names.push(await person(n));
  fresh.push({
    id: ++id, year: filmYear, ceremony, ceremony_date: ceremonyDate, film_years: `${filmYear} films`,
    category: e.category, original_category: e.original,
    imdb: f?.imdb || null, tmdb: f?.tmdb || null, release_date: f?.release_date || null, img: f?.img || null,
    isActing: ACTING.has(e.category) ? '1' : '0', isWinner: e.isWinner ? '1' : '0',
    title: e.title, names, notes: e.notes
  });
}
writeFileSync(SERVED, JSON.stringify([...served, ...fresh]));
console.log(`served: ${fresh.length} records appended (${served.length + fresh.length} total)`);
if (existsSync(UPSTREAM)) {
  const upstream = JSON.parse(readFileSync(UPSTREAM, 'utf8')).filter((r) => r.ceremony !== ceremony);
  const asUpstream = fresh.map((r) => ({ ...r, year: String(r.year), isActing: r.isActing === '1' ? 'TRUE' : 'FALSE', isWinner: r.isWinner === '1' ? 'TRUE' : 'FALSE', names: JSON.stringify(r.names) }));
  writeFileSync(UPSTREAM, JSON.stringify([...upstream, ...asUpstream], null, 2));
  console.log(`upstream: ${asUpstream.length} records appended to film-awards-api/AcademyAwards.json`);
}
