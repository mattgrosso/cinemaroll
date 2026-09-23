import { describe, it, expect } from 'vitest'
import { shallowMount } from '@vue/test-utils'
import OfflineBanner from '@/components/OfflineBanner.vue'

function factory (isOnline, networkStalled = false) {
  return shallowMount(OfflineBanner, {
    global: {
      mocks: {
        $store: { state: { isOnline, networkStalled } }
      }
    }
  })
}

// Bug report: "we should have some sort of indication on the screen to show
// that people [are] in an off-line mode."
describe('OfflineBanner', () => {
  it('renders nothing while online', () => {
    expect(factory(true).find('.offline-banner').exists()).toBe(false)
  })

  it('shows the offline notice, including that changes still save and sync later', () => {
    const wrapper = factory(false)

    expect(wrapper.find('.offline-banner').exists()).toBe(true)
    expect(wrapper.text()).toContain('offline')
    expect(wrapper.text()).toContain('sync')
  })

  // Lie-fi (2026-09-23): the phone shows full bars and nothing answers.
  // "You're offline" reads as wrong next to a signal icon, so the banner
  // says what is actually happening.
  it('says the connection is not answering when the stall detector tripped', () => {
    const wrapper = factory(false, true)

    expect(wrapper.find('.offline-banner').exists()).toBe(true)
    expect(wrapper.text()).toMatch(/isn't answering/)
    expect(wrapper.text()).not.toMatch(/You're offline/)
    expect(wrapper.text()).toContain('sync')
  })
})
