// Splitting one person's films into Director / Cast / Producer / … sections.
//
// Matt, 2026-08-23: "I'm afraid that we've lost our sections in the search
// results. I've searched for Stephen Spielberg and his direction, acting, and
// production are all smooshed."
//
// He's right, and it was deliberate — d4580ec (2026-08-18) turned grouping off
// for EVERY typed chip to fix Natalie's tag:DARK report, and said so in its own
// message: "a chip built by tapping a person in the typeahead now lists that
// person's films flat, rather than split into Director / Cast / Producer."
// That was the correct call for tags and genres and the wrong one for people,
// because a person is the case where the sections ARE the answer.
//
// The reason it had to be turned off wholesale is worth stating, because this
// module exists to make it not apply: the free-text grouped view RE-SEARCHES
// the chip's bare value across Title, Director, Cast, Producer, Companies and
// Keywords. Re-searching is what leaked — a tag chip for "DARK" showed every
// film with "dark" in its TITLE, including ones the chip itself excluded.
//
// So this does not re-search anything. It PARTITIONS the flat filtered results
// the chip already produced: every film in, exactly one section, nothing from
// outside. A film that can't appear in the flat list can't appear here, which
// is a structural guarantee rather than a promise.

import { normalizeSearchText, buildSearchFields } from './searchFiltering.js';

// Roles a person can hold, and what each section is called. Same taxonomy and
// the same labels the free-text grouped view already shows, so a person chip
// and a typed name produce sections that read identically.
export const PERSON_ROLE_DISPLAY_NAMES = {
  director: 'Director',
  cast: 'Cast',
  producer: 'Producer',
  writer: 'Writer',
  music: 'Music',
  editor: 'Editor',
  cinematographer: 'Cinematographer',
  crew: 'Crew'
};

/**
 * The same name test FILTER_KINDS.person uses: the whole name, or the surname
 * on its own.
 *
 * It has to be the same test, or the sections would be a partition of a
 * DIFFERENT set than the one on screen — films would go missing between the
 * count and the sections. Substring matching (what the free-text groups use)
 * is deliberately not it: "Ford" must not pull in "Harrison Ford" when the
 * chip is for John Ford.
 */
export function personNameMatcher (value) {
  const target = normalizeSearchText(value);
  if (!target) return () => false;
  return (name) => name === target || name.split(' ').slice(-1)[0] === target;
}

/**
 * TMDB's writing credits, exactly as it spells them. There is no single
 * "Writer" job: 754 of 1,368 movies in the library carry none, crediting
 * "Screenplay" / "Story" / "Novel" instead. Anything matching on the word
 * "Writer" alone finds nothing on more than half the library — which is how
 * MovieDetail hid its Writers section on The Pelican Brief (report
 * -P1wcbGwHZCGW4YBOtRV).
 *
 * Exact titles, not substrings: `storedEntry.js` keeps crew by substring, so
 * "Sound Story Editor" survives into storage and must not read as writing.
 */
export const WRITER_JOBS = ['Writer', 'Screenplay', 'Story', 'Novel'];

/**
 * Which section a crew credit belongs in. Mirrors the role detection the
 * free-text grouped view does inline, in the same order — the order matters,
 * because "Director of Photography" must reach Cinematographer and not
 * Director.
 */
export function crewRoleKey (job) {
  const raw = job || '';
  const lower = normalizeSearchText(raw);

  // Exact, not substring: "Director of Photography" and "Casting Director"
  // are not directing credits.
  if (raw === 'Director') return 'director';
  if (lower.includes('producer')) return 'producer';
  if (WRITER_JOBS.includes(raw)) return 'writer';
  if (lower.includes('composer') || lower.includes('music') || lower.includes('score')) return 'music';
  if (lower.includes('editor')) return 'editor';
  if (lower.includes('photo') || lower.includes('cinematographer')) return 'cinematographer';
  return 'crew';
}

/**
 * Every role this person holds on this film. A set, because one person
 * routinely holds several — Spielberg directs and produces the same picture,
 * and which section it lands in is a priority decision made by the caller's
 * group order, not something to decide here.
 */
export function personRolesFor (media, value) {
  const matches = personNameMatcher(value);
  const search = media?._search || (media?.movie ? buildSearchFields(media.movie) : null);
  const roles = new Set();
  if (!search) return roles;

  if ((search.cast || []).some(matches)) roles.add('cast');
  for (const person of search.crew || []) {
    if (matches(person.name)) roles.add(crewRoleKey(person.job));
  }
  return roles;
}

/**
 * Partition `results` into role sections.
 *
 * `order` decides which section claims a film holding several roles — the
 * user's group-order panel feeds it, so promoting Producer above Director
 * moves Spielberg's produced-and-directed films wholesale, exactly as it does
 * for a free-text search.
 *
 * Films whose role can't be read land in `crew` rather than vanishing: this
 * is a partition, and dropping a film the flat count already promised would
 * be the same class of bug as the one being fixed.
 */
export function groupByPersonRole (results, value, { order = [], sort = (m) => m } = {}) {
  const list = results || [];
  if (!list.length || !normalizeSearchText(value)) return [];

  const rolesByMovie = new Map();
  for (const media of list) {
    const roles = personRolesFor(media, value);
    rolesByMovie.set(media, roles.size ? roles : new Set(['crew']));
  }

  // Any role present but unranked still gets a section, after the ranked ones.
  const ranked = order.filter((key) => key in PERSON_ROLE_DISPLAY_NAMES);
  const seen = new Set(ranked);
  const present = [...new Set([...rolesByMovie.values()].flatMap((roles) => [...roles]))];
  const sequence = [...ranked, ...present.filter((key) => !seen.has(key))];

  const claimed = new Set();
  const sections = [];

  for (const key of sequence) {
    const movies = list.filter((media) => !claimed.has(media) && rolesByMovie.get(media).has(key));
    if (!movies.length) continue;
    movies.forEach((media) => claimed.add(media));
    sections.push({
      category: key,
      categoryDisplay: PERSON_ROLE_DISPLAY_NAMES[key] || key,
      movies: sort(movies)
    });
  }

  return sections;
}
