// The little superscript count beside a name, genre or keyword (Matt,
// 2026-10-06: "like a little exponent ... with a color coding, so you can
// quickly glance to see if it's a certain color that it means there's more
// of them"). Four tiers, warmer as the number climbs. A count of 1 is this
// film alone and says nothing, so it isn't shown at all.
export const COUNT_TIERS = [
  { min: 15, name: 'lots' },
  { min: 8, name: 'many' },
  { min: 4, name: 'some' },
  { min: 2, name: 'few' }
];

/** 'few' | 'some' | 'many' | 'lots', or null when there is nothing to show. */
export function countTier (count) {
  const n = Number(count);
  if (!Number.isFinite(n) || n < 2) return null;
  return COUNT_TIERS.find((tier) => n >= tier.min).name;
}
