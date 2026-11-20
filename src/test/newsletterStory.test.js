import { describe, it, expect } from 'vitest';
import { storyBlocks, paragraphsOf, stillUrl } from '@/assets/javascript/newsletterStory.js';

const article = (n) => Array.from({ length: n }, (_, i) => `Paragraph ${i + 1}.`).join('\n\n');
const types = (blocks) => blocks.map((b) => (b.type === 'para' ? 'p' : b.type));

describe('storyBlocks', () => {
  it('sets the pull quote after the second paragraph of a long piece', () => {
    const blocks = storyBlocks(article(6), { pullQuote: 'A line.' });
    expect(types(blocks)).toEqual(['p', 'p', 'quote', 'p', 'p', 'p', 'p']);
  });

  it('after the first in a short one, and not at all in a tiny one', () => {
    expect(types(storyBlocks(article(3), { pullQuote: 'A line.' }))).toEqual(['p', 'quote', 'p', 'p']);
    expect(types(storyBlocks(article(2), { pullQuote: 'A line.' }))).toEqual(['p', 'p']);
  });

  it('spreads the stills through the piece, never first, never last, never right after the quote', () => {
    const blocks = storyBlocks(article(8), { pullQuote: 'A line.', stills: ['/a.jpg', '/b.jpg', '/c.jpg'] });
    const t = types(blocks);
    expect(t[0]).toBe('p');
    expect(t[t.length - 1]).toBe('p');
    expect(t.filter((x) => x === 'still')).toHaveLength(3);
    const q = t.indexOf('quote');
    expect(t[q + 1]).toBe('p');
    // No two pictures together.
    t.forEach((x, i) => { if (x === 'still') expect(t[i + 1]).toBe('p'); });
  });

  it('shows fewer stills when the piece is too short to hold them', () => {
    const blocks = storyBlocks(article(3), { stills: ['/a.jpg', '/b.jpg', '/c.jpg'] });
    expect(types(blocks).filter((x) => x === 'still')).toHaveLength(1);
    expect(types(blocks).at(-1)).toBe('p');
  });

  it('marks only the first paragraph as the lead (the drop cap)', () => {
    const blocks = storyBlocks(article(3));
    expect(blocks.filter((b) => b.lead)).toHaveLength(1);
    expect(blocks[0].lead).toBe(true);
  });

  it('splits on blank lines and drops empties', () => {
    expect(paragraphsOf('One.\n\n\n  \nTwo.\n')).toEqual(['One.', 'Two.']);
    expect(stillUrl(null)).toBe(null);
    expect(stillUrl('/x.jpg')).toBe('https://image.tmdb.org/t/p/w1280/x.jpg');
  });
});
