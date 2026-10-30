// screenPin - house module: keeps the bug button (and anything marked
// data-pin-bottom) at the real bottom of the screen in the installed app.
// Byte-identical in every app; change it here and copy it to the rest.
//
// THE CAUSE (2026-10-30, after Matt: "it's happening on a bunch of my
// different apps... I don't think you've managed to figure out why"): an iOS
// bug, WebKit 297779 / FB19889436. After the keyboard closes - and sometimes
// with no keyboard at all - iOS leaves the page's layout viewport short and
// doesn't restore it. `position: fixed; bottom: ...` is measured from the
// bottom of that viewport, so the button rides up the screen by however
// much iOS cut off (his Cinema Roll screenshot: one keyboard height). Nothing
// in our CSS was wrong, and no event reliably says when it happens, which is
// why each app's one-off fix came back.
//
// THE FIX: remember how tall the page really is (the tallest it has been at
// this width with no keyboard up, kept between launches), check the current
// height every second and on every viewport event, and when the page is cut
// short by STUCK_MIN or more, slide the pinned things down by the difference
// (`translate` on each, so each app keeps its own `bottom`; `--screen-pin-gap`
// on the root holds the same number for any app CSS that wants it). With a text box focused
// it leaves them alone, so they still ride above the keyboard. Only in the
// installed app: in a browser the toolbars come and go for real.

const STUCK_MIN = 120 // smaller differences are toolbars and rounding, not the bug
const SHORT = 0.75 // a page under 3/4 of the screen is never trusted as "full"
const STATUS_BAR = 62 // with nothing remembered yet: the screen less the status bar
const STORE = 'house:screenPin:tallest'
const PINNED = '.bug-trigger, .bug-report-trigger, [data-pin-bottom]'

const isStandalone = () => window.navigator.standalone === true ||
  window.matchMedia?.('(display-mode: standalone)').matches === true

const TEXT_TYPES = /^(text|search|url|email|tel|number|password)$/
/** A text box has the keyboard up: the page is short on purpose. */
export function typing (el = document.activeElement) {
  if (!el) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && TEXT_TYPES.test(el.type || 'text')
}

/**
 * How far to slide the pinned things down, given the remembered tallest page
 * (0 if none), the page's height now, the screen's height, and whether we're
 * installed. Pure, for the tests.
 */
export function gapFor ({ tallest = 0, height, screenHeight = 0, standalone = true }) {
  if (!standalone || !height) return 0
  let full = Math.max(tallest, height)
  if (!tallest && screenHeight && height < screenHeight * SHORT) full = screenHeight - STATUS_BAR
  const gap = full - height
  return gap >= STUCK_MIN ? gap : 0
}

/** Should this height be remembered as the page's full height? */
export function looksWhole ({ height, screenHeight = 0, standalone = true }) {
  return !(standalone && screenHeight && height < screenHeight * SHORT)
}

let tallest = {}
let last = null
const report = { gap: 0, stuckSeen: 0, lastStuck: null }

function read () {
  try { tallest = JSON.parse(window.localStorage.getItem(STORE) || '{}') || {} } catch { tallest = {} }
}
function keep () {
  try { window.localStorage.setItem(STORE, JSON.stringify(tallest)) } catch { /* private mode: memory only */ }
}

function apply () {
  const root = document.documentElement
  const standalone = isStandalone()
  const width = window.innerWidth
  const height = window.innerHeight
  const screenHeight = window.screen?.height || 0
  let gap = 0
  if (standalone && !typing()) {
    if (height > (tallest[width] || 0) && looksWhole({ height, screenHeight, standalone })) { tallest[width] = height; keep() }
    gap = gapFor({ tallest: tallest[width] || 0, height, screenHeight, standalone })
  }
  if (gap && !report.gap) { report.stuckSeen += 1; report.lastStuck = { gap, height, at: new Date().toISOString() } }
  report.gap = gap
  const value = `${gap}px`
  if (value !== last) { last = value; root.style.setProperty('--screen-pin-gap', value) }
  // Only things hung from the bottom move: a bug button some app pins to the
  // top (Thunder, Space Base's top-right one) sits in the top half and stays.
  for (const el of document.querySelectorAll(PINNED)) {
    const want = gap && el.getBoundingClientRect().top > height / 2 ? `0 ${gap}px` : ''
    if (el.style.translate !== want) el.style.translate = want
  }
}

/** Start watching. Safe to call more than once. */
export function watchScreenPin () {
  if (typeof window === 'undefined' || window.__screenPin) return
  window.__screenPin = report // for a bug report or the console: is the page cut short right now?
  read()
  const settle = () => { apply(); setTimeout(apply, 350) }
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', () => setTimeout(apply, 300))
  window.visualViewport?.addEventListener('resize', apply)
  window.visualViewport?.addEventListener('scroll', apply)
  document.addEventListener('focusin', apply)
  document.addEventListener('focusout', () => setTimeout(settle, 50))
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settle() })
  window.addEventListener('pageshow', settle)
  // iOS cuts and restores the page without always firing an event, so look
  // once a second too (one innerHeight read; nothing is written unless it changed).
  setInterval(() => { if (!document.hidden) apply() }, 1000)
}

watchScreenPin()
