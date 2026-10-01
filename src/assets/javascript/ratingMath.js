// The weighted sum behind every score, one criterion at a time. GetRating.js
// totals these rows for the real score, and the Rate page's "The math" table
// shows the same rows, so the two can't disagree. They did (bug report
// 2026-10-01: "a score of 45.25, which doesn't make any sense"): the table
// summed the page's raw values, so an unset Stickiness counted as 0 while
// the score counted it as 1, and the table never showed the ÷ 10 that turns
// the weighted sum into a 0-10 score.

// Summation order. Kept exactly as the old inline sum ran it — float addition
// isn't associative, and scores are kept to four decimals.
export const CRITERIA = ['direction', 'imagery', 'story', 'performance', 'soundtrack', 'love', 'overall', 'stickiness'];

// What a criterion counts as in the score. Stickiness that's unset (or a
// legacy >5 value) falls back to the old impression field, else 1; an
// explicit 0 stays 0. A tiebreak tweak rides on Overall.
export const criterionValue = (rating, key) => {
  if (key === 'stickiness') {
    let stickiness = rating.stickiness;
    if ((!stickiness || stickiness > 5) && stickiness !== 0) {
      stickiness = parseFloat(rating.impression) || 1;
    }
    return parseFloat(stickiness);
  }
  if (key === 'overall') {
    return parseFloat(rating.overall) + parseFloat(rating.tweakValue || 0);
  }
  return parseFloat(rating[key]);
};

/**
 * Every criterion's value, weight and product, plus the sum and the score
 * (sum ÷ 10, kept to four decimals). `weightOf(name)` supplies the weight.
 */
export const ratingBreakdown = (rating, weightOf) => {
  const rows = [];
  let sum = 0;
  for (const key of CRITERIA) {
    const value = criterionValue(rating, key);
    const weight = weightOf(key);
    const product = weight * value;
    rows.push({ key, value, weight, product });
    sum += product;
  }
  return { rows, sum, score: parseFloat((sum / 10).toFixed(4)) };
};
