// Sharing personal awards with the club (Matt, 2026-10-06: "include his
// awards in our awards lists for the movies that we come across, and then
// make my award choices available to him" — for anybody's awards, in Movie
// Log or Cinema Roll). Awards ride along with ratings in the two things
// already shared: the in-app social profile and the Film Club feed. One
// projection serves both: per movie, a short list of { year, category,
// label, result, name? }, plus the ceremony's name at the top.
import { awardCategoryNameMap, PERSONAL_AWARD_CATEGORIES } from './personalAwardsCategories.js';

export const AWARD_RESULTS = ['won', 'nominated'];

// --- category alignment -----------------------------------------------------
// Every app names its categories a little differently ("Best Screenplay or
// Writing", "Best Screenplay", "Best Original Screenplay"). This folds the
// common variants onto one key so the club view can line "Best Picture" up
// across members and so boards can order categories the familiar way. It is
// deliberately conservative: Original and Adapted Screenplay stay distinct,
// the Globes' Drama and Musical/Comedy stay distinct.
const ALIASES = [
  [/^best (film|motion picture|feature film)$/, 'best picture'],
  [/^best (screenplay|writing)( or (writing|screenplay))?$/, 'best screenplay'],
  [/^best (film )?editing$/, 'best editing'],
  [/^best (original )?(score|music)( or music)?$/, 'best score'],
  [/^best visual effects( or production design)?$/, 'best visual effects'],
  [/^best animated( feature| film| feature film)?$/, 'best animated feature'],
  [/^best documentary( feature| film)?$/, 'best documentary'],
  [/^best (foreign( language)?|international)( feature)?( film)?$/, 'best international feature'],
  [/^best (actor|actress) in a (leading|supporting) role$/, (m, who, role) => `best ${role === 'supporting' ? 'supporting ' : ''}${who}`],
  [/^(best )?(directing|director)$/, 'best director']
];

export function categoryMatchKey (label) {
  const base = String(label || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  for (const [pattern, replacement] of ALIASES) {
    const match = base.match(pattern);
    if (match) return typeof replacement === 'function' ? replacement(...match) : replacement;
  }
  return base;
}

// The order a year's categories read in: Best Picture first, then the acting
// and craft categories as the personal-awards list has them, then anything
// else by name.
const HOUSE_ORDER = PERSONAL_AWARD_CATEGORIES.map((c) => categoryMatchKey(c.name));

export function houseCategoryRank (label) {
  const index = HOUSE_ORDER.indexOf(categoryMatchKey(label));
  return index === -1 ? HOUSE_ORDER.length : index;
}

// --- whose ceremony ---------------------------------------------------------
// Movie Log (as shipped 2026-10-07) sends no `awardsName`; instead every label
// reads "Goegan Globes: Best Picture". When a profile has no ceremony name and
// every one of its labels shares the same "Name: " prefix, that prefix is the
// ceremony and the labels lose it. Otherwise it is "<friend>'s awards".
export function friendCeremony (profile, fallbackName) {
  if (typeof profile?.awardsName === 'string' && profile.awardsName.trim()) return profile.awardsName.trim();
  let prefix;
  for (const row of Object.values(profile?.ratings || {})) {
    for (const award of (Array.isArray(row?.a) ? row.a : [])) {
      const label = typeof award?.label === 'string' ? award.label : '';
      const at = label.indexOf(': ');
      const found = at > 0 ? label.slice(0, at).trim() : null;
      if (!found) return fallbackName ? `${fallbackName}'s awards` : null;
      if (prefix === undefined) prefix = found;
      else if (prefix !== found) return fallbackName ? `${fallbackName}'s awards` : null;
    }
  }
  if (prefix) return prefix;
  return fallbackName ? `${fallbackName}'s awards` : null;
}

export function stripCeremony (label, ceremony) {
  const text = String(label || '');
  if (ceremony && text.toLowerCase().startsWith(`${ceremony.toLowerCase()}: `)) return text.slice(ceremony.length + 2).trim() || text;
  return text;
}

/**
 * The public projection of a personalAwards tree, keyed by TMDB id:
 *   { 550: [{ year: 2015, category: 'bestPicture', label: 'Best Picture', result: 'won' },
 *           { year: 2015, category: 'bestDirector', label: 'Best Director', result: 'nominated', name: 'David Fincher' }] }
 * Years and categories with nothing decided contribute nothing.
 */
export function awardsByMovie (personalAwards) {
  const out = {};
  if (!personalAwards || typeof personalAwards !== 'object') return out;
  const labels = awardCategoryNameMap(personalAwards);
  const add = (movieId, award) => {
    const id = Number(movieId);
    if (!Number.isInteger(id) || id <= 0) return;
    (out[id] = out[id] || []).push(award);
  };
  Object.keys(personalAwards).sort((a, b) => Number(a) - Number(b)).forEach((yearKey) => {
    const year = Number(yearKey);
    if (!Number.isInteger(year)) return;
    const categories = personalAwards[yearKey]?.categories || {};
    Object.keys(categories).forEach((category) => {
      const data = categories[category] || {};
      const label = labels[category] || category;
      const winnerId = data.winner?.movieId;
      if (winnerId != null) {
        const award = { year, category, label, result: 'won' };
        if (data.winner.name) award.name = String(data.winner.name).slice(0, 120);
        add(winnerId, award);
      }
      (data.nominees || []).forEach((nominee) => {
        if (!nominee || nominee.movieId == null) return;
        if (nominee.movieId === winnerId && (nominee.name || null) === (data.winner?.name || null)) return;
        const award = { year, category, label, result: 'nominated' };
        if (nominee.name) award.name = String(nominee.name).slice(0, 120);
        add(nominee.movieId, award);
      });
    });
  });
  return out;
}

/** A list from the wire, kept only if it is the shape above. */
export function validAwards (list) {
  if (!Array.isArray(list)) return null;
  const clean = list.filter((a) => a && typeof a === 'object' && Number.isInteger(a.year) &&
    typeof a.category === 'string' && a.category && typeof a.label === 'string' && AWARD_RESULTS.includes(a.result))
    .map((a) => {
      const award = { year: a.year, category: a.category.slice(0, 60), label: a.label.slice(0, 120), result: a.result };
      if (typeof a.name === 'string' && a.name) award.name = a.name.slice(0, 120);
      return award;
    });
  return clean.length ? clean : null;
}

/**
 * Everyone in the club who gave this film an award, from their published
 * profiles: [{ friend, ceremony, won: [...], nominated: [...] }], friends
 * with nothing for this film left out.
 */
export function friendAwardsForMovie (friends, tmdbId) {
  const id = tmdbId == null ? null : String(tmdbId);
  if (!id) return [];
  return (friends || []).map((friend) => {
    const row = friend?.profile?.ratings?.[id];
    const ceremony = friendCeremony(friend?.profile, friend?.name);
    const awards = (validAwards(row?.a) || []).map((a) => ({ ...a, label: stripCeremony(a.label, ceremony) }));
    if (!awards.length) return null;
    return {
      friend: friend.name,
      key: friend.key ?? null,
      ceremony,
      won: awards.filter((a) => a.result === 'won'),
      nominated: awards.filter((a) => a.result === 'nominated')
    };
  }).filter(Boolean).sort((a, b) => a.friend.localeCompare(b.friend));
}

/** One line for the folded tile: "Gogan Globes (Brian): Best Picture · Smithies (Seth): 2 nominations". */
export function friendAwardsSummary (groups) {
  return (groups || []).map((g) => {
    if (g.won.length) return `${g.ceremony} (${g.friend}): ${g.won.map((a) => a.label).join(', ')}`;
    return `${g.ceremony} (${g.friend}): ${g.nominated.length} nomination${g.nominated.length === 1 ? '' : 's'}`;
  }).join(' · ');
}

/**
 * The club's awards, year by year (Matt, 2026-10-07: "let's build a club
 * awards" view). `members` are [{ name, ceremony, awards, titles }] — mine
 * from my own personalAwards, each friend's from the awards on their
 * published rating rows. Output, newest year first:
 *   [{ year, categories: [{ label, picks: [{ who, ceremony, movieId, title, poster, name? }], agreed }] }]
 * Categories are matched across members by label (case-insensitive), so
 * everyone's "Best Picture" lines up whatever key each app uses; a
 * category is `agreed` when two or more members crowned the same film.
 * Nominations are not shown here — this view is the winners.
 */
export function clubAwardsByYear (members) {
  const years = new Map();
  (members || []).forEach((member) => {
    Object.entries(member?.awards || {}).forEach(([movieId, list]) => {
      (list || []).forEach((award) => {
        if (award?.result !== 'won' || !Number.isInteger(award.year)) return;
        const year = years.get(award.year) || new Map();
        years.set(award.year, year);
        const key = categoryMatchKey(award.label || award.category);
        if (!key) return;
        const category = year.get(key) || { label: award.label || award.category, picks: [] };
        year.set(key, category);
        const title = member.titles?.[movieId];
        const pick = { who: member.name, ceremony: member.ceremony || `${member.name}'s awards`, movieId: Number(movieId), title: title?.t || null, poster: title?.p || null };
        if (award.name) pick.name = award.name;
        category.picks.push(pick);
      });
    });
  });
  return [...years.entries()].sort(([a], [b]) => b - a).map(([year, categories]) => ({
    year,
    categories: [...categories.values()].map((category) => {
      const films = new Set(category.picks.map((p) => p.movieId));
      const counts = {};
      category.picks.forEach((p) => { counts[p.movieId] = (counts[p.movieId] || 0) + 1; });
      return { ...category, picks: [...category.picks].sort((a, b) => a.who.localeCompare(b.who)), agreed: Object.values(counts).some((n) => n >= 2), filmCount: films.size };
    }).sort((a, b) => (Number(b.agreed) - Number(a.agreed)) || (houseCategoryRank(a.label) - houseCategoryRank(b.label)) || a.label.localeCompare(b.label))
  }));
}

/** A member record for this view from a published profile (ratings rows carry `a`, and `t`/`p`). */
export function memberFromProfile (name, profile) {
  const awards = {};
  const titles = {};
  const ceremony = friendCeremony(profile, name);
  Object.entries(profile?.ratings || {}).forEach(([id, row]) => {
    const list = validAwards(row?.a);
    if (list) awards[id] = list.map((a) => ({ ...a, label: stripCeremony(a.label, ceremony) }));
    titles[id] = { t: row?.t || null, p: row?.p || null };
  });
  return { name, ceremony, awards, titles };
}
