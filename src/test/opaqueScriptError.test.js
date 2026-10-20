import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { isOpaqueScriptError } from '@/services/ErrorLogService.js'

// Sentry, 2026-10-20: an iPhone sent "[ErrorLog] Unhandled Error: Script
// error." — the browser's whole account of an error in another origin's code,
// no file, no line. Sentry drops that message itself, but the global error
// handler re-said it through console.error, which CaptureConsole sends on.
// It's a warning now; a real error with a file and line stays an error.
function throwUnhandled (init) {
  window.dispatchEvent(new ErrorEvent('error', init))
}

describe('the global error handler', () => {
  let errorSpy, warnSpy
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errorSpy.mockClear()
    warnSpy.mockClear()
  })
  afterEach(() => vi.restoreAllMocks())

  const unhandled = (spy) => spy.mock.calls.filter(([msg]) => String(msg).includes('Unhandled Error'))

  it('warns, not errors, on an opaque cross-origin "Script error."', () => {
    throwUnhandled({ message: 'Script error.' })
    expect(unhandled(errorSpy)).toHaveLength(0)
    expect(unhandled(warnSpy)).toHaveLength(1)
  })

  it('stays an error for a real error with a file and line', () => {
    throwUnhandled({ message: "TypeError: x is not a function", filename: 'https://cinemaroll.org/js/core.abc.js', lineno: 12, colno: 3 })
    expect(unhandled(errorSpy)).toHaveLength(1)
    expect(unhandled(warnSpy)).toHaveLength(0)
  })

  it('only the exact opaque shape counts', () => {
    expect(isOpaqueScriptError({ message: 'Script error.', filename: '', lineno: 0 })).toBe(true)
    expect(isOpaqueScriptError({ message: 'Script error.', filename: 'https://cinemaroll.org/js/app.abc.js', lineno: 4 })).toBe(false)
    expect(isOpaqueScriptError({ message: 'Script error in my code', filename: '', lineno: 0 })).toBe(false)
  })
})
