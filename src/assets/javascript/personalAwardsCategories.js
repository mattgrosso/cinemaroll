// Single source of truth for the personal-awards category list, shared by
// PersonalAwardsModal.vue (where they're nominated/won) and MovieDetail.vue
// (where a movie's personal-award history is displayed). Keeping this in one
// place means the two can never drift out of sync on key/name/type.
export const PERSONAL_AWARD_CATEGORIES = [
  { key: 'bestPicture', name: 'Best Picture', type: 'movie' },
  { key: 'bestDirector', name: 'Best Director', type: 'person' },
  { key: 'bestActor', name: 'Best Actor', type: 'person' },
  { key: 'bestActress', name: 'Best Actress', type: 'person' },
  { key: 'bestSupportingActor', name: 'Best Supporting Actor', type: 'person' },
  { key: 'bestSupportingActress', name: 'Best Supporting Actress', type: 'person' },
  { key: 'bestScreenplay', name: 'Best Screenplay or Writing', type: 'movie' },
  { key: 'bestCinematography', name: 'Best Cinematography', type: 'movie' },
  { key: 'bestEditing', name: 'Best Editing', type: 'movie' },
  { key: 'bestScore', name: 'Best Score or Music', type: 'movie' },
  { key: 'bestVisualEffects', name: 'Best Visual Effects or Production Design', type: 'movie' },
  { key: 'bestAnimatedFeature', name: 'Best Animated Feature', type: 'movie' },
  { key: 'bestDocumentaryFeature', name: 'Best Documentary Feature', type: 'movie' },
  // Films made outside the US (2026-10-07; eligibility in awardEligibility.js).
  { key: 'bestInternationalFeature', name: 'Best International Feature', type: 'movie' },
];

export const PERSONAL_AWARD_CATEGORY_NAMES = PERSONAL_AWARD_CATEGORIES.reduce((acc, category) => {
  acc[category.key] = category.name;
  return acc;
}, {});

// ---------------------------------------------------------------------------
// Custom awards (2026-08-20): "It would be cool if for any given personal
// awards here, I could add custom awards. So if I wanted to, I can name an
// award whatever I want and then assign it. So I can basically hand out
// honorary awards."
//
// A custom award is stored per YEAR, next to that year's categories:
//
//   settings/personalAwards/<year>/customCategories/<key> = { name, createdAt }
//
// and its nominees/winner live in `categories/<key>` exactly like a standard
// one's. That is the whole trick: everything downstream — nominating, picking
// a winner, the completion check, the Trophy Case, a movie's award history —
// already keys off the category key and falls back gracefully on one it
// doesn't recognise, so custom awards ride the existing machinery rather than
// needing a parallel path.
//
// A MAP keyed by the award key, never an array: Firebase hands a sparse array
// back as an object map (see .claude/rules/data-writes.md), and a map also
// makes deleting one a leaf write.

export const CUSTOM_AWARD_PREFIX = 'custom-';

// A custom award goes either to a film or to a person — "I definitely need to
// be able to do honorary awards to people" (2026-08-20).
//
// A person-type custom award draws on the cast and crew of that year's films.
// It is deliberately NOT an acting category: no gender gating (that belongs to
// the four acting categories and nothing else) and no lead/supporting sibling
// conflict. Best Director is the shape it follows — a person picked from a
// film, shown over that film's poster.
export const CUSTOM_AWARD_TYPES = ['movie', 'person'];

// Awards created before person-type landed carry no `type` at all, and were
// all films. Defaulting rather than backfilling keeps those records valid
// exactly as written.
const DEFAULT_CUSTOM_AWARD_TYPE = 'movie';

export function customAwardType (stored) {
  return CUSTOM_AWARD_TYPES.includes(stored) ? stored : DEFAULT_CUSTOM_AWARD_TYPE;
}

/**
 * A stable, Firebase-safe key for an award name.
 *
 * Slug-derived rather than timestamped, deliberately: giving the same award
 * the same name next year produces the SAME key, so "2× Best Needle Drop"
 * aggregates across years in the Trophy Case the way a standard category
 * does. Returns null for a name with nothing sluggable in it (all
 * punctuation, or empty), which callers must reject rather than store.
 *
 * Firebase forbids . $ # [ ] / in a key; this emits only [a-z0-9-], so the
 * question can't arise.
 */
export function customAwardKey (name) {
  const slug = String(name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug ? `${CUSTOM_AWARD_PREFIX}${slug}` : null;
}

export function isCustomAwardKey (key) {
  return typeof key === 'string' && key.startsWith(CUSTOM_AWARD_PREFIX);
}

/**
 * One year's custom awards, oldest first, in the shape the category list
 * uses. Order is by creation so the list doesn't reshuffle as they're added.
 */
export function customCategoriesForYear (yearAwards) {
  return Object.entries(yearAwards?.customCategories || {})
    .filter(([, custom]) => custom?.name)
    .map(([key, custom]) => ({
      key,
      name: custom.name,
      type: customAwardType(custom.type),
      custom: true,
      createdAt: Number(custom.createdAt) || 0
    }))
    .sort((a, b) => a.createdAt - b.createdAt || a.name.localeCompare(b.name));
}

/** The standard categories plus this year's custom ones, in ceremony order. */
export function categoriesForYear (yearAwards) {
  return [
    ...PERSONAL_AWARD_CATEGORIES.map((category) => ({ ...category, custom: false })),
    ...customCategoriesForYear(yearAwards)
  ];
}

/**
 * `{ key: name }` for every award the user has ever handed out, standard and
 * custom, across every year.
 *
 * Whole-map rather than per-year because the two display consumers need it
 * that way: the Trophy Case aggregates a category ACROSS years ("3× Best
 * Needle Drop") and a movie's award history walks every year at once. A
 * custom award only defined in 2019 still has to render by name on a 2019
 * award shown in 2026.
 */
export function awardCategoryNameMap (personalAwards) {
  const names = { ...PERSONAL_AWARD_CATEGORY_NAMES };

  Object.values(personalAwards || {}).forEach((yearAwards) => {
    customCategoriesForYear(yearAwards).forEach((category) => {
      names[category.key] = category.name;
    });
  });

  return names;
}
