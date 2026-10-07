// Ways of comparing the club's personal awards (Matt, 2026-10-07: "some
// other comparison views for our personal awards... something cool").
// Pure: members are the clubAwardsByYear() input ([{ name, ceremony, awards,
// titles }]), the Academy list is state.allAcademyAwards.
import { categoryMatchKey, categoryKind, clubAwardsByYear } from './awardsShare.js';

const key = (s) => String(s || '').trim().toLowerCase();

/**
 * How often the club lands on the same choice, overall and by year: only
 * categories where two or more members picked count, so a year with one
 * member's awards says nothing.
 *   { categories, agreed, rate, years: [{ year, categories, agreed }], bestYear }
 */
export function agreementStats (members) {
  const years = clubAwardsByYear(members).map((entry) => {
    const contested = entry.categories.filter((c) => new Set(c.picks.map((p) => p.who)).size >= 2);
    return { year: entry.year, categories: contested.length, agreed: contested.filter((c) => c.agreed).length };
  }).filter((y) => y.categories > 0);
  const categories = years.reduce((n, y) => n + y.categories, 0);
  const agreed = years.reduce((n, y) => n + y.agreed, 0);
  const bestYear = years.filter((y) => y.categories >= 3).sort((a, b) => (b.agreed / b.categories - a.agreed / a.categories) || (b.agreed - a.agreed) || (b.year - a.year))[0] || null;
  return { categories, agreed, rate: categories ? agreed / categories : 0, years, bestYear };
}

/**
 * The films with the most wins across everyone's ceremonies:
 *   [{ movieId, title, poster, wins, by: [{ ceremony, wins }] }]
 * A film category counts once per member (however many producers Movie Log
 * lists); a person category counts once per member too.
 */
export function mostDecoratedFilms (members, limit = 6) {
  const films = new Map();
  (members || []).forEach((member) => {
    Object.entries(member?.awards || {}).forEach(([movieId, list]) => {
      const seen = new Set();
      (list || []).forEach((award) => {
        if (award?.result !== 'won') return;
        const k = `${award.year}|${categoryMatchKey(award.label || award.category)}`;
        if (seen.has(k)) return;
        seen.add(k);
        const id = Number(movieId);
        const film = films.get(id) || { movieId: id, title: member.titles?.[movieId]?.t || null, poster: member.titles?.[movieId]?.p || null, wins: 0, by: new Map() };
        if (!film.title && member.titles?.[movieId]?.t) film.title = member.titles[movieId].t;
        if (!film.poster && member.titles?.[movieId]?.p) film.poster = member.titles[movieId].p;
        film.wins++;
        const ceremony = member.ceremony || `${member.name}'s awards`;
        film.by.set(ceremony, (film.by.get(ceremony) || 0) + 1);
        films.set(id, film);
      });
    });
  });
  return [...films.values()].sort((a, b) => (b.wins - a.wins) || (b.by.size - a.by.size) || String(a.title).localeCompare(String(b.title)))
    .slice(0, limit).map((f) => ({ ...f, by: [...f.by.entries()].map(([ceremony, wins]) => ({ ceremony, wins })).sort((a, b) => (b.wins - a.wins) || a.ceremony.localeCompare(b.ceremony)) }));
}

/**
 * The people with the most wins across everyone's ceremonies (person
 * categories only): [{ name, wins, films: [{ movieId, title }], by: [...] }]
 */
export function mostHonouredPeople (members, limit = 6) {
  const people = new Map();
  (members || []).forEach((member) => {
    Object.entries(member?.awards || {}).forEach(([movieId, list]) => {
      (list || []).forEach((award) => {
        if (award?.result !== 'won' || !award.name || categoryKind(award.label || award.category) !== 'person') return;
        const person = people.get(key(award.name)) || { name: award.name, wins: 0, films: new Map(), by: new Map(), seen: new Set() };
        const k = `${member.name}|${award.year}|${categoryMatchKey(award.label || award.category)}|${movieId}`;
        if (person.seen.has(k)) return;
        person.seen.add(k);
        person.wins++;
        person.films.set(Number(movieId), member.titles?.[movieId]?.t || null);
        const ceremony = member.ceremony || `${member.name}'s awards`;
        person.by.set(ceremony, (person.by.get(ceremony) || 0) + 1);
        people.set(key(award.name), person);
      });
    });
  });
  return [...people.values()].sort((a, b) => (b.wins - a.wins) || a.name.localeCompare(b.name)).slice(0, limit)
    .map(({ seen, ...p }) => ({ ...p, films: [...p.films.entries()].map(([movieId, title]) => ({ movieId, title })), by: [...p.by.entries()].map(([ceremony, wins]) => ({ ceremony, wins })).sort((a, b) => (b.wins - a.wins) || a.ceremony.localeCompare(b.ceremony)) }));
}

/**
 * Who votes like the Academy: each member's Best Picture against the Oscars'
 * Best Picture for the same film year.
 *   [{ who, ceremony, years, matches, rate, agreedYears: [year], latestMiss: { year, theirs, academy } }]
 */
export function academyAlignment (members, academyRecords) {
  const academy = new Map();
  (academyRecords || []).forEach((r) => {
    if (r?.isWinner && key(r.category) === 'best picture' && Number.isInteger(Number(r.year)) && r.tmdb) academy.set(Number(r.year), { movieId: Number(r.tmdb), title: r.title || null });
  });
  return (members || []).map((member) => {
    const picture = new Map();
    Object.entries(member?.awards || {}).forEach(([movieId, list]) => {
      (list || []).forEach((award) => {
        if (award?.result === 'won' && categoryMatchKey(award.label || award.category) === 'best picture' && academy.has(award.year)) {
          picture.set(award.year, { movieId: Number(movieId), title: member.titles?.[movieId]?.t || null });
        }
      });
    });
    const years = [...picture.keys()].sort((a, b) => a - b);
    const agreedYears = years.filter((y) => picture.get(y).movieId === academy.get(y).movieId);
    const missYear = [...years].reverse().find((y) => picture.get(y).movieId !== academy.get(y).movieId);
    return {
      who: member.name,
      ceremony: member.ceremony || `${member.name}'s awards`,
      years: years.length,
      matches: agreedYears.length,
      rate: years.length ? agreedYears.length / years.length : 0,
      agreedYears,
      latestMiss: missYear ? { year: missYear, theirs: picture.get(missYear), academy: academy.get(missYear) } : null
    };
  }).filter((m) => m.years > 0).sort((a, b) => (b.rate - a.rate) || (b.years - a.years));
}
