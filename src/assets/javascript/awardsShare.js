// Sharing personal awards with the club (Matt, 2026-10-06: "include his
// awards in our awards lists for the movies that we come across, and then
// make my award choices available to him" — for anybody's awards, in Movie
// Log or Cinema Roll). Awards ride along with ratings in the two things
// already shared: the in-app social profile and the Film Club feed. One
// projection serves both: per movie, a short list of { year, category,
// label, result, name? }, plus the ceremony's name at the top.
import { awardCategoryNameMap } from './personalAwardsCategories.js';

export const AWARD_RESULTS = ['won', 'nominated'];

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
    const awards = validAwards(row?.a) || [];
    if (!awards.length) return null;
    const ceremony = friend.profile?.awardsName || `${friend.name}'s awards`;
    return {
      friend: friend.name,
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
