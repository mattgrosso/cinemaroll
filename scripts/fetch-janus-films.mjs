// Refresh the bundled list of films Janus Films releases, from Janus's own
// catalogue page (robots.txt allows everything). Bundled, not fetched at
// runtime: this PWA works offline, and the list changes a few times a year.
//
//   yarn fetch-janus-films
//
// Why it exists: TMDB's production_companies names who MADE a film, never who
// released it, and Janus only releases — so Seven Samurai carries Toho and
// searching "Janus" found nothing (report, 2026-11-03). Wikidata's
// "distributed by" ties just 12 films to Janus, so it couldn't fill the gap.
// distributors.js matches these rows to the library by title and year.
import { writeFileSync } from 'node:fs';

const SOURCE = 'https://www.janusfilms.com/films/list';
const res = await fetch(SOURCE, { headers: { 'User-Agent': 'CinemaRoll/1.0 (https://www.cinemaroll.org)' } });
if (!res.ok) throw new Error(`${res.status} fetching ${SOURCE}`);
const page = await res.text();

const decode = (text) => text
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
  .replace(/&quot;/g, '"').replace(/&apos;|&#039;/g, "'")
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
  .replace(/&amp;/g, '&')
  .trim();

const films = page.split('class="film-card-container"').slice(1).map((card) => {
  const title = /<h4 class="title"><a href="\/films\/\d+">([\s\S]*?)<\/a>/.exec(card);
  if (!title) return null;
  const year = /class="year[^"]*">\s*(\d{4})/.exec(card);
  const directors = [...card.matchAll(/director=[^"]*">([\s\S]*?)<\/a>/g)].map((match) => decode(match[1]));
  return [decode(title[1]), year ? Number(year[1]) : null, directors];
}).filter(Boolean);

// A broken page shouldn't quietly empty the list and un-Janus the library.
if (films.length < 500) throw new Error(`only ${films.length} films parsed — the page layout probably changed`);

const body = films.map((row) => JSON.stringify(row)).join(',\n');
writeFileSync(new URL('../src/assets/data/janusFilms.json', import.meta.url), `[\n${body}\n]\n`);
console.log(`janusFilms.json: ${films.length} films`);
