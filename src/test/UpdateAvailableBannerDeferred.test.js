import { describe, it, expect, vi } from 'vitest'
import { shallowMount, flushPromises } from '@vue/test-utils'

// Bug report (Matt, 2026-09-30, one bar of signal): when the connection
// can't carry the new version, reloadForUpdate keeps the working app
// ('deferred'). The card must say so and offer another try, not sit on
// "Updating…" forever.
vi.mock('@/utils/appUpdate.js', () => ({ reloadForUpdate: vi.fn(async () => 'deferred') }))
const { default: UpdateAvailableBanner } = await import('@/components/UpdateAvailableBanner.vue')

describe('UpdateAvailableBanner on a weak connection', () => {
  it('says the update is waiting and offers to try again', async () => {
    const wrapper = shallowMount(UpdateAvailableBanner, {
      global: { mocks: { $store: { state: { updateAvailable: true, updateTargetBundle: 'js/app.new.js' } } } }
    })
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('waiting for a better connection')
    expect(wrapper.find('button').text()).toBe('Try again')
    expect(wrapper.find('button').attributes('disabled')).toBeUndefined()
  })
})
