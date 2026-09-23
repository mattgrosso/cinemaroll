// Resolve after the browser has painted once. Used to let a tap's
// acknowledgment (a pressed state, a moved tab highlight, a progress bar,
// a skeleton) reach the screen BEFORE the heavy render it triggers - Vue
// batches both into one render otherwise, and the user sees nothing until
// the expensive part is done (2026-09-23, "make it feel responsive").
//
// Under Vitest there is no paint to wait for and component tests assert
// right after mount, so it resolves on the next microtask there.
export function nextFrame () {
  return new Promise((resolve) => {
    if (import.meta.env?.VITEST || typeof requestAnimationFrame !== 'function') {
      queueMicrotask(resolve);
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}

/**
 * Run `fn` after the next paint; never rejects (the frame always comes).
 * Under Vitest it runs at once: the deferral is purely paint order, and the
 * component tests assert synchronously after a tap.
 */
export function afterFrame (fn) {
  if (import.meta.env?.VITEST) {
    fn();
    return;
  }
  nextFrame().then(() => { fn(); return null; }).catch(() => {});
}

/**
 * Whether a screen should paint a skeleton for its first frame. Off under
 * Vitest, where component tests read the real content straight after mount.
 */
export const SKELETON_FIRST = !(import.meta.env?.VITEST);

