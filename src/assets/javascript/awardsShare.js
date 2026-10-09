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
  const key = categoryMatchKey(label);
  // Any flavour of top prize leads: the Globes' "Best Motion Picture – Drama"
  // and "– Musical or Comedy" are not "Best Picture" but belong at the top.
  if (/^best (picture|motion picture|film)\b/.test(key)) return -1;
  const index = HOUSE_ORDER.indexOf(key);
  return index === -1 ? HOUSE_ORDER.length : index;
}

// Is this a category for a person (Best Director, Best Actress, an honorary
// award) or for a film? The house list decides where it can; otherwise the
// label does. It matters because publishers attach people to film categories
// too — Movie Log lists every producer on Best Picture, three editors on Best
// Editing — and in a list of winners that is noise (Matt, 2026-10-07: "way too
// much data on the screen"). A film category shows the film; a person
// category shows the people, with the film underneath.
const HOUSE_KIND = Object.fromEntries(PERSONAL_AWARD_CATEGORIES.map((c) => [categoryMatchKey(c.name), c.type]));
const PERSON_LABEL = /actor|actress|performance|director|directing|honorary|humanitarian|memorial|special award|breakthrough|newcomer|debut|star of/i;

export function categoryKind (label) {
  return HOUSE_KIND[categoryMatchKey(label)] || (PERSON_LABEL.test(String(label || '')) ? 'person' : 'movie');
}

// Are two spellings the same person? Members write names differently
// ("Elizabeth Chai Vasarhelyi" / "Chai Vasarhelyi", "Joel and Ethan Coen" /
// "Joel Coen"): a shared surname, or two shared name parts, is a match;
// "Sean Penn" and "Benicio del Toro" share nothing. (Matt, 2026-10-07: "we
// both put Free Solo for best director but the lists of names aren't
// matching".)
const nameTokens = (name) => String(name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((t) => t.length >= 3 && !['and', 'the', 'von', 'van', 'del', 'der', 'jr', 'sr'].includes(t));

export function samePerson (a, b) {
  const ta = nameTokens(a); const tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  if (ta[ta.length - 1] === tb[tb.length - 1]) return true;
  return ta.filter((t) => tb.includes(t)).length >= 2;
}

/** Any person in common between two lists of names. */
export function samePeople (listA, listB) {
  return (listA || []).some((a) => (listB || []).some((b) => samePerson(a, b)));
}

// --- whose ceremony ---------------------------------------------------------
// Movie Log (as shipped 2026-10-07) sends no `awardsName`; instead labels read
// "Goegan Globes: Best Picture". When a profile has no ceremony name and more
// than half of its labels share one "Name: " prefix, that prefix is the
// ceremony and the labels lose it (Matt, 2026-10-08: a stray unprefixed label
// shouldn't cost a friend their ceremony's name). Otherwise "<friend>'s awards".
// A placeholder name ("Personal awards" — Movie Log's default when a user never
// named theirs, seen on Brian's feed 2026-10-08) counts as no name, so it never
// hides a real ceremony found on the labels.
const PLACEHOLDER_CEREMONY = /^(the |my )?(personal )?awards$/i;

export function friendCeremony (profile, fallbackName) {
  const named = typeof profile?.awardsName === 'string' ? profile.awardsName.trim() : '';
  if (named && !PLACEHOLDER_CEREMONY.test(named)) return named;
  const counts = new Map();
  let total = 0;
  for (const row of Object.values(profile?.ratings || {})) {
    for (const award of (Array.isArray(row?.a) ? row.a : [])) {
      // An entry naming its own institution (proposal 0002) is not evidence
      // for the feed's: its prefix, if any, is its own.
      if (ownCeremony(award)) continue;
      const label = typeof award?.label === 'string' ? award.label : '';
      const at = label.indexOf(': ');
      const found = at > 0 ? label.slice(0, at).trim() : null;
      total += 1;
      if (found) counts.set(found, (counts.get(found) || 0) + 1);
    }
  }
  const [prefix, count] = [...counts].sort((a, b) => b[1] - a[1])[0] || [];
  if (prefix && count * 2 > total) return prefix;
  return fallbackName ? `${fallbackName}'s awards` : null;
}

export function stripCeremony (label, ceremony) {
  const text = String(label || '');
  if (ceremony && text.toLowerCase().startsWith(`${ceremony.toLowerCase()}: `)) return text.slice(ceremony.length + 2).trim() || text;
  return text;
}

// --- several institutions in one feed (Film Club Protocol 1.2.0, §4.3) -------
// Movie Log lets one person keep several public awards institutions, so an
// entry may name its own: `ceremony`, the institution's display title. An
// entry that does is headed by it, and its label loses only a prefix that is
// exactly "<ceremony>: " (publishers may keep it for older readers). An entry
// that doesn't falls back to the feed's heading, as before.
const ownCeremony = (award) => (typeof award?.ceremony === 'string' && award.ceremony) || null;

/** The heading an entry belongs under: its own institution, else the feed's. */
export function awardCeremony (award, feedCeremony) {
  return ownCeremony(award) || feedCeremony || null;
}

/** The label to show for an entry under awardCeremony(). */
export function awardLabel (award, feedCeremony) {
  const label = String(award?.label || '');
  const own = ownCeremony(award);
  if (!own) return stripCeremony(label, feedCeremony);
  return (label.startsWith(`${own}: `) && label.slice(own.length + 2).trim()) || label;
}

/** Every heading a friend's awards fall under, the feed's own first. */
export function friendCeremonies (profile, fallbackName) {
  const feed = friendCeremony(profile, fallbackName);
  const headings = new Set();
  for (const row of Object.values(profile?.ratings || {})) {
    for (const award of (Array.isArray(row?.a) ? row.a : [])) headings.add(awardCeremony(award, feed));
  }
  headings.delete(null);
  const rest = [...headings].filter((h) => h !== feed).sort((a, b) => a.localeCompare(b));
  return headings.has(feed) ? [feed, ...rest] : rest;
}

/** The /awards tab for one of a friend's headings: the feed's keeps the plain id older links use. */
export function friendCeremonyTabId (friendKey, ceremony, feedCeremony) {
  return ceremony === feedCeremony ? `friend:${friendKey}` : `friend:${friendKey}:${ceremony}`;
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
      // Kept exactly as sent, so caches and snapshots carry it unchanged (§4.3).
      const ceremony = typeof a.ceremony === 'string' ? a.ceremony.trim() : '';
      if (ceremony && ceremony.length <= 80 && !PLACEHOLDER_CEREMONY.test(ceremony)) award.ceremony = ceremony;
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
  // One group per friend per institution (a Movie Log user may keep several).
  return (friends || []).flatMap((friend) => {
    const row = friend?.profile?.ratings?.[id];
    const feed = friendCeremony(friend?.profile, friend?.name);
    const groups = new Map();
    (validAwards(row?.a) || []).forEach((a) => {
      const ceremony = awardCeremony(a, feed);
      const list = groups.get(ceremony) || [];
      list.push({ ...a, label: awardLabel(a, feed) });
      groups.set(ceremony, list);
    });
    return [...groups].map(([ceremony, awards]) => ({
      friend: friend.name,
      key: friend.key ?? null,
      tabId: friend.key == null ? null : friendCeremonyTabId(friend.key, ceremony, feed),
      ceremony,
      won: awards.filter((a) => a.result === 'won'),
      nominated: awards.filter((a) => a.result === 'nominated')
    }));
  }).sort((a, b) => a.friend.localeCompare(b.friend) || (a.tabId === `friend:${a.key}` ? -1 : b.tabId === `friend:${b.key}` ? 1 : a.ceremony.localeCompare(b.ceremony)));
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
        const category = year.get(key) || { label: award.label || award.category, kind: categoryKind(award.label || award.category), picks: [], seen: new Map() };
        year.set(key, category);
        const title = member.titles?.[movieId];
        const pick = { who: member.name, ceremony: award.ceremony || member.ceremony || `${member.name}'s awards`, movieId: Number(movieId), title: title?.t || null, poster: title?.p || null };
        // A film category is one pick per member per film (Movie Log names
        // every producer; that is still one Best Picture). A person category
        // is also one pick per member per film, naming everyone honoured for
        // it: Free Solo's three directors are one Best Director, not three
        // (Matt, 2026-10-07).
        // Two of one friend's institutions are two picks, never one (§4.2).
        const identity = `${member.name}|${pick.ceremony}|${pick.movieId}`;
        const existing = category.seen.get(identity);
        if (existing) {
          if (category.kind === 'person' && award.name && !existing.names.includes(award.name)) {
            existing.names.push(award.name);
            existing.name = existing.names.join(', ');
          }
          return;
        }
        if (category.kind === 'person' && award.name) { pick.names = [award.name]; pick.name = award.name; }
        category.seen.set(identity, pick);
        category.picks.push(pick);
      });
    });
  });
  return [...years.entries()].sort(([a], [b]) => b - a).map(([year, categories]) => ({
    year,
    categories: [...categories.values()].map(({ seen, ...category }) => {
      // Agreement is on the film, whatever the category.
      const picks = [...category.picks].sort((a, b) => a.who.localeCompare(b.who));
      // Two picks are the same choice when they are the same film (Matt,
      // 2026-10-07: "match based on movie"). In a person category the row
      // then lists everyone the members named for it.
      const same = (a, b) => a.movieId === b.movieId;
      const agreed = picks.some((a, i) => picks.slice(i + 1).some((b) => a.who !== b.who && same(a, b)));
      const films = new Set(category.picks.map((p) => p.movieId));
      // The same choice by several members is one row naming all of them
      // (Matt, 2026-10-07: the one-column-per-member cards were "really tall
      // and narrow"). Shared choices first.
      const rows = [];
      picks.forEach((p) => {
        let row = rows.find((r) => same(r, p));
        if (!row) {
          row = { movieId: p.movieId, title: p.title, poster: p.poster, names: p.names || [], who: [], ceremonies: [] };
          if (p.name) row.name = p.name;
          rows.push(row);
        }
        // People from every member, each once ("Elizabeth Chai Vasarhelyi"
        // and "Chai Vasarhelyi" are the same person; keep the fuller one).
        (p.names || []).forEach((name) => {
          const twin = row.names.findIndex((n) => samePerson(n, name));
          if (twin === -1) row.names.push(name);
          else if (name.length > row.names[twin].length) row.names[twin] = name;
        });
        if (row.names.length) row.name = row.names.join(', ');
        if (!row.poster && p.poster) row.poster = p.poster;
        if (!row.who.includes(p.who)) row.who.push(p.who);
        // Shown by the award's name, not the person's (Matt, 2026-10-07):
        // "Goegan Globes · The Groskers".
        row.ceremonies.push(p.ceremony);
      });
      const choices = rows.map(({ names, ...row }) => row).sort((a, b) => (b.who.length - a.who.length) || a.who[0].localeCompare(b.who[0]));
      return { ...category, picks: picks.map(({ names, ...p }) => p), choices, agreed, filmCount: films.size };
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
    if (list) awards[id] = list.map((a) => ({ ...a, label: awardLabel(a, ceremony) }));
    titles[id] = { t: row?.t || null, p: row?.p || null };
  });
  return { name, ceremony, awards, titles };
}
