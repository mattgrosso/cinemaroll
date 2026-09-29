import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Only runs its register(...) call when NODE_ENV === 'production' - stub
// that so the module actually exercises its real logic here, and mock
// register-service-worker itself so we can capture the config object it's
// called with and invoke `updated()` directly, exactly like the real
// library would once a new service worker activates.
let capturedConfig
const registerMock = vi.fn((swUrl, config) => { capturedConfig = config })
vi.mock('register-service-worker', () => ({
  register: (...args) => registerMock(...args)
}))

vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

const commitMock = vi.fn()
vi.mock('@/store/index', () => ({
  default: { commit: (...args) => commitMock(...args) }
}))

describe('registerServiceWorker - updated hook', () => {
  let originalNodeEnv

  beforeEach(async () => {
    vi.resetModules()
    registerMock.mockClear()
    commitMock.mockClear()
    capturedConfig = undefined
    originalNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    await import('@/registerServiceWorker.js')
  })

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv
  })

  it('registers the service worker', () => {
    expect(registerMock).toHaveBeenCalledTimes(1)
    expect(capturedConfig).toBeDefined()
  })

  it('flags updateAvailable instead of forcing a reload (bug fix: this used to call window.location.reload() unconditionally, yanking the page out from under whatever the user was doing - e.g. mid-run of the box office backfill button)', () => {
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    delete window.location
    window.location = { ...originalLocation, reload: reloadSpy }

    capturedConfig.updated({ waiting: null })

    expect(reloadSpy).not.toHaveBeenCalled()

    window.location = originalLocation
  })

  // Bug report (Matt, 2026-09-29): "I'm stuck in the new app refresh loop."
  // A worker parked in `waiting` fires updated() on every launch, even when
  // the page already runs the live deploy - so it must only ask for the
  // bundle comparison, never flag an update by itself.
  it('a waiting worker asks for a bundle check instead of flagging an update', () => {
    const postMessage = vi.fn()
    capturedConfig.updated({ waiting: { postMessage } })

    expect(commitMock).toHaveBeenCalledWith('requestUpdateCheck')
    expect(commitMock).not.toHaveBeenCalledWith('setUpdateAvailable', true)
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
  })

  it('survives being called without a registration', () => {
    expect(() => capturedConfig.updated()).not.toThrow()
    expect(commitMock).toHaveBeenCalledWith('requestUpdateCheck')
  })
})
