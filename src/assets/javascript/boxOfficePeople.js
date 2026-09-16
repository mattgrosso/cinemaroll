// People ranked by the worldwide gross of the films you've rated that they
// made (bug report, 2026-09-15: "see box office returns by person, so like
// we could have a list of highest grossing directors and highest grossing
// performers, and maybe even crew, and show those lists based on my
// database").
//
// Sibling of boxOfficeYears.js — same two readings (as released / today's
// dollars through inflation.js), same rule that TMDB's 0 revenue means "we
// don't know" and adds nothing. Roles are matched the way deepStats.js
// matches them: crew by JOB, never by position, and performers by TOP
// BILLING only — the whole cast list would hand every big film's
// twentieth-billed actor a billion dollars.
import { releaseYear, adjustForInflation } from './inflation.js';

export const TOP_BILLING = 5;

export const ROLES = [
  { key: 'director', label: 'Directors', jobs: ['Director'] },
  { key: 'performer', label: 'Performers', cast: true },
  { key: 'producer', label: 'Producers', jobs: ['Producer'] },
  { key: 'writer', label: 'Writers', jobs: ['Writer', 'Screenplay', 'Story', 'Novel'] },
  { key: 'composer', label: 'Composers', jobs: ['Original Music Composer', 'Music'] },
  { key: 'cinematographer', label: 'Cinematographers', jobs: ['Director of Photography'] },
  { key: 'editor', label: 'Editors', jobs: ['Editor'] }
];

const roleByKey = (key) => ROLES.find((role) => role.key === key) || ROLES[0];

/** The names credited on a movie in a role — each name once, however many credits. */
export function namesInRole (movie, roleKey) {
  const role = roleByKey(roleKey);
  const names = role.cast
    ? (movie?.cast || []).slice(0, TOP_BILLING).map((person) => person?.name)
    : (movie?.crew || []).filter((person) => role.jobs.includes(person?.job)).map((person) => person?.name);
  return [...new Set(names.filter(Boolean))];
}

/**
 * @param {Array} entries  library entries ({ movie: { revenue, release_date, cast, crew } })
 * @param {{ role?: string, adjusted?: boolean }} options
 * @returns {Array<{ name, total, count, top, topGross }>}  biggest total first
 */
export function boxOfficeByPerson (entries, { role = 'director', adjusted = false } = {}) {
  const byName = new Map();

  (entries || []).forEach((entry) => {
    const movie = entry?.movie;
    const raw = Number(movie?.revenue) || 0;
    if (!(raw > 0)) return;
    const year = releaseYear(movie.release_date);
    if (year == null) return;
    const gross = adjusted ? adjustForInflation(raw, year) : raw;
    if (!(gross > 0)) return;

    namesInRole(movie, role).forEach((name) => {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push({ entry, gross });
    });
  });

  return [...byName.entries()]
    .map(([name, films]) => {
      const biggest = films.reduce((best, film) => (film.gross > best.gross ? film : best), films[0]);
      return {
        name,
        count: films.length,
        total: films.reduce((sum, film) => sum + film.gross, 0),
        top: biggest.entry,
        topGross: biggest.gross
      };
    })
    .sort((a, b) => (b.total - a.total) || (b.count - a.count) || a.name.localeCompare(b.name));
}
