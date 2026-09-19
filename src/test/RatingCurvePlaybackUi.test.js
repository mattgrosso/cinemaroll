import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'

// The real module reaches into the Vuex store; the component only ever asks
// it for "every rating on this entry, each with a calculatedTotal".
vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn(),
  getAllRatings: vi.fn((entry) => entry.ratings)
}))

const RatingCurvePlayback = (await import('@/components/RatingCurvePlayback.vue')).default

// Report -P1mlsyZlwk2RTeYxOit (2026-09-18): "I want to hit play and see an
// animation of all of my ratings in the order I rated them being added to the
// graph, eventually arriving at my current curve."
//
// (Named ...Ui to stay clear of ratingCurvePlayback.test.js — this filesystem
// is case-insensitive and the two would be the same file.)
describe('RatingCurvePlayback', () => {
  const staticData = {
    labels: ['7', '9'],
    datasets: [{ data: [1, 1], backgroundColor: '#1D8BF1', borderColor: '#1D8BF1', tension: 0.5 }]
  }
  const options = { plugins: { legend: { display: false } } }
  const entries = [
    { ratings: [{ date: '2019-01-01', calculatedTotal: 4 }, { date: '2021-01-01', calculatedTotal: 7 }] },
    { ratings: [{ date: '2020-01-01', calculatedTotal: 9 }] }
  ]

  let wrapper

  const mountIt = (props = {}) => mount(RatingCurvePlayback, {
    props: { chartData: staticData, options, entries, ...props },
    global: { stubs: { LineChart: true } }
  })

  beforeEach(() => {
    vi.useFakeTimers()
    wrapper = mountIt()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('shows the static chart untouched until play is pressed', () => {
    expect(wrapper.vm.displayData).toStrictEqual(staticData)
    expect(wrapper.vm.displayOptions).toStrictEqual(options)
    expect(wrapper.text()).toContain('Watch it build')
  })

  it('builds nothing until asked — the work is real and may never be wanted', () => {
    expect(wrapper.vm.frames).toEqual([])
  })

  it('ends on the static curve, film for film', async () => {
    await wrapper.find('button').trigger('click')
    await vi.runAllTimersAsync()

    const played = wrapper.vm.displayData
    // Same two films, one apiece at 7 and 9 — the re-rated film is NOT also
    // still sitting at 4.
    expect(played.datasets[0].data.reduce((sum, n) => sum + n, 0)).toBe(2)
    const at = (label) => played.datasets[0].data[played.labels.indexOf(label)]
    expect(at('7')).toBe(1)
    expect(at('9')).toBe(1)
    expect(at('4')).toBe(0)
  })

  it('offers a replay once it finishes, and starts over rather than sitting still', async () => {
    await wrapper.find('button').trigger('click')
    await vi.runAllTimersAsync()
    expect(wrapper.vm.finished).toBe(true)
    expect(wrapper.text()).toContain('Watch it again')

    await wrapper.find('button').trigger('click')
    expect(wrapper.vm.index).toBe(-1)
    expect(wrapper.vm.playing).toBe(true)
  })

  it('pins the y axis while playing, so the bars grow instead of the axis shrinking', async () => {
    await wrapper.find('button').trigger('click')
    await vi.runAllTimersAsync()
    expect(wrapper.vm.displayOptions.scales.y.max).toBe(wrapper.vm.peak)
    expect(wrapper.vm.displayOptions.scales.y.beginAtZero).toBe(true)
  })

  it('stops its timer when it goes away', async () => {
    await wrapper.find('button').trigger('click')
    expect(wrapper.vm.timer).not.toBe(null)
    wrapper.unmount()
    expect(wrapper.vm.timer).toBe(null)
  })

  it('offers no deck at all for a library with no curve to build', () => {
    const empty = mountIt({ entries: [] })
    expect(empty.find('button').exists()).toBe(false)
    expect(empty.vm.displayData).toStrictEqual(staticData)
    empty.unmount()

    const one = mountIt({ entries: [entries[0]] })
    expect(one.find('button').exists()).toBe(false)
    one.unmount()
  })
})
