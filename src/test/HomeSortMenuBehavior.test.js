import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Bug report 2026-08-26: "When I click the toggle for adjusted for inflation,
// it shouldn't close that sort drop down because then I just have to reopen it
// and pick another thing."
//
// The cause, found by reproducing it against real Bootstrap 5.3.3 rather than
// by reading the source: **Bootstrap registers its delegated data-api handlers
// with useCapture TRUE** (EventHandler passes the `delegation` flag straight
// into addEventListener's third argument). So the document-level
// [data-bs-toggle] click handler runs BEFORE anything inside the menu can see
// the event. While the <ul> was nested inside the toggle <button>, every click
// in the menu therefore reached the toggle and shut it, and NO amount of
// @click.stop could prevent it — two attempts failed exactly that way.
//
// The fix is to take the toggle out of the event path: the <ul> is now a
// SIBLING of the button inside the existing .btn-group, which is Bootstrap's
// own documented structure. Picking a sort closes the menu again on its own
// (clearMenus), and the money toggle's @click.stop now works because the
// event only has to be stopped before it reaches document in the BUBBLE
// phase, which is where clearMenus lives.
//
// The other way to fix it — wrapping the toggle in <div class="dropdown"> —
// is a trap, guarded below.
//
// Asserted against the source: jsdom loads no Bootstrap JS, so a mounted
// component has no dropdown to open and a test that tried would pass against
// the broken page.
const source = () => readFileSync(join(process.cwd(), 'src/components/Home.vue'), 'utf8');

const actionsRow = () => {
  const text = source();
  const start = text.indexOf('class="results-actions col-12');
  const end = text.indexOf('<section class="home-notices">');
  return text.slice(start, end);
};

describe('the sort menu closes on a pick and stays open on the money toggle', () => {
  it('keeps the menu OUT of the toggle button', () => {
    const row = actionsRow();
    const buttonClose = row.indexOf('</button>', row.indexOf('data-bs-toggle="dropdown"'));
    const menuOpen = row.indexOf('<ul class="dropdown-menu');
    expect(menuOpen).toBeGreaterThan(-1);
    // The toggle must be closed BEFORE the menu opens, or the menu is nested
    // inside it again and Bootstrap's capture-phase handler wins.
    expect(buttonClose).toBeLessThan(menuOpen);
  });

  it('lets the money toggle stop its own click', () => {
    expect(actionsRow()).toContain('@click.stop="toggleMoneyInflation"');
  });

  // Closing is Bootstrap's job again. An explicit hide here would mean the
  // menu is being stopped somewhere it shouldn't be.
  it('does not hand-roll the close', () => {
    expect(source()).not.toContain('closeSortMenu');
    expect(actionsRow()).not.toContain('<ul class="dropdown-menu" @click.stop>');
  });

  // THE TRAP. `flex: 1 1 0` sits on the button rather than on any wrapper —
  // so wrapping the toggle resizes the row. The <ul> is only safe as a sibling because the sort chip
  // is the LAST button in the group; putting it anywhere earlier would shift
  // every chip after it.
  it('never wraps the toggle, and keeps the sort chip last', () => {
    const row = actionsRow();
    expect(row).not.toContain('<div class="dropdown');

    const buttons = [...row.matchAll(/<button[^>]*class="results-actions-button/g)];
    // Scoped to each button's OWN tag — a fixed lookahead window spills into
    // the next button and finds the toggle one chip early.
    const toggleIndex = buttons.findIndex((m) => row.slice(m.index, row.indexOf('>', m.index)).includes('data-bs-toggle="dropdown"'));
    expect(buttons.length).toBeGreaterThan(1);
    expect(toggleIndex).toBe(buttons.length - 1);
  });
});

// Follow-on report, 2026-08-26: "the drop down menu that comes out of the sort
// goes full width, and it's way too big. Before it was nice and compact over
// on the right hand side."
//
// Moving the menu out of the toggle button exposed a rule that had been
// catching it all along: `.home .results ul { width: 100% }`, meant for the
// results list. It was invisible while the menu lived inside the 157px chip —
// 100% of a chip looks exactly like a compact dropdown — and became 800px the
// moment the menu's parent became the full-width .btn-group. Measured live.
describe('the sort menu stays compact', () => {
  const styleBlock = () => {
    const text = source();
    return text.slice(text.indexOf('.results-actions {'), text.indexOf('.pending-match-badge') + 1 || undefined);
  };

  it('opts the menu out of the full-width results-list rule', () => {
    const block = styleBlock();
    const rule = block.match(/ul\.dropdown-menu \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule[0]).toContain('width: max-content');
  });

  // The type selector is what wins against `.home .results ul` — (0,4,1) vs
  // (0,2,1). Dropping it silently restores the bug.
  it('keeps the ul type selector that carries the specificity', () => {
    expect(styleBlock()).toContain('ul.dropdown-menu {');
  });

  it('caps the width so a phone can still see the whole menu', () => {
    expect(styleBlock().match(/ul\.dropdown-menu \{[^}]*\}/)[0]).toContain('max-width');
  });

  // The sort chip is the rightmost of the seven, so the menu hangs off its
  // right edge rather than running off the screen.
  it('right-aligns the menu under its toggle', () => {
    expect(actionsRow()).toContain('class="dropdown-menu dropdown-menu-end"');
  });
});
