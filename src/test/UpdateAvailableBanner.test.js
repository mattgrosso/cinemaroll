import { describe, it, expect, vi, beforeEach } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import UpdateAvailableBanner from '@/components/UpdateAvailableBanner.vue'

function factory (updateAvailable, extraState = {}) {
  return shallowMount(UpdateAvailableBanner, {
    global: {
      mocks: {
        $store: { state: { updateAvailable, ...extraState } }
      }
    }
  })
}

describe('UpdateAvailableBanner', () => {
  // reloadForUpdate remembers each attempt (even with no known target) in
  // localStorage; a previous test's click must not make this one a repeat.
  beforeEach(() => { window.localStorage.clear() })

  it('renders nothing when no update is available', () => {
    const wrapper = factory(false)

    expect(wrapper.find('.update-available-banner').exists()).toBe(false)
  })

  it('shows a prompt (not an automatic reload) once an update is available', () => {
    const wrapper = factory(true)

    expect(wrapper.find('.update-available-banner').exists()).toBe(true)
    expect(wrapper.text()).toContain('new version')
    expect(wrapper.find('button').text()).toContain('Refresh')
  })

  // Bug report (Matt, 2026-09-30): "should I push it? Should I not push
  // it?" While the app is updating itself there's nothing to press.
  it('says Updating, with no Refresh to press, while the app updates itself', async () => {
    const wrapper = factory(true, { updateApplying: true })

    expect(wrapper.text()).toContain('Updating')
    expect(wrapper.find('button').text()).not.toContain('Refresh')
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
  })

  it('only reloads when the user explicitly taps Refresh - never on its own', async () => {
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    delete window.location
    window.location = { ...originalLocation, reload: reloadSpy }

    const wrapper = factory(true)
    expect(reloadSpy).not.toHaveBeenCalled()

    await wrapper.find('button').trigger('click')
    // The reload is now async (it waits out any in-flight worker install
    // first); with no serviceWorker in jsdom it resolves in microtasks.
    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1))

    window.location = originalLocation
  })

  it('waits for an in-flight service worker install before reloading', async () => {
    // Bug: tapping Refresh the instant the banner appeared reloaded into the
    // OLD app served by the OLD worker; the new worker then activated, purged
    // the old precache, and every not-yet-loaded route chunk 404'd (blank
    // screen on non-home pages). The button must wait until no install is in
    // flight so the reload lands on the NEW app.
    const reloadSpy = vi.fn()
    const originalLocation = window.location
    delete window.location
    window.location = { ...originalLocation, reload: reloadSpy }

    const registration = {
      installing: {}, // a worker is mid-install
      waiting: null,
      update: vi.fn().mockResolvedValue()
    }
    Object.defineProperty(window.navigator, 'serviceWorker', {
      configurable: true,
      value: { getRegistration: vi.fn().mockResolvedValue(registration) }
    })

    const wrapper = factory(true)
    await wrapper.find('button').trigger('click')

    // Install still in flight: no reload yet, button shows the waiting state.
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(reloadSpy).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('Updating')

    // Install finishes -> the pending poll notices and reloads.
    registration.installing = null
    await vi.waitFor(() => expect(reloadSpy).toHaveBeenCalledTimes(1))

    delete window.navigator.serviceWorker
    window.location = originalLocation
  })
})
