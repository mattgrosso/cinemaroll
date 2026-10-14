import { describe, it, expect, vi, afterEach } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'

// Bug report (Matt, 2026-10-14): "stuck seeing the Cinema Roll is updating
// banner, but nothing seems to be happening." The reload was asked for and
// iOS ignored it; the card sat on "Updating…" with its button disabled for
// good. A page still here after the stall window gets its Refresh back.
vi.mock('@/utils/appUpdate.js', async (importOriginal) => ({
  ...(await importOriginal()),
  reloadForUpdate: vi.fn(async () => 'reloaded')
}))
const { default: UpdateAvailableBanner } = await import('@/components/UpdateAvailableBanner.vue')
const { RELOAD_STALL_MS } = await import('@/utils/appUpdate.js')

describe('UpdateAvailableBanner when the reload never happens', () => {
  afterEach(() => { vi.useRealTimers() })

  it('gives the Refresh button back instead of saying Updating forever', async () => {
    vi.useFakeTimers()
    const wrapper = shallowMount(UpdateAvailableBanner, {
      global: { mocks: { $store: { state: { updateAvailable: true, updateTargetBundle: 'js/app.new.js' } } } }
    })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Updating')

    await vi.advanceTimersByTimeAsync(RELOAD_STALL_MS + 1000)
    expect(wrapper.text()).not.toContain('Updating')
    expect(wrapper.find('button').text()).toBe('Refresh')
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
  })
})
