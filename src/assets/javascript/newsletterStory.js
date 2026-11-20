// How a newsletter story is laid out on the page (Matt, 2026-11-20: "make
// this thing look more like an article in a magazine ... some pictures").
//
// Pure, so the placement rules are tested directly (newsletterStory.test.js)
// rather than through a mount. The article arrives as one string with blank
// lines between paragraphs, and is rendered as text, never v-html: a model's
// output must not be able to inject markup.

const TMDB_IMAGES = 'https://image.tmdb.org/t/p';

/** A TMDB still or backdrop at a size that stays sharp full-width on a phone at 3x. */
export const stillUrl = (path, size = 'w1280') => (path ? `${TMDB_IMAGES}/${size}${path}` : null);

/** A headshot. */
export const headshotUrl = (path) => (path ? `${TMDB_IMAGES}/w185${path}` : null);

export const paragraphsOf = (article) => String(article || '')
  .split(/\n\s*\n/)
  .map((p) => p.trim())
  .filter(Boolean);

/**
 * The story as a list of blocks: paragraphs, with the pull quote and the
 * stills set between them.
 *
 * The pull quote goes after the second paragraph (the first in a short
 * piece), where a magazine puts one: far enough in that it isn't a second
 * headline, early enough to pull a reader on. Stills are spaced evenly
 * through the rest, never before the first paragraph (the hero is already
 * there), never after the last (the piece should end on words), and never
 * straight after the quote. A story too short to hold them simply shows
 * fewer.
 */
export function storyBlocks (article, { stills = [], pullQuote = null } = {}) {
  const paras = paragraphsOf(article);
  const n = paras.length;
  const quoteAfter = pullQuote && n >= 3 ? (n >= 5 ? 1 : 0) : -1;   // index of the paragraph it follows

  // Slots a still may follow: after paragraph i, for i in [0, n-2], not the quote's.
  const slots = [];
  for (let i = 0; i < n - 1; i += 1) if (i !== quoteAfter) slots.push(i);
  const pictures = (stills || []).filter(Boolean).slice(0, Math.max(0, Math.floor(slots.length / 2)));
  const stillAfter = new Map();
  pictures.forEach((path, k) => {
    // Evenly through the slots, starting past the first third of a gap.
    const at = slots[Math.min(slots.length - 1, Math.floor(((k + 1) * slots.length) / (pictures.length + 1)))];
    if (at != null && !stillAfter.has(at)) stillAfter.set(at, path);
  });

  const blocks = [];
  paras.forEach((text, i) => {
    blocks.push({ type: 'para', text, key: `p${i}`, lead: i === 0 });
    if (i === quoteAfter) blocks.push({ type: 'quote', text: pullQuote, key: 'quote' });
    if (stillAfter.has(i)) blocks.push({ type: 'still', path: stillAfter.get(i), key: `s${i}` });
  });
  return blocks;
}
