import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { resolve } from 'path'

// public/keep-previous-app-sw.js runs inside the service worker, pulled in
// by importScripts. Bug report (Matt, 2026-09-30, one bar of signal): when
// a new version took over, the old version's screen files were deleted from
// the phone, so a page still running the old version fetched them from a
// network that never answered, and the loading bar sat there. The worker now
// copies the outgoing version's files aside while the new one installs.
const root = (path) => resolve(process.cwd(), path)
const source = readFileSync(root('public/keep-previous-app-sw.js'), 'utf8')

function loadWorkerScript () {
  const listeners = {}
  const self = { addEventListener: (type, fn) => { listeners[type] = fn } }
  new Function('self', 'caches', source)(self, undefined)
  return { self, listeners }
}

// A tiny in-memory CacheStorage: enough of the real API for this script.
function fakeCaches (initial = {}) {
  const stores = new Map()
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const map = stores.get(name)
    const url = (req) => new URL(typeof req === 'string' ? req : req.url, 'https://www.cinemaroll.org').href
    return {
      keys: async () => [...map.keys()].map((u) => ({ url: u })),
      match: async (req) => map.get(url(req)),
      put: async (req, res) => { map.set(url(req), res) },
      delete: async (req) => map.delete(url(req))
    }
  }
  for (const [name, urls] of Object.entries(initial)) {
    stores.set(name, new Map(urls.map((u) => [`https://www.cinemaroll.org${u}`, `body of ${u}`])))
  }
  return { keys: async () => [...stores.keys()], open, stores }
}

const previousPaths = (cs) => [...(cs.stores.get('cinema-roll-previous-app') || new Map()).keys()].map((u) => new URL(u).pathname).sort()

describe('keep-previous-app-sw.js', () => {
  it('copies the outgoing version\'s screen files aside when a new worker installs', async () => {
    const { self } = loadWorkerScript()
    const cs = fakeCaches({
      'cinema-roll-precache-v2-https://www.cinemaroll.org/': [
        '/js/Home.1a2b3c4d.js', '/css/Home.5e6f7a8b.css', '/fonts/lobster-normal-latin.0a1b2c3d.woff2',
        '/index.html?__WB_REVISION__=abc', '/img/banner.9f8e7d6c.png', '/manifest.json?__WB_REVISION__=1'
      ],
      'tmdb-images': ['/t/p/w342/poster.jpg']
    })
    expect(await self.keepPreviousAppFiles(cs)).toBe(3)
    expect(previousPaths(cs)).toEqual(['/css/Home.5e6f7a8b.css', '/fonts/lobster-normal-latin.0a1b2c3d.woff2', '/js/Home.1a2b3c4d.js'])
    const kept = await (await cs.open('cinema-roll-previous-app')).match('/js/Home.1a2b3c4d.js')
    expect(kept).toBe('body of /js/Home.1a2b3c4d.js')
  })

  it('keeps exactly one version back, so it never grows', async () => {
    const { self } = loadWorkerScript()
    const cs = fakeCaches({
      'cinema-roll-precache-v2-https://www.cinemaroll.org/': ['/js/Home.bbbbbbbb.js'],
      'cinema-roll-previous-app': ['/js/Home.aaaaaaaa.js']
    })
    await self.keepPreviousAppFiles(cs)
    expect(previousPaths(cs)).toEqual(['/js/Home.bbbbbbbb.js'])
  })

  it('does nothing on a first install, with no precache yet', async () => {
    const { self } = loadWorkerScript()
    const cs = fakeCaches({})
    expect(await self.keepPreviousAppFiles(cs)).toBe(0)
    expect(cs.stores.has('cinema-roll-previous-app')).toBe(false)
  })

  it('runs during install, and a failure never fails the install', async () => {
    const { listeners } = loadWorkerScript()
    let waited = null
    listeners.install({ waitUntil: (p) => { waited = p } })
    // `caches` is undefined in this harness, so the copy throws inside -
    // the promise handed to waitUntil must still resolve.
    await expect(waited).resolves.toBeUndefined()
  })

  it('is imported into the worker, and the worker routes old files to its cache', () => {
    const config = readFileSync(root('vite.config.mjs'), 'utf8')
    expect(config).toMatch(/importScripts:\s*\[[^\]]*'keep-previous-app-sw\.js'/)
    expect(config).toMatch(/cacheName:\s*'cinema-roll-previous-app'/)
    // The route and the script must agree on what an app file is.
    const scriptPattern = source.match(/HASHED_APP_FILE = (\/.*\/);/)[1]
    expect(config).toContain(`urlPattern: ${scriptPattern},`)
  })
})

// Same bug report: the page's first paint was blocked on a stylesheet from
// Google Fonts. The fonts are bundled now; nothing in <head> may wait on
// another host.
describe('web fonts', () => {
  it('index.html links no stylesheet from another host', () => {
    const html = readFileSync(root('index.html'), 'utf8')
    expect(html).not.toMatch(/<link[^>]+rel="stylesheet"[^>]+href="https?:/)
    expect(html).not.toMatch(/<link[^>]+href="https?:[^"]+"[^>]+rel="stylesheet"/)
    expect(html).not.toMatch(/fonts\.googleapis\.com\/css/)
  })

  it('bundles every face the app uses, with its files present', () => {
    const main = readFileSync(root('src/main.js'), 'utf8')
    expect(main).toContain('import "./assets/scss/fonts.css"')
    const css = readFileSync(root('src/assets/scss/fonts.css'), 'utf8')
    for (const family of ['Roboto Condensed', 'Lobster', 'Limelight']) {
      expect(css).toContain(`font-family: '${family}'`)
    }
    const files = [...css.matchAll(/url\('\.\.\/fonts\/([^']+)'\)/g)].map((m) => m[1])
    expect(files.length).toBeGreaterThan(0)
    for (const file of files) expect(existsSync(root(`src/assets/fonts/${file}`))).toBe(true)
  })
})
