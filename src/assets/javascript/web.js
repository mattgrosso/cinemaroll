// The Web: the library as one connected picture.
//
// Matt, 2026-09-08: "Maybe a movie has a web and you could see visually how
// that movie is connected to other movies and really to all movies... one
// giant web of connections between like this person was in this and also
// was in this and that person has their own branching web... a visualization
// that lets me zoom in and pan around to look at the web of my whole
// database."
//
// This module is the data half of that, pure and store-free: it turns rated
// entries into nodes (films and the people who join them) and links (one
// credit each), cuts the neighbourhood around any one node, and colours a
// film by its score. WebScreen.vue lays it out and draws it.
//
// The graph is BIPARTITE, film <-> person, never film <-> film: a film with
// three regulars shares three visible threads with the next film, and a
// person is a node you can tap, walk to, and see the web of. A person who
// appears in only ONE film is not a node at all — they join nothing to
// anything, and there are 40,000 of them. Cast is capped per film at
// CAST_LIMIT the way Six Degrees caps it, so a bit-part in position 38
// doesn't turn every film into a neighbour of every other; directors are
// always in, never capped (same reasoning as sixDegrees.js).

import { isShortEntry } from './shorts.js';
import { entryKey, movieCastNames, movieDirectors, movieYear, hashString } from './games/gameUtils.js';

export const CAST_LIMIT = 10;
export const MIN_FILMS_PER_PERSON = 2;

export const movieNodeId = (key) => `m:${key}`;
export const personNodeId = (name) => `p:${name}`;

/** The rated films the web is built from: everything with a movie record, shorts by preference. */
export function webEntries (allMediaAsArray, includeShorts = false) {
  return (allMediaAsArray || []).filter((entry) => entry?.movie && entryKey(entry) && (includeShorts || !isShortEntry(entry)));
}

/**
 * Build the whole web.
 *
 * `scoreFor(entry)` is injected (GetRating is a store concern, and the tests
 * don't want it); it is called once per film, never in a comparator.
 *
 * Returns { nodes, links, byId, neighbours } where every node has an `id`,
 * a `kind` ('movie' | 'person'), a `label`, and a `degree` (links touching
 * it). Links are { source, target, role } with ids, not objects — d3-force
 * mutates what it is given, so callers copy before laying out.
 */
export function buildWeb (entries, { castLimit = CAST_LIMIT, scoreFor = () => null, minFilms = MIN_FILMS_PER_PERSON } = {}) {
  const movies = [];
  const peopleIndex = new Map(); // name -> { roles: Map(movieId -> role) }

  (entries || []).forEach((entry) => {
    const key = entryKey(entry);
    if (!key || !entry.movie) return;
    const id = movieNodeId(key);
    const directors = new Set(movieDirectors(entry));
    const cast = movieCastNames(entry, castLimit);
    const score = scoreFor(entry);
    movies.push({
      id,
      kind: 'movie',
      key,
      tmdbId: entry.movie.id,
      title: entry.movie.title || '',
      year: movieYear(entry) || null,
      poster: entry.movie.poster_path || null,
      score: typeof score === 'number' && !Number.isNaN(score) ? score : null,
      label: entry.movie.title || '',
      degree: 0
    });
    // Directors first, so someone who directs and acts in the same film is
    // recorded as its director.
    [...directors, ...cast].forEach((name) => {
      if (!name) return;
      if (!peopleIndex.has(name)) peopleIndex.set(name, { roles: new Map() });
      const roles = peopleIndex.get(name).roles;
      if (!roles.has(id)) roles.set(id, directors.has(name) ? 'director' : 'cast');
    });
  });

  const byId = new Map(movies.map((movie) => [movie.id, movie]));
  const people = [];
  const links = [];
  peopleIndex.forEach(({ roles }, name) => {
    if (roles.size < minFilms) return;
    let directed = 0;
    roles.forEach((role) => { if (role === 'director') directed += 1; });
    const person = {
      id: personNodeId(name),
      kind: 'person',
      name,
      label: name,
      count: roles.size,
      directed,
      degree: roles.size
    };
    people.push(person);
    byId.set(person.id, person);
    roles.forEach((role, movieId) => {
      links.push({ source: person.id, target: movieId, role });
      byId.get(movieId).degree += 1;
    });
  });

  const neighbours = new Map();
  const touch = (a, b) => {
    if (!neighbours.has(a)) neighbours.set(a, new Set());
    neighbours.get(a).add(b);
  };
  links.forEach(({ source, target }) => { touch(source, target); touch(target, source); });

  return { nodes: [...movies, ...people], links, byId, neighbours };
}

/** Ids adjacent to `id` (empty set for an unknown or isolated node). */
export function neighboursOf (web, id) {
  return web?.neighbours?.get(id) || new Set();
}

/**
 * The web around one node: it, everything it touches, and everything THEY
 * touch — two hops. From a film that is its people and their other films;
 * from a person it is their films and everyone else in them, so a director's
 * regulars show up as the people threaded through several of their films.
 * Links are kept only where both ends are in the cut. Null for an unknown id.
 */
export function focusWeb (web, focusId) {
  if (!web?.byId?.has(focusId)) return null;
  const keep = new Set([focusId]);
  neighboursOf(web, focusId).forEach((first) => {
    keep.add(first);
    neighboursOf(web, first).forEach((second) => keep.add(second));
  });
  const nodes = web.nodes.filter((node) => keep.has(node.id)).map((node) => ({ ...node }));
  const links = web.links.filter((link) => keep.has(link.source) && keep.has(link.target)).map((link) => ({ ...link }));
  return { nodes, links, focus: focusId };
}

/**
 * Which node a route query means: `?movie=<tmdbId>` or `?person=<name>`.
 * A tmdbId is matched as a string (the query always is one); a person by
 * exact name. Null when nothing matches, which the screen treats as "the
 * whole web".
 */
export function resolveFocus (web, query = {}) {
  if (!web) return null;
  if (query.movie != null && query.movie !== '') {
    const wanted = String(query.movie);
    const movie = web.nodes.find((node) => node.kind === 'movie' && String(node.tmdbId) === wanted);
    return movie ? movie.id : null;
  }
  if (query.person) {
    const id = personNodeId(String(query.person));
    return web.byId.has(id) ? id : null;
  }
  return null;
}

// Colour by score: the whole point of drawing YOUR library rather than
// TMDB's is that the picture carries your opinion. Cool and dim at the
// bottom, warm and bright at the top; the range is 5..10 because that is
// where a rated library actually lives (a 4 is already the cold end).
export const SCORE_FLOOR = 5;
export const SCORE_CEILING = 10;
export const UNSCORED_COLOR = '#7d8590';
export const PERSON_COLOR = '#b9c2cc';

export function scoreColor (score) {
  if (typeof score !== 'number' || Number.isNaN(score)) return UNSCORED_COLOR;
  const t = Math.max(0, Math.min(1, (score - SCORE_FLOOR) / (SCORE_CEILING - SCORE_FLOOR)));
  const hue = Math.round(212 - t * (212 - 44));
  const sat = Math.round(55 + t * 35);
  const light = Math.round(46 + t * 16);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

/**
 * A stable fingerprint of a web's shape, so a saved layout can be reused
 * exactly when nothing has changed and thrown away the moment a film or a
 * credit is added. Order-independent: the store hands entries back in
 * whatever order Firebase felt like.
 */
export function layoutSignature (web) {
  const ids = web.nodes.map((node) => node.id).sort();
  const edges = web.links.map((link) => `${link.source}>${link.target}`).sort();
  return `${ids.length}:${edges.length}:${hashString(ids.join('|'))}:${hashString(edges.join('|'))}`;
}

/** The `limit` best-connected nodes of a kind, for label budgets. */
export function topByDegree (nodes, limit, kind = null) {
  return nodes
    .filter((node) => !kind || node.kind === kind)
    .slice()
    .sort((a, b) => b.degree - a.degree || String(a.label).localeCompare(String(b.label)))
    .slice(0, limit);
}
