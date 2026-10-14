import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// Sentry, 2026-10-14: "cinemaroll-push is about to time out". fetch has no
// deadline of its own, so one stalled theater page or Firebase call held the
// 15-minute sweep until Lambda killed it. Every request now goes through
// timedFetch; a bare fetch( anywhere else brings the hang back.
const source = readFileSync(resolve(__dirname, '../../aws-lambda/push-notify.js'), 'utf8')

describe('push Lambda request deadlines', () => {
  it('sends every request through timedFetch, which carries an abort signal', () => {
    const bare = source.split('\n').filter((line) => /(?<![\w.])fetch\(/.test(line))
    expect(bare).toEqual(['  fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(ms) });'])
  })

  it('gives the Firebase helpers the longer deadline', () => {
    for (const name of ['getDbToken', 'dbGet', 'dbPatch', 'dbSet']) {
      const body = source.slice(source.indexOf(`const ${name} = async`)).split('\n};')[0]
      expect(body, name).toContain('DB_TIMEOUT_MS)')
    }
  })

  it('bounds each web push send', () => {
    expect(source).toMatch(/webpush\.sendNotification\([^;]*timeout: FETCH_TIMEOUT_MS/)
  })
})
