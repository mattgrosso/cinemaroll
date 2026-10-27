import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import PersonalAwardsModal from '@/components/PersonalAwardsModal.vue'

// Report, 2026-10-27, on the Insights Awards tab: "there's just way too much
// content before I even get to the awards". Under the Insights tabs, the
// ceremony strip and the year strip, the page still opened with a big
// "The 2006 Groskers" / "Your own annual awards" heading that said what the
// strips already said. On the tab (page mode) it's gone; Home's pop-up, which
// has no strips, keeps it.

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(() => ({ calculatedTotal: 7 })),
  getAllRatings: vi.fn(() => [])
}))
vi.mock('@/services/ErrorLogService.js', () => ({ default: { error: vi.fn() } }))

const library = Array.from({ length: 10 }, (_, i) => ({
  movie: { id: `2006-${i}`, title: `Film ${i}`, release_date: '2006-06-15', poster_path: `/${i}.jpg`, crew: [], cast: [], flatKeywords: [] },
  ratings: [{ calculatedTotal: 7, date: 1700000000000 }]
}))

const MODAL_STUB = {
  name: 'Modal',
  template: '<div class="modal-stub"><slot name="header"/><slot name="body"/></div>'
}

function factory (pageMode) {
  const store = reactive({
    state: { settings: { personalAwards: {}, personalAwardName: 'Grosker' }, settingsLoaded: true, databaseTopKey: 'mattgrosso-gmail-com', weights: [] },
    dispatch: vi.fn(),
    commit: vi.fn()
  })
  return mount(PersonalAwardsModal, {
    props: {
      allEntriesWithFlatKeywordsAdded: library,
      awardNameWithThe: 'the Groskers',
      autoOpen: true,
      pageMode,
      selectedYear: 2006
    },
    global: { mocks: { $store: store }, stubs: { Modal: MODAL_STUB, Teleport: true } }
  })
}

describe('the awards heading', () => {
  it('is gone on the Awards tab, where the strips above already name the ceremony and year', () => {
    const wrapper = factory(true)
    expect(wrapper.find('.awards-header').exists()).toBe(true)
    expect(wrapper.find('.awards-header h2').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Your own annual awards')
  })

  it('stays on Home\'s pop-up, which has no strips', async () => {
    const wrapper = factory(false)
    wrapper.vm.showModal = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.awards-header h2').text()).toBe('the 2006 Groskers')
    expect(wrapper.text()).toContain('Your own annual awards')
  })
})

// The Insights tabs were two rows of three; one row of six gives the row
// back on every tab. jsdom loads no CSS, so the stylesheet is read directly.
describe('Insights tab row', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/components/Insights.vue'), 'utf8')
  const tabsRule = src.slice(src.indexOf('  .insights-tabs {'))

  it('is one row of six on phones, two rows of three only below 370px', () => {
    expect(tabsRule).toMatch(/^\s*\.insights-tabs \{[^}]*?grid-template-columns:\s*repeat\(6,/)
    expect(tabsRule).toMatch(/@media screen and \(max-width: 369px\)\s*\{[^}]*grid-template-columns:\s*repeat\(3,/)
  })

  it('keeps every tab a 40px touch target', () => {
    expect(tabsRule).toMatch(/\.insights-tab \{[^}]*min-height:\s*40px/)
  })
})
