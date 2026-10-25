import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import RatingSelect from '@/components/RatingSelect.vue'

const OPTIONS = [
  { value: '0', label: '0 - Worst in class' },
  { value: '1', label: '1 - Among the worst in class' },
  { value: '2', label: '2 - Terrible' }
]

function factory (props = {}) {
  return mount(RatingSelect, {
    props: { label: 'Direction', name: 'direction', description: 'Desc here', options: OPTIONS, ...props }
  })
}

describe('RatingSelect', () => {
  it('renders the label, description, and links the label to the select via name/id', () => {
    const wrapper = factory()
    expect(wrapper.find('label').text()).toBe('Direction')
    expect(wrapper.find('label').attributes('for')).toBe('direction')
    expect(wrapper.find('p').text()).toBe('Desc here')
    const select = wrapper.find('select')
    expect(select.attributes('id')).toBe('direction')
    expect(select.attributes('name')).toBe('direction')
  })

  it('renders a leading empty option followed by the passed options', () => {
    const options = factory().findAll('option')
    expect(options.map((o) => o.element.value)).toEqual(['', '0', '1', '2'])
    expect(options.map((o) => o.text())).toEqual(['', ...OPTIONS.map((o) => o.label)])
  })

  it('reflects modelValue as the selected option', async () => {
    const wrapper = factory({ modelValue: '2' })
    expect(wrapper.find('select').element.value).toBe('2')
  })

  it('emits update:modelValue with the chosen string value on change', async () => {
    const wrapper = factory()
    await wrapper.find('select').setValue('1')
    expect(wrapper.emitted('update:modelValue')).toBeTruthy()
    expect(wrapper.emitted('update:modelValue')[0]).toEqual(['1'])
  })

  it('shows the empty option when modelValue is null', () => {
    const wrapper = factory({ modelValue: null })
    expect(wrapper.find('select').element.value).toBe('')
  })

  // Bug report 2026-10-25: on a re-rate, show what you gave this criterion
  // last time — but only when asked, never by default.
  describe('the "Last time" reveal', () => {
    const previous = { value: 7, when: 'Mar 2024' }

    it('has no button on a first rating', () => {
      expect(factory().find('.rating-card-previous').exists()).toBe(false)
    })

    it('hides the old number until tapped, then shows it with its date', async () => {
      const wrapper = factory({ previous })
      const button = wrapper.find('.rating-card-previous')
      expect(button.exists()).toBe(true)
      expect(button.text()).toBe('Last time')
      expect(button.text()).not.toContain('7')

      await button.trigger('click')
      expect(wrapper.find('.rating-card-previous').text()).toBe('Last time (Mar 2024): 7')
      expect(wrapper.find('.rating-card-previous').attributes('aria-pressed')).toBe('true')
    })

    it('hides it again on a second tap', async () => {
      const wrapper = factory({ previous })
      await wrapper.find('.rating-card-previous').trigger('click')
      await wrapper.find('.rating-card-previous').trigger('click')
      expect(wrapper.find('.rating-card-previous').text()).toBe('Last time')
    })

    it('shows 0 as 0, and a dash when that viewing skipped the criterion', async () => {
      const zero = factory({ previous: { value: 0, when: null } })
      await zero.find('.rating-card-previous').trigger('click')
      expect(zero.find('.rating-card-previous').text()).toBe('Last time: 0')

      const missing = factory({ previous: { value: null, when: 'Mar 2024' } })
      await missing.find('.rating-card-previous').trigger('click')
      expect(missing.find('.rating-card-previous').text()).toBe('Last time (Mar 2024): –')
    })
  })
})
