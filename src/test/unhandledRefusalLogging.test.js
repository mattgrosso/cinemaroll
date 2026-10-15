import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import errorLogService, { isRefusedWithNoSignIn } from '@/services/ErrorLogService.js'

// Sentry, 2026-10-15: on an expired sign-in, a database read with no catch of
// its own rejected unhandled ("Error: Permission denied") and the global
// handler filed it as an error. With nobody signed in that's the lapsed
// session the app already signs out of: a warning. Signed in, still an error.
function rejectUnhandled (reason) {
  const event = new Event('unhandledrejection')
  event.reason = reason
  window.dispatchEvent(event)
}

describe('the global unhandled-rejection handler', () => {
  let signedIn, errorSpy, warnSpy
  beforeEach(() => {
    signedIn = false
    errorLogService.setSignedInCheck(() => signedIn)
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy.mockClear()
    warnSpy.mockClear()
  })
  afterEach(() => {
    errorLogService.setSignedInCheck(null)
    vi.restoreAllMocks()
  })

  const rejections = (spy) => spy.mock.calls.filter(([msg]) => String(msg).includes('Unhandled Promise Rejection'))

  it('warns on a refused read when nobody is signed in', () => {
    rejectUnhandled(new Error('Permission denied'))
    expect(rejections(errorSpy)).toHaveLength(0)
    expect(rejections(warnSpy)).toHaveLength(1)
  })

  it('stays an error for a refused read while someone is signed in', () => {
    signedIn = true
    rejectUnhandled(new Error('Permission denied'))
    expect(rejections(errorSpy)).toHaveLength(1)
  })

  it('stays an error for anything that is not a refusal', () => {
    rejectUnhandled(new Error('Cannot read properties of undefined'))
    expect(rejections(errorSpy)).toHaveLength(1)
  })

  it('matches both spellings Firebase uses, and nothing before the store says who is signed in', () => {
    const out = () => false
    expect(isRefusedWithNoSignIn(new Error('permission_denied at /x: nope'), out)).toBe(true)
    expect(isRefusedWithNoSignIn('Permission denied', out)).toBe(true)
    expect(isRefusedWithNoSignIn(new Error('Permission denied'), null)).toBe(false)
  })
})
