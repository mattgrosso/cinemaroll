// Every ceremony Cinema Roll can show the history of, in one board shape.
//
// Matt, 2026-10-07: on the awards screen, "a series of tabs at the top that
// would let us flip between the Groskers, the Golden Globes, all of my
// friends' awards, but also the Oscars and the Golden Globes and maybe
// Cannes and whatever else... look at the history of any award that we have
// access to."
//
// Four sources feed it, all already on the device:
//   - my own personalAwards tree (the existing awards page handles that tab);
//   - each friend's awards, published beside their ratings (Movie Log's too);
//   - the full Academy Awards dataset (state.allAcademyAwards);
//   - the other-ceremonies dataset (Golden Globes, BAFTA, Cannes, Venice).
//
// A board is years, newest first, each with its categories in a sensible
// order, each category with its winners and its nominees:
//   [{ year, categories: [{ key, label, winners: [pick], nominees: [pick] }] }]
// and a pick is { movieId, title, poster, name? } — movieId null when the
// source has no TMDB id and no title in the club matched.
import { ACADEMY_CATEGORY_ORDER } from './academyAwards.js';
import { PERSONAL_AWARD_CATEGORIES } from './personalAwardsCategories.js';
import { validAwards, friendCeremony, stripCeremony, categoryMatchKey, houseCategoryRank } from './awardsShare.js';

export { categoryMatchKey };

// Oscar boards read in the Academy's own order; everything else in the house
// order (Best Picture first, then acting and craft, then the rest by name).
const ACADEMY_ORDER = ACADEMY_CATEGORY_ORDER.map((c) => c.toLowerCase());
const HOUSE = Symbol('house');

export function categoryRank (label, order = HOUSE) {
  if (order === HOUSE) return houseCategoryRank(label);
  const index = order.indexOf(String(label || '').toLowerCase());
  return index === -1 ? order.length : index;
}

// --- the board -----------------------------------------------------------------
// Is this a category for a person (Best Director, Best Actress, an honorary
// award) or for a film? The house list decides where it can; otherwise the
// label does. It matters because publishers attach people to film categories
// too — Movie Log lists every producer on Best Picture, three editors on Best
// Editing — and on a row that is noise (Matt, 2026-10-07: "way too much data
// on the screen"). A film category shows the film; a person category shows
// the people, with the film underneath.
const HOUSE_KIND = Object.fromEntries(PERSONAL_AWARD_CATEGORIES.map((c) => [categoryMatchKey(c.name), c.type]));
const PERSON_LABEL = /actor|actress|performance|director|directing|honorary|humanitarian|memorial|special award|breakthrough|newcomer|debut|star of/i;

export function categoryKind (label) {
  return HOUSE_KIND[categoryMatchKey(label)] || (PERSON_LABEL.test(String(label || '')) ? 'person' : 'movie');
}

// `entries` are flat: { year, label, result, movieId, title, poster, name? }.
// Within a category, duplicate picks fold together: a film category keeps one
// pick per film (people dropped), a person category one per person-and-film.
export function boardFromEntries (entries, { order = HOUSE } = {}) {
  const years = new Map();
  (entries || []).forEach((entry) => {
    if (!Number.isInteger(entry?.year) || !entry.label) return;
    const year = years.get(entry.year) || new Map();
    years.set(entry.year, year);
    if (entry.meta && !year.meta) year.meta = entry.meta;
    const key = entry.label.trim().toLowerCase();
    const category = year.get(key) || { key, label: entry.label.trim(), kind: categoryKind(entry.label), winners: [], nominees: [], seen: new Set() };
    year.set(key, category);
    const pick = { movieId: entry.movieId ?? null, title: entry.title || null, poster: entry.poster || null };
    if (category.kind === 'person' && entry.name) pick.name = entry.name;
    const identity = `${entry.result}|${pick.name || ''}|${pick.movieId ?? pick.title ?? ''}`;
    if (category.seen.has(identity)) return;
    category.seen.add(identity);
    (entry.result === 'won' ? category.winners : category.nominees).push(pick);
  });
  return [...years.entries()].sort(([a], [b]) => b - a).map(([year, categories]) => ({
    year,
    meta: categories.meta || null,
    categories: [...categories.values()].map(({ seen, ...category }) => {
      // A win listed as a nomination as well counts once.
      const wonIds = new Set(category.winners.map((p) => `${p.name || ''}|${p.movieId ?? p.title ?? ''}`));
      const nominees = category.nominees.filter((p) => !wonIds.has(`${p.name || ''}|${p.movieId ?? p.title ?? ''}`));
      return { ...category, nominees, nomineeCount: category.winners.length + nominees.length };
    }).sort((a, b) => (categoryRank(a.label, order) - categoryRank(b.label, order)) || a.label.localeCompare(b.label))
  }));
}

// --- sources ------------------------------------------------------------------

/** A friend's published profile: every award on every rating row, with the ceremony prefix peeled off. */
export function entriesFromProfile (profile) {
  const ceremony = friendCeremony(profile);
  const out = [];
  Object.entries(profile?.ratings || {}).forEach(([id, row]) => {
    (validAwards(row?.a) || []).forEach((award) => {
      const entry = { year: award.year, label: stripCeremony(award.label, ceremony), result: award.result, movieId: Number(id), title: row?.t || null, poster: row?.p || null };
      if (award.name) entry.name = award.name;
      out.push(entry);
    });
  });
  return out;
}

/** The Academy Awards dataset (state.allAcademyAwards). */
export function entriesFromAcademy (records) {
  return (records || []).map((record) => {
    const year = Number(record?.year);
    if (!Number.isInteger(year) || !record.category) return null;
    const tmdb = Number(record.tmdb);
    const names = Array.isArray(record.names) ? record.names.map((n) => n?.name).filter(Boolean) : [];
    const entry = {
      year,
      label: record.category,
      result: record.isWinner ? 'won' : 'nominated',
      movieId: Number.isInteger(tmdb) && tmdb > 0 ? tmdb : null,
      title: record.title || null,
      poster: record.img || null,
      // "97th Academy Awards": the board's caption, since the year shown is
      // the films' year and the ceremony was the spring after.
      meta: record.ceremony ? { ceremony: record.ceremony } : undefined
    };
    // Names ride along for every record; the board shows them only on a
    // person category (so Best Picture's producers stay out of the way).
    if (names.length) entry.name = names.join(', ');
    return entry;
  }).filter(Boolean);
}

export const ACADEMY_BOARD_OPTIONS = { order: ACADEMY_ORDER };

/**
 * The other-ceremonies dataset has titles but no TMDB ids. A title index built
 * from the club's libraries (mine and every friend's) supplies the id and the
 * poster where any of us has seen the film.
 */
export const normalizeTitle = (title) => String(title || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

export function titleIndex ({ library = [], profiles = [] } = {}) {
  const index = new Map();
  const add = (title, year, movieId, poster) => {
    const key = normalizeTitle(title);
    if (!key || !movieId) return;
    const list = index.get(key) || [];
    if (!list.some((x) => x.movieId === movieId)) list.push({ year, movieId, poster: poster || null });
    index.set(key, list);
  };
  library.forEach((entry) => {
    const movie = entry?.movie;
    if (!movie?.id) return;
    const year = movie.release_date ? Number(String(movie.release_date).slice(0, 4)) : null;
    add(movie.title, year, movie.id, movie.poster_path);
  });
  profiles.forEach((profile) => {
    Object.entries(profile?.ratings || {}).forEach(([id, row]) => add(row?.t, row?.y ?? null, Number(id), row?.p));
  });
  return index;
}

// Rows carry `tmdb` and `poster` once scripts/enrich-other-awards.mjs has run;
// the club's libraries fill in for any row it could not place.
export function entriesFromOther (rows, ceremony, index = new Map()) {
  return (rows || []).filter((row) => row?.ceremony === ceremony).map((row) => {
    const candidates = index.get(normalizeTitle(row.title)) || [];
    const near = candidates.find((c) => c.year == null || Math.abs(c.year - row.year) <= 1) || null;
    return {
      year: row.year,
      label: row.category,
      result: row.isWinner ? 'won' : 'nominated',
      movieId: row.tmdb || near?.movieId || null,
      title: row.title,
      poster: row.poster || near?.poster || null
    };
  });
}

// --- tabs -------------------------------------------------------------------------
// The other-ceremonies dataset's names, as the tab strip should show them.
export const OTHER_CEREMONIES = [
  { id: 'golden-globes', ceremony: 'Golden Globe Awards', label: 'Golden Globes' },
  { id: 'bafta', ceremony: 'BAFTA Awards', label: 'BAFTA' },
  { id: 'cannes', ceremony: 'Cannes Film Festival', label: 'Cannes' },
  { id: 'venice', ceremony: 'Venice Film Festival', label: 'Venice' }
];

/**
 * The tab strip: mine first, then every friend who has published any awards,
 * then the real ceremonies. Ids ride in the URL (?ceremony=), so they are
 * stable strings, never positions.
 */
export function ceremonyTabs ({ mine, friends = [] } = {}) {
  const tabs = [{ id: 'mine', label: mine || 'My awards' }];
  friends.forEach((friend) => {
    const hasAwards = Object.values(friend?.profile?.ratings || {}).some((row) => Array.isArray(row?.a) && row.a.length);
    if (!hasAwards) return;
    tabs.push({ id: `friend:${friend.key}`, label: friendCeremony(friend.profile, friend.name), who: friend.name });
  });
  tabs.push({ id: 'oscars', label: 'Oscars' });
  OTHER_CEREMONIES.forEach((c) => tabs.push({ id: c.id, label: c.label }));
  return tabs;
}
