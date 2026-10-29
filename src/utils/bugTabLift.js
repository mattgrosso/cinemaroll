// The bug tab (BugReportButton) sits a fixed distance from the bottom of the
// screen. A screen with something of its own pinned to the bottom edge lifts
// it clear by setting this CSS variable on <html>; the tab's `bottom` takes
// the larger of its usual spot and the lift. Today that's only the rating
// page's Cover Flow strip, whose pin button sits in the same corner (report
// 2026-10-29: "the stickiness, pin button sort of overlaps it").
export const BUG_TAB_LIFT_VAR = '--bug-tab-lift';

// The tab's gap above whatever it's lifted over.
export const BUG_TAB_LIFT_GAP_PX = 8;

export function setBugTabLift (px) {
  document.documentElement.style.setProperty(BUG_TAB_LIFT_VAR, `${Math.ceil(px)}px`);
}

export function clearBugTabLift () {
  document.documentElement.style.removeProperty(BUG_TAB_LIFT_VAR);
}
