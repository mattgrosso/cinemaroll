// screenPin - house module: keeps the bug button (and anything marked
// data-pin-bottom) at the real bottom of the screen in the installed app.
// Byte-identical in every app; change it here and copy it to the rest.
//
// TWO iOS FAULTS, both seen on Matt's iPhone (iOS 27.0.1), neither our CSS:
//
// 1. A SHORT PAGE (2026-10-30). iOS leaves the installed app's layout
//    viewport short (innerHeight cut) and doesn't restore it, so
//    `position: fixed; bottom: ...` rides up by the cut. We remember the
//    tallest the page has been at this width and slide pinned things down by
//    the difference.
//
// 2. A PHANTOM KEYBOARD (2026-11-01, Matt: "sticky elements have all gone to
//    shit on a bunch of my apps"). The page is its whole height, but iOS's
//    visible view (window.visualViewport) is a keyboard's height short and
//    often pushed down, with no keyboard on screen and no text box focused -
//    within seconds of opening an app, before anything was typed (Newsprinted's
//    automatic reports, 2026-10-31: 511 of 812, 70-112 down). iOS then hangs
//    fixed and sticky things from the bottom of that shrunken view, so they
//    float up the screen; it can last until the app is left. Reproduced in the
//    iOS 26.5 simulator (~/code/sticky-lab): keyboard up, Home, back.
//    What we do, as Newsprinted found first on the phone itself:
//      - while it lasts, slide pinned things down by the band iOS hides;
//      - once the page is still, clear it, stronger each time until one
//        works: let go of focus, focus-and-drop a hidden read-only box (what
//        cleared it on Matt's phone, in 0.8 s), grow the page a pixel for a
//        frame.
//
// `window.__screenPin` says what it has seen (for a bug report or the console).

const STUCK_MIN = 120 // smaller differences are toolbars and rounding, not the bug
const SHORT = 0.75 // a page under 3/4 of the screen is never trusted as "full"
const STATUS_BAR = 62 // with nothing remembered yet: the screen less the status bar
const STORE = 'house:screenPin:tallest'
const PINNED = '.bug-trigger, .bug-report-trigger, [data-pin-bottom]'
const STILL = 300 // the cures wait until the page hasn't scrolled for this long
const CURE_WAIT = 400 // each cure gets this long to work

const isStandalone = () => window.navigator.standalone === true ||
  window.matchMedia?.('(display-mode: standalone)').matches === true

const TEXT_TYPES = /^(text|search|url|email|tel|number|password)$/
/** A text box has the keyboard up: the page is short on purpose. Our own hidden box doesn't count. */
export function typing (el = document.activeElement) {
  if (!el || el.dataset?.screenPinCure) return false
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && TEXT_TYPES.test(el.type || 'text')
}

/**
 * How far to slide the pinned things down for a short page, given the
 * remembered tallest page (0 if none), the page's height now, the screen's
 * height, and whether we're installed. Pure, for the tests.
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

/**
 * The phantom keyboard: is iOS's visible view a keyboard short with no text
 * box focused (and not pinch-zoomed)? `band` is how much of the page lies
 * below that view's bottom: how far up iOS has hung the pinned things.
 */
export function phantomBand ({ innerHeight, vvHeight, vvTop = 0, scale = 1, typingNow = false }) {
  if (typingNow || scale > 1.01 || vvHeight == null) return 0
  if (innerHeight - vvHeight < STUCK_MIN) return 0
  const band = Math.round(innerHeight - vvTop - vvHeight)
  return band >= STUCK_MIN ? band : 0
}

let tallest = {}
let last = null
let scrolledAt = 0
let curing = false
let heldCure = null
const report = { gap: 0, stuckSeen: 0, lastStuck: null, phantom: 0, phantomSeen: 0, lastPhantom: null, lastCure: null }

function read () {
  try { tallest = JSON.parse(window.localStorage.getItem(STORE) || '{}') || {} } catch { tallest = {} }
}
function keep () {
  try { window.localStorage.setItem(STORE, JSON.stringify(tallest)) } catch { /* private mode: memory only */ }
}

function phantomNow () {
  const vv = window.visualViewport
  if (!vv || !isStandalone()) return 0
  return phantomBand({ innerHeight: window.innerHeight, vvHeight: vv.height, vvTop: vv.offsetTop || 0, scale: vv.scale || 1, typingNow: typing() })
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
  const band = phantomNow()
  if (band && !report.phantom) {
    report.phantomSeen += 1
    report.lastPhantom = { band, vv: Math.round(window.visualViewport.height), top: Math.round(window.visualViewport.offsetTop || 0), at: new Date().toISOString() }
    setTimeout(cure, 0)
  }
  report.phantom = band
  const total = gap + band
  const value = `${total}px`
  if (value !== last) { last = value; root.style.setProperty('--screen-pin-gap', value) }
  // Only things hung from the bottom move: a bug button some app pins to the
  // top (Thunder, Space Base's top-right one) sits in the top half and stays.
  for (const el of document.querySelectorAll(PINNED)) {
    const want = total && el.getBoundingClientRect().top > height / 2 ? `0 ${total}px` : ''
    if (el.style.translate !== want) el.style.translate = want
  }
}

// ----- clearing a phantom keyboard, stronger each time until one works
function letGo () {
  const el = document.activeElement
  if (el && el !== document.body) el.blur?.()
  window.scrollTo(window.scrollX, window.scrollY)
}
function hiddenBox () {
  const box = document.createElement('input')
  box.dataset.screenPinCure = '1'
  box.readOnly = true
  box.setAttribute('inputmode', 'none')
  box.setAttribute('aria-hidden', 'true')
  box.tabIndex = -1
  box.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0;pointer-events:none'
  document.body.appendChild(box)
  try { box.focus({ preventScroll: true }) } catch { box.focus() }
  box.blur()
  box.remove()
  window.scrollTo(window.scrollX, window.scrollY)
}
function regrow () {
  const root = document.documentElement
  const was = root.style.minHeight
  const y = window.scrollY
  root.style.minHeight = `${window.innerHeight + 1}px`
  window.scrollTo(window.scrollX, y + 1)
  requestAnimationFrame(() => { root.style.minHeight = was; window.scrollTo(window.scrollX, y) })
}
const CURES = [['let go', letGo], ['hidden box', hiddenBox], ['regrow', regrow]]

function cure () {
  if (curing || !phantomNow()) return
  // Never mid-scroll: the cures re-ask the scroll position, which would stop a flick dead.
  const since = Date.now() - scrolledAt
  if (since < STILL) { if (!heldCure) heldCure = setTimeout(() => { heldCure = null; cure() }, STILL - since + 20); return }
  curing = true
  const started = Date.now()
  const step = (i) => {
    if (!phantomNow()) {
      report.lastCure = { worked: i === 0 ? 'gone by itself' : CURES[i - 1][0], ms: Date.now() - started, at: new Date().toISOString() }
      curing = false; apply(); return
    }
    if (i === CURES.length) {
      report.lastCure = { worked: 'none', at: new Date().toISOString() }
      curing = false; apply(); return
    }
    CURES[i][1]()
    setTimeout(() => step(i + 1), CURE_WAIT)
  }
  step(0)
}

/** Start watching. Safe to call more than once. */
export function watchScreenPin () {
  if (typeof window === 'undefined' || window.__screenPin) return
  window.__screenPin = report // for a bug report or the console: is the page cut short, or a phantom keyboard up?
  read()
  const settle = () => { apply(); setTimeout(apply, 350) }
  apply()
  window.addEventListener('resize', apply)
  window.addEventListener('orientationchange', () => setTimeout(apply, 300))
  window.addEventListener('scroll', () => { scrolledAt = Date.now() }, { passive: true })
  window.visualViewport?.addEventListener('resize', apply)
  window.visualViewport?.addEventListener('scroll', apply)
  document.addEventListener('focusin', (e) => { if (!e.target?.dataset?.screenPinCure) apply() })
  document.addEventListener('focusout', (e) => { if (!e.target?.dataset?.screenPinCure) setTimeout(settle, 50) })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) settle() })
  window.addEventListener('pageshow', settle)
  // iOS cuts and restores the page without always firing an event, so look
  // once a second too (a few reads; nothing is written unless it changed).
  setInterval(() => { if (!document.hidden) { apply(); if (report.phantom && !curing) cure() } }, 1000)
}

watchScreenPin()
