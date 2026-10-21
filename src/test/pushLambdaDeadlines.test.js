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
      const body = source.slice(source.indexOf(`const ${name} = `)).split(/\n\}\)?;/)[0]
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

  // 2026-10-21: one 500 reading the Miracle's seen-state, one timed-out save,
  // one timed-out sign-up check - three Sentry issues, each gone by the next
  // sweep. Firebase calls get one retry, and what's left is a warning.
  it('retries every Firebase call once when Firebase itself stumbles', () => {
    for (const name of ['dbGet', 'dbPatch', 'dbSet']) {
      expect(source, name).toMatch(new RegExp(`const ${name} = \\([^)]*\\) => dbCall\\(async`))
    }
    expect(source).toContain('retryTransient(attempt, { canRetry: dbRetryAllowed')
  })

  it('logs contained sweep failures through logFailure, so Firebase trouble stays a warning', () => {
    const sweep = source.slice(source.indexOf('const runSweep = async'), source.indexOf('// --- Handler'))
    const bare = sweep.split('\n').filter((line) => /console\.error\(.*error\.message/.test(line))
    expect(bare).toEqual([])
    expect(source).toMatch(/if \(error && error\.transient\) \{\n\s+dbTroubleThisSweep\.push\(message\);\n\s+console\.warn/)
    expect(sweep).toContain('dbTroubleThisSweep = [];')
    expect(sweep).toContain('await noteDbTrouble(now);')
  })

  // A seen-state save lost after its news was pushed means the same push
  // next sweep, so that one stays an error however transient the cause.
  it('keeps a lost listings save an error when its news already went out', () => {
    expect(source).toMatch(/if \(keep\.length && delivered\) logFailure\([^\n]*next sweep repeats them:`, new Error\(error\.message\)\);\n\s+else logFailure\(`Listings \(\$\{topKey\}\/\$\{theater\.key\}\) record failed:`, error\);/)
  })
})
