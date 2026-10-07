// Shared Academy Award category display-order + sort helper. Previously
// duplicated three times (MovieDetail.vue x2, DBGridLayoutSearchResult.vue
// x2, near-identical logic in each) with two DIFFERENT category lists that
// had quietly drifted apart — MovieDetail's used only current-era category
// names (e.g. "Best International Feature Film"), DBGridLayoutSearchResult's
// included older/retired category names the Academy has since renamed or
// discontinued (e.g. "Best Foreign Language Film", "Best Assistant
// Director", "Best Title Writing"). This is the union of both, so awards
// data from any era sorts predictably regardless of which historical name
// film-awards-api returns for a given ceremony year.
export const ACADEMY_CATEGORY_ORDER = [
  "Best Picture",
  "Best Director",
  "Best Actor",
  "Best Actress",
  "Best Supporting Actor",
  "Best Supporting Actress",
  "Best Original Screenplay",
  "Best Adapted Screenplay",
  "Best Screenplay",
  "Best Animated Feature Film",
  "Best Animated Feature",
  "Best Cinematography",
  "Best Costume Design",
  "Best Casting",
  "Best Documentary Feature",
  "Best Documentary",
  "Best Documentary Short Subject",
  "Best Documentary Short",
  "Best Film Editing",
  "Best Editing",
  "Best Makeup and Hairstyling",
  "Best Makeup",
  "Best Original Score",
  "Best Adapted Score",
  "Best Original Song",
  "Best Production Design",
  "Best Sound Editing",
  "Best Sound Mixing",
  "Best Sound",
  "Best Visual Effects",
  "Best Animated Short Film",
  "Best Animated Short",
  "Best Live Action Short Film",
  "Best Live Action Short",
  "Best Foreign Language Film",
  "Best International Feature Film",
  "Best Assistant Director",
  "Best Dance Direction",
  "Best Title Writing"
];

const LOWER_ORDER = ACADEMY_CATEGORY_ORDER.map((c) => c.toLowerCase());

export function sortByAcademyCategoryOrder (awards) {
  return [...awards].sort((a, b) => {
    const indexA = LOWER_ORDER.indexOf(a.category.toLowerCase());
    const indexB = LOWER_ORDER.indexOf(b.category.toLowerCase());

    if (indexA === -1 && indexB === -1) return 0;
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}
