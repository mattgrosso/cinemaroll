---
paths:
  - "src/**/*.vue"
  - "src/assets/scss/**"
---

# UI rules (Vue components)

Cinema Roll is a **mobile-first PWA installed on iOS home screens**. Nearly every UI
bug in this project's history came from forgetting that. Full narrative:
`docs/history/ui-and-layout.md`.

## Never use `:hover` for feedback — use `:active`

A tapped element keeps its hover state on iOS, because there is no mouse to leave it.
This has shipped as a user-visible bug **more than once** (tiebreak posters "stuck
grown" after selection; game tiles). Add `:active` press states; add `:hover` only as a
redundant extra for mouse users, never as the only feedback.

## Always check contrast

Dark themes throughout. Before shipping any UI change, verify text is legible against
its actual background. Bootstrap's `.text-muted` (~#6c757d) **fails** against this app's
`#4a4a4a` panels (~2.3:1) — use `#ccc` (~6:1), as `.result-wins` does.

## Every programmatic document scroll needs an explicit `behavior`

`<html>` has `scroll-behavior: smooth`, which makes these **silent no-ops**:

```js
window.scrollTo({ top: 0 })              // does nothing
document.documentElement.scrollTop = 900 // does nothing
```

Use `src/utils/scrollWindowTo.js`, or pass `behavior: 'instant'` explicitly. This broke
Home's scroll restoration for a 1,300-movie library without anyone noticing, and made a
first attempt at the games scroll-to-top do nothing at all.

## Style calls Matt has made

- **All notifications go in Home's `.home-notices` section** (2026-08-21: "make that
  notification space a unified concept and use it for all notifications going
  forward"). Anything the app wants to tell the user renders as a `.prompt-card`
  inside that one section — never a stray banner, never nested inside the results
  area, never mounted globally in App.vue (Offline/LibraryAccess are app STATES and
  stay global). Two accent families, documented in `_prompt-card.scss`: the chores
  keep their app-vocabulary colours; anything where the app talks about itself
  (updates, bug resolutions, future housekeeping) uses the neutral `-app` accent.
  `homeNotices.test.js` enforces the placement at the source level.

- **Don't build a feature on a permission the OS can revoke behind your back.**
  Banner tilt parallax was built 2026-08-21 and **removed 2026-08-24**. Read this before
  proposing anything that needs `requestPermission()`.

  It needed iOS motion permission, and iOS only delivers orientation events after
  `requestPermission()` resolves **in that page session** — so a remembered "yes" cannot
  short-circuit the call. When iOS still holds the grant the call is silent; when iOS has
  forgotten it (Safari expires it for origins you haven't visited in a while) the call
  rejects, and the only way to recover is to ask again from inside a user gesture, which
  puts a system dialog in front of an unrelated tap.

  Two rounds of fixes could only reduce the frequency, never reach zero. Round one moved
  the answer to module scope + `localStorage`, because three components each built their
  own parallax and per-instance state meant every movie you opened armed another listener
  and another dialog ("It's annoying how often cinema roll is now asking me for permission
  to detect motion... if we can't reduce the number of times that it asks then we should
  just get rid of that feature", 2026-08-22). That cut it from once-per-movie to
  once-per-launch. Natalie then reported it again against the fixed build — "it should
  only ask once and then remember that" — because once-per-launch is still the floor of
  that approach. Matt's call, 2026-08-24: "if we can't reduce the number of prompts for
  the parallax feature, let's just go ahead and lose it."

  The lesson is about the trade, not the plumbing: a decorative effect cannot justify a
  recurring system prompt. If a future feature needs a revocable permission, ask only from
  an explicit user action that wants it, degrade silently when it's gone, and never re-ask
  spontaneously.

- **Poster/photo rows: images edge-aligned, text flows.** In any horizontal
  row of posters or photos, every image's top AND bottom edge must line up:
  fixed image height + `align-items: flex-start` on the row. Text below an
  image may grow to any number of lines — never clamp, ellipse, or
  fixed-height it; the cards just get taller (2026-08-15).

- **No emojis in the UI.** Blanket rule (2026-08-15, after the category-row
  crown): never use emoji glyphs in designs — status marks, winner badges,
  decorations, anything. Use Bootstrap Icons (`bi-*`) with explicit colors
  (gold `#ffd700` for winner marks) or plain styled text instead. Existing
  emojis elsewhere in the app are sweep candidates when touching that code.

- **No left-edge accent bars** (the Bootstrap-ish colored strip on a panel's left
  edge as the only stroke of color) — he's said he's "not that into it" (2026-08-15,
  Trophy Case films panel). Prefer neutral surfaces (#161616/#2e2e2e border) and show
  selection/focus by dimming siblings + subtle scale, not colored outlines. Several
  older screens still carry left-accent banners (Reel Wordle/Connections/Clue Budget
  result banners, target-clues) — sweep candidates, don't add new ones.

## The Web is the one screen that hides the shared header

`WebScreen.vue` commits `setShowHeader(false)` in `created` and `true` in
`beforeUnmount` (2026-09-13: "it's hard to get it to use the whole screen... maybe just a
redesign so that it uses more of the real estate"), and lays itself out as a
`100dvh` flex column with the canvas taking everything between a compact head and a
one-line foot. That `100dvh` on a routed root is deliberate and is NOT the phantom-scroll
trap below — that trap is a full viewport stacked *under* the header. Games keep the
header (with their own banner, see Six Degrees); don't hide it anywhere else without
the same restore-on-unmount, or the next screen inherits a headerless app.

## Layout traps that have bitten here

- **Don't put `min-height: 100vh` on a routed component's root.** `.cinema-roll` and
  `.app-main` already handle full-height layout; adding it produces a phantom
  header's-worth of empty scroll on every such page. This was true of 13 components at
  once.
- **Adjacent margins collapse to the larger.** Halving one side of a gap changes nothing
  if the other side dominates — reduce both, and check which rule is actually winning
  before assuming your edit did anything.
- **A percentage height on a flex-sized parent silently does nothing.** Cap by height and
  let `aspect-ratio` derive the width; cross-axis `stretch` sets height but lets flex
  pick the width.
- **A form control's UA-imposed minimum width beats `width: 100%`.** `datetime-local` in
  a narrow Bootstrap column overflowed horizontally and latched the iOS layout viewport
  wider than the screen. `min-width: 0` on `.form-control`/`.form-select` is the fix.
- **Bootstrap's data-api handlers run in the CAPTURE phase**, so `@click.stop` inside a
  widget cannot stop them. `EventHandler.on(document, evt, selector, fn)` passes its
  `delegation` flag straight into `addEventListener`'s third argument. Consequence: a
  `.dropdown-menu` nested INSIDE its own `[data-bs-toggle="dropdown"]` button is shut by
  every click in it, because the document-level toggle handler fires before anything in
  the menu sees the event. Two rounds of `@click.stop` failed against this before it was
  reproduced in an isolated page (2026-08-26). Keep the menu a SIBLING of the toggle —
  Bootstrap's own btn-group structure. Note also that this only survives because Vue
  builds the DOM programmatically; the same markup written as plain HTML has the `<ul>`
  hoisted out of the `<button>` by the parser, so a static-HTML test of it is testing a
  different tree.
- **`.home .results ul { width: 100% }` catches the sort dropdown too.** It was invisible
  for as long as the menu lived inside the 157px toggle chip — 100% of a chip looks
  exactly like a compact dropdown — and became 800px the moment the menu was re-parented
  to the full-width `.btn-group`. The menu opts out with `ul.dropdown-menu { width:
  max-content }`; the **type selector is load-bearing** (0,4,1 against that rule's 0,2,1),
  not decoration. General lesson: a broad element rule under a page class can be masked
  for years by the containing block it happens to land in, and surfaces the moment
  anything re-parents.
- **Don't wrap a chip in `.results-actions`.** Those buttons take their rainbow colours
  from `.results-actions-button:nth-child(N)` and their width from `flex: 1 1 0` on the
  button itself, so any wrapper recolours and resizes the row. Adding a SIBLING after the
  last chip is safe; adding one earlier shifts every colour after it.
- **An invisible full-height overlay for a gesture will eat real taps.** `BackLink`'s
  20px edge-swipe strip silently ate the leftmost button on every game screen. Listen on
  `window` and filter by touch origin instead.
- **`v-show` does not hide a Bootstrap display utility.** `v-show` writes an inline
  `display: none`; `.d-flex`/`.d-block`/`.d-grid` are `display: … !important`, and
  `!important` in a stylesheet beats a plain inline style. `v-show` on such an element is
  a **silent no-op** — the tiebreak poster row stayed fully laid out under its own loading
  spinner and visibly dropped 180px. Toggle a class you own (`visibility: hidden` keeps the
  space reserved and refuses taps), or put `v-show` on a wrapper that carries no `d-*`
  class. **jsdom will not catch this**: no Bootstrap CSS is loaded there, so a test
  asserting `element.style.display === 'none'` passes against the broken page. Assert the
  class instead.
- **A loading state that replaces content must overlay it, not precede it.** Two siblings
  in normal flow means the content moves the moment the indicator leaves. One
  `position: relative` stage + an `inset: 0` indicator over a hidden-but-present row
  costs zero layout shift.
- **Touch targets: 40px minimum.** Anything smaller gets reported as "the button doesn't
  work."
- **`transform` only during drag** — combining it with `filter`/shadow left visual trails
  on real devices.

## Mid-drag state and animation

A helper that mutates reactive state as its last act, followed by more mutations in the
caller, **paints an intermediate frame** — `await` yields to Vue's scheduler in between.
Keep such mutations in one synchronous block. And `v-for` keys must be identity-based,
never array indices, or insertion makes Vue reuse the wrong DOM nodes.

## Measure at phone width

`.random-banner` is `display: none` above 600px. A desktop-width measurement is of a
layout no phone ever sees — this produced a confident "it fits" that was wrong by 240px.
Force the mobile header and a ~390px container when checking fit.
