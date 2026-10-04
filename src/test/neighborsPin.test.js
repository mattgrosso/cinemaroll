import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Bug report (2026-08-21): "When I press this little up/down arrow next to the
// 'nearby films'... I'm assuming it's supposed to make that list be sorted
// ascending or descending, but it doesn't do anything."
//
// It never sorted anything — it pins the neighbours strip to the bottom of the
// screen. But it genuinely did nothing, for eleven months. `.neighbors` was
// `position: sticky; bottom: 0` with `&.unstuck { position: relative }` to
// release it; commit 6020426 ("Cleans up layout for rate movie form",
// 2025-09-06) changed the base to `position: relative` inside a 267-line
// refactor and left the toggle alone. Both states were then `relative`, so the
// class flipped and nothing moved.
//
// jsdom loads no stylesheet and performs no layout, so a mount cannot tell
// these two states apart (see .claude/rules/testing.md). The contract that
// matters is in the CSS itself: the pinned and released states must differ.
const source = readFileSync(join(process.cwd(), 'src/components/RateMovie.vue'), 'utf8');

// Comments are stripped first. The explanation above the declaration quotes
// both `position: relative` and `position: sticky`, either of which would
// satisfy a naive match on its own — the same trap searchBoltStacking.test.js
// documents.
const withoutComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

const styles = withoutComments(source.slice(source.indexOf('<style')));

/** Declarations directly on `.neighbors`, stopping at its first nested rule. */
const neighborsOwnDeclarations = () => {
  const start = styles.indexOf('.neighbors {');
  expect(start, '.neighbors rule should exist').toBeGreaterThan(-1);
  const body = styles.slice(start + '.neighbors {'.length);
  const firstNested = body.indexOf('{');
  return firstNested === -1 ? body : body.slice(0, firstNested);
};

const unstuckDeclarations = () => {
  const start = styles.indexOf('&.unstuck {');
  expect(start, '&.unstuck rule should exist').toBeGreaterThan(-1);
  const body = styles.slice(start + '&.unstuck {'.length);
  const firstNested = body.indexOf('{');
  return firstNested === -1 ? body : body.slice(0, firstNested);
};

const positionIn = (block) => block.match(/position\s*:\s*([a-z-]+)/)?.[1] ?? null;

describe('the neighbours strip pin', () => {
  it('is pinned by default', () => {
    expect(positionIn(neighborsOwnDeclarations())).toBe('sticky');
  });

  it('releases the strip when unstuck', () => {
    expect(positionIn(unstuckDeclarations())).toBe('relative');
  });

  // The actual bug, stated directly: a toggle whose two states are identical
  // is a toggle that does nothing.
  it('has two states that actually differ', () => {
    expect(positionIn(unstuckDeclarations())).not.toBe(positionIn(neighborsOwnDeclarations()));
  });

  // `bottom: 0` left behind on a relatively-positioned element is a live
  // offset, not a no-op, so releasing has to clear it.
  it('clears the bottom offset when released', () => {
    expect(unstuckDeclarations()).toMatch(/bottom\s*:\s*auto/);
  });
});

describe('the pin control', () => {
  const template = source.slice(0, source.indexOf('<script'));

  // The old up/down arrows are what made this read as a sort control.
  it('uses a pin, not directional arrows', () => {
    expect(template).toMatch(/bi-pin-angle/);
    expect(template).not.toMatch(/bi-arrow-bar-(up|down)/);
  });

  it('is reachable and labelled', () => {
    expect(template).toMatch(/role="button"/);
    expect(template).toMatch(/:aria-label="neighborsPinned/);
  });

  // Reactive state rather than a $refs class mutation - the old approach left
  // no seam a test could reach, which is part of why this went unnoticed.
  it('drives the class from component state', () => {
    expect(template).toMatch(/:class="\{ unstuck: !neighborsPinned \}"/);
    expect(source).not.toMatch(/classList\.toggle\(["']unstuck["']\)/);
  });
});

// Bug report (2026-10-04), after Cover Flow grew to fill the strip: "the pin
// icon is way too big over there now... make the pin smaller". It used to be
// a 40px dark circle taking a slot at the end of the flex row, squeezing the
// posters. Now it floats over the corner, out of the row.
describe('the pin stays out of the poster row', () => {
  const pinDeclarations = () => {
    const start = styles.indexOf('.hide-neighbors {');
    expect(start, '.hide-neighbors rule should exist').toBeGreaterThan(-1);
    const body = styles.slice(start + '.hide-neighbors {'.length);
    return body.slice(0, body.indexOf('{'));
  };

  it('is positioned over the strip, not laid out in it', () => {
    expect(positionIn(pinDeclarations())).toBe('absolute');
  });

  it('is a small bare icon, not a dark circle', () => {
    const decls = pinDeclarations();
    expect(Number(decls.match(/font-size\s*:\s*(\d+)px/)?.[1])).toBeLessThanOrEqual(16);
    expect(decls).not.toMatch(/background/);
    expect(decls).not.toMatch(/border-radius/);
  });

  // Small icon, but the tap target keeps the house 40px minimum.
  it('keeps a 40px tap area', () => {
    const decls = pinDeclarations();
    expect(decls).toMatch(/width\s*:\s*40px/);
    expect(decls).toMatch(/height\s*:\s*40px/);
  });
});
