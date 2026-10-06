// Critics' reviews on the movie page — what the screen says about them.
// The lookup and the choosing happen server-side (aws-lambda/criticReviews.js
// decides what is worth showing); this is only the wording.

// The three jobs a review can do, in the order the page shows them.
export const CRITIC_ROLE_LABELS = {
  release: 'When it came out',
  revisit: 'Looking back',
  dissent: 'Against the grain'
};

export function criticRoleLabel (role) {
  return CRITIC_ROLE_LABELS[role] || '';
}

/** "Roger Ebert, 1990" / "Staff review, Variety" — the line under the role. */
export function criticByline (review) {
  if (!review) return '';
  const who = review.critic === 'Staff review' && review.outlet
    ? `Staff review, ${review.outlet}`
    : [review.critic, review.outlet].filter(Boolean).join(', ');
  return review.year ? `${who}, ${review.year}` : who;
}

/**
 * The folded row's one line. Before the lookup it says what's inside; after,
 * it names the critics, two at most and a count of the rest.
 */
export function criticsSummary (state, reviews = []) {
  if (state === 'loading') return 'Looking…';
  if (state === 'error' || state === 'failed') return "Couldn't look just now";
  if (state !== 'ready') return 'What the critics said';
  if (!reviews.length) return 'None found';
  const names = [];
  for (const review of reviews) {
    const name = review.critic === 'Staff review' ? review.outlet : review.critic;
    if (name && !names.includes(name)) names.push(name);
  }
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? `${shown} +${names.length - 2}` : shown;
}
