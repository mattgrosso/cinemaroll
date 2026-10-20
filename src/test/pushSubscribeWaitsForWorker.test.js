import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// "Subscribing for push requires an active service worker" (Matt,
// 2026-10-20): right after re-adding Cinema Roll to the Home Screen, the
// worker was registered but still installing, and the Turn on button asked
// iOS to subscribe anyway. subscribeThisDevice must wait for it to go active.
vi.mock('axios')
vi.mock('firebase/auth', () => ({ getAuth: vi.fn() }))

import { subscribeThisDevice } from '@/utils/push.js'

function setup ({ activateAfterMs }) {
  const subscribe = vi.fn(async () => {
    if (!registration.active) throw new Error('Subscribing for push requires an active service worker')
    return { toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'k', auth: 'a' } }) }
  })
  const registration = { active: null, installing: {}, pushManager: { subscribe } }
  let resolveReady
  const ready = new Promise((resolve) => { resolveReady = resolve })
  if (activateAfterMs != null) {
    setTimeout(() => { registration.active = {}; registration.installing = null; resolveReady(registration) }, activateAfterMs)
  }
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { getRegistration: vi.fn(async () => registration), ready }
  })
  return { registration, subscribe }
}

describe('subscribeThisDevice with a worker still installing', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubEnv('VUE_APP_VAPID_PUBLIC_KEY', 'AAAA')
    window.PushManager = function () {}
    window.Notification = { permission: 'granted', requestPermission: vi.fn(async () => 'granted') }
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
  })

  it('waits for the worker to activate, says so, then subscribes', async () => {
    const { subscribe } = setup({ activateAfterMs: 5000 })
    const store = { dispatch: vi.fn() }
    const onWaiting = vi.fn()
    const result = subscribeThisDevice(store, { onWaiting })
    await vi.advanceTimersByTimeAsync(5000)
    const record = await result
    expect(onWaiting).toHaveBeenCalledTimes(1)
    expect(subscribe).toHaveBeenCalledTimes(1)
    expect(store.dispatch).toHaveBeenCalledWith('savePushSubscription', expect.objectContaining({ id: record.id }))
  })

  it('gives up with a plain message when the worker never activates', async () => {
    const { subscribe } = setup({ activateAfterMs: null })
    const result = subscribeThisDevice({ dispatch: vi.fn() }, { timeoutMs: 30000 })
    const assertion = expect(result).rejects.toThrow('Cinema Roll is still setting up on this device. Try again in a minute.')
    await vi.advanceTimersByTimeAsync(30000)
    await assertion
    expect(subscribe).not.toHaveBeenCalled()
  })
})
