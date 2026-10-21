import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

// Sentry, 2026-10-21: "cinemaroll-push is about to time out", a week after
// every request got its own deadline. On a slow Firebase morning the sweep's
// one-after-another reads ran past the limit on most runs, logging nothing.
const require = createRequire(import.meta.url)
const { mapLimit, rotate, requestDeadline, createSweepClock } = require('../../aws-lambda/sweepClock.js')

const fakeTime = (start = 1000) => {
  let t = start
  return { now: () => t, advance: (ms) => { t += ms } }
}

describe('mapLimit', () => {
  it('never runs more than the limit at once, and keeps input order', async () => {
    let running = 0
    let peak = 0
    const out = await mapLimit([5, 1, 4, 2, 3, 6, 7], 3, async (n) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, n))
      running -= 1
      return n * 10
    })
    expect(peak).toBe(3)
    expect(out).toEqual([50, 10, 40, 20, 30, 60, 70])
  })

  it('works in parallel, not one after another', async () => {
    const started = Date.now()
    await mapLimit([1, 2, 3, 4], 4, () => new Promise((resolve) => setTimeout(resolve, 40)))
    expect(Date.now() - started).toBeLessThan(120)
  })

  it('handles an empty list', async () => {
    expect(await mapLimit([], 4, async () => 1)).toEqual([])
  })
})

describe('rotate', () => {
  it('starts at a different place each turn and keeps everyone', () => {
    expect(rotate(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c'])
    expect(rotate(['a', 'b', 'c'], 1)).toEqual(['b', 'c', 'a'])
    expect(rotate(['a', 'b', 'c'], 5)).toEqual(['c', 'a', 'b'])
    expect(rotate([], 3)).toEqual([])
  })
})

describe('requestDeadline', () => {
  it('cuts a request to end before the invocation does', () => {
    expect(requestDeadline(15000, 10000, 0)).toBe(8000)
    expect(requestDeadline(15000, 60000, 0)).toBe(15000)
  })

  it('leaves a floor, and the full deadline when the end is unknown', () => {
    expect(requestDeadline(15000, 1000, 0)).toBe(1000)
    expect(requestDeadline(15000, null, 0)).toBe(15000)
  })
})

describe('createSweepClock', () => {
  it('times each stage, logging as it ends', async () => {
    const time = fakeTime()
    const lines = []
    const clock = createSweepClock({ deadlineAt: time.now() + 120000, now: time.now, log: (l) => lines.push(l) })
    await clock.stage('listings', async () => { time.advance(8200) })
    expect(lines).toEqual(['Sweep stage listings: 8.2s'])
    expect(clock.summary()).toBe('Sweep took 8.2s (listings 8.2s)')
  })

  it('logs a stage that throws, and rethrows', async () => {
    const time = fakeTime()
    const lines = []
    const clock = createSweepClock({ now: time.now, log: (l) => lines.push(l) })
    await expect(clock.stage('accounts', async () => { time.advance(15000); throw new Error('500') })).rejects.toThrow('500')
    expect(lines).toEqual(['Sweep stage accounts: 15.0s'])
  })

  it('starts nothing once the reserve is reached, and says what waited', async () => {
    const time = fakeTime()
    const clock = createSweepClock({ deadlineAt: time.now() + 30000, reserveMs: 10000, now: time.now, log: () => {} })
    await clock.stage('signups', async () => { time.advance(21000) })
    expect(clock.outOfTime()).toBe(true)
    let ran = false
    await clock.stage('day-feeds', async () => { ran = true })
    expect(ran).toBe(false)
    clock.skip('chores', 3)
    expect(clock.summary()).toBe('Sweep took 21.0s (signups 21.0s); out of time, left for next sweep: day-feeds x1, chores x3')
  })

  it('never runs out of time with no deadline known', () => {
    const clock = createSweepClock({ log: () => {} })
    expect(clock.outOfTime()).toBe(false)
  })
})
