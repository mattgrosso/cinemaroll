// House module: one anonymous usage ping per open, so Bug Desk's Visitors
// tab can say how much each app is used and where people came from.
//
// What is sent: the app's slug, the page path, the referrer, a random id
// kept in this browser so returning visitors can be told from new ones,
// whether this open is the first on this browser, and whether the app runs
// installed (Home Screen). Nothing else: no cookie, no account, and the
// server keeps no IP. Skipped on localhost. `?nousage` skips one load.
//
// Usage, in main.js:   trackUsage('my-app')
// Sends on load, and again when an installed app comes back to the
// foreground after half an hour away (an installed PWA rarely reloads).

const HIT_URL = 'https://iskrp7nh3uwcg3674e2qlvaqai0wasju.lambda-url.us-east-1.on.aws/api/hit'
const ID_KEY = 'usage-id'
const AWAY_MS = 30 * 60 * 1000

const deviceId = () => {
  try {
    const have = localStorage.getItem(ID_KEY)
    if (have) return { id: have, first: false }
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('')
    localStorage.setItem(ID_KEY, id)
    return { id, first: true }
  } catch {
    return { id: null, first: false }
  }
}

const installed = () => {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true
  } catch {
    return false
  }
}

const skip = () => {
  const h = location.hostname
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.local') || /[?&]nousage\b/.test(location.search)
}

const send = (app, { first = false } = {}) => {
  const { id } = deviceId()
  let self = false
  try {
    self = Boolean(document.referrer) && new URL(document.referrer).origin === location.origin
  } catch {
    // An odd referrer: count it as given.
  }
  const body = JSON.stringify({ app, path: location.pathname, ref: self ? '' : document.referrer, self, id, first, installed: installed() })
  try {
    if (navigator.sendBeacon?.(HIT_URL, new Blob([body], { type: 'text/plain' }))) return
  } catch {
    // Fall through to fetch.
  }
  fetch(HIT_URL, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {})
}

let currentApp = ''

export function trackUsage(app) {
  if (!app || skip()) return
  currentApp = app
  const { first } = deviceId()
  send(app, { first })
  let hiddenAt = 0
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') hiddenAt = Date.now()
    else if (hiddenAt && Date.now() - hiddenAt > AWAY_MS) send(app)
  })
}

// An action this app finds interesting ('date-started', 'recipe-cooked'):
// a plain counter per day in the Visitors tab. Lowercase letters, digits
// and dashes. Nothing about who; just that it happened.
export function trackEvent(name) {
  if (!currentApp || !/^[a-z0-9-]{1,40}$/.test(name || '')) return
  const body = JSON.stringify({ app: currentApp, event: name })
  try {
    if (navigator.sendBeacon?.(HIT_URL, new Blob([body], { type: 'text/plain' }))) return
  } catch {
    // Fall through to fetch.
  }
  fetch(HIT_URL, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {})
}
