// The Eras tab's "shelf" (report, 2026-10-24: "a new graph that shows the
// number of movies I've watched for each year ... a bar graph, although that
// seems kind of boring"). One column per RELEASE year, oldest film's year to
// this year with the empty years left in as gaps, and each column a stack of
// one block per film, shaded by how you rated it — so the picture answers
// "how many" and "how good" at once. Pure; ReleaseYearShelf.vue only draws.

// Five shades, by the library's own quintiles: the shade says where a film
// sits among YOUR ratings, not against a fixed 0–10 line that most of a
// library would crowd into the top of.
export const SHADE_COUNT = 5;

// Read off the date string itself: new Date('2001-01-01') is UTC midnight,
// which is still 2000 anywhere west of Greenwich. The year search a tap runs
// matches the string too.
function releaseYear (entry) {
  const year = parseInt(String(entry?.movie?.release_date ?? '').slice(0, 4), 10);
  return Number.isFinite(year) ? year : null;
}

// The rating at each quintile boundary, lowest first (SHADE_COUNT - 1 cuts).
export function shadeCuts (ratings) {
  const sorted = [...ratings].sort((a, b) => a - b);
  if (!sorted.length) return [];
  return Array.from({ length: SHADE_COUNT - 1 }, (_, i) =>
    sorted[Math.floor(((i + 1) * sorted.length) / SHADE_COUNT)] ?? sorted[sorted.length - 1]);
}

// 0 (your bottom fifth) to SHADE_COUNT - 1 (your top fifth).
export function shadeFor (rating, cuts) {
  let shade = 0;
  cuts.forEach((cut) => { if (rating >= cut) shade += 1; });
  return Math.min(shade, SHADE_COUNT - 1);
}

// { years: [{ year, count, films: [{ entry, rating, shade }] best first,
//   top }], first, last, maxCount }. An entry with no usable release date or
// rating is left out. `thisYear` is passed in so the function stays pure.
export function releaseYearShelf (entries, getRatingFn, { thisYear = new Date().getFullYear() } = {}) {
  const films = [];
  (entries || []).forEach((entry) => {
    const rating = Number(getRatingFn(entry)?.calculatedTotal);
    const year = releaseYear(entry);
    if (!Number.isFinite(rating) || year === null) return;
    films.push({ entry, rating, year });
  });
  if (!films.length) return { years: [], first: null, last: null, maxCount: 0 };

  const cuts = shadeCuts(films.map((f) => f.rating));
  const byYear = new Map();
  films.forEach(({ entry, rating, year }) => {
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year).push({ entry, rating, shade: shadeFor(rating, cuts) });
  });

  const first = Math.min(...byYear.keys());
  const last = Math.max(thisYear, ...byYear.keys());
  const years = [];
  let maxCount = 0;
  for (let year = first; year <= last; year += 1) {
    const yearFilms = (byYear.get(year) || []).sort((a, b) => b.rating - a.rating);
    maxCount = Math.max(maxCount, yearFilms.length);
    years.push({ year, count: yearFilms.length, films: yearFilms, top: yearFilms[0]?.entry || null });
  }
  return { years, first, last, maxCount };
}
