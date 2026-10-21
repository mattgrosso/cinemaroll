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
    expect(bare).toEqual(['  fetch(url, { ...options, signal: options.signal || AbortSignal.timeout(requestDeadline(ms, invocationDeadlineAt, Date.now())) });'])
  })

  it('gives the Firebase helpers the longer deadline', () => {
    for (const name of ['getDbToken', 'dbGet', 'dbPatch', 'dbSet']) {
      const body = source.slice(source.indexOf(`const ${name} = async`)).split('\n};')[0]
      expect(body, name).toContain('DB_TIMEOUT_MS)')
    }
  })

  it('bounds each web push send', () => {
    expect(source).toMatch(/webpush\.sendNotification\([^;]*timeout: requestDeadline\(FETCH_TIMEOUT_MS, invocationDeadlineAt/)
  })

  // 2026-10-21: the same Sentry issue, back. Slow Firebase reads one after
  // another ran the sweep past the limit, with no line saying where.
  it('records when the invocation ends, and the sweep runs on that clock', () => {
    expect(source).toMatch(/exports\.handler = async \(event, context\) => \{\n\s+const remaining = context\?\.getRemainingTimeInMillis/)
    expect(source).toContain('await runSweep(createSweepClock({ deadlineAt: invocationDeadlineAt }))')
  })

  it('times every sweep stage and works accounts a few at a time, stopping when out of time', () => {
    const sweep = source.slice(source.indexOf('const runSweep = async'), source.indexOf('// One account\'s chores'))
    for (const name of ['accounts', 'signups', 'listings', 'reminders', 'day-profiles', 'day-feeds', 'chores']) {
      expect(sweep, name).toContain(`clock.stage('${name}'`)
    }
    expect(sweep).not.toMatch(/for \(const /)
    expect(sweep.match(/mapLimit\(/g)).toHaveLength(2)
    expect(sweep.match(/if \(clock\.outOfTime\(\)\) return clock\.skip/g)).toHaveLength(2)
    expect(sweep).toContain('console.log(clock.summary())')
  })
})
