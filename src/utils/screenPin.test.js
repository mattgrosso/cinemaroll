import { describe, it, expect } from 'vitest'
import { gapFor, looksWhole, typing } from './screenPin'

describe('screenPin', () => {
  it('slides down by however much iOS cut the page', () => {
    // iPhone 16 Pro: the full installed page is 812 of an 874 screen; the keyboard bug leaves 556.
    expect(gapFor({ tallest: 812, height: 556, screenHeight: 874 })).toBe(256)
  })
  it('ignores small differences and the browser', () => {
    expect(gapFor({ tallest: 812, height: 760, screenHeight: 874 })).toBe(0)
    expect(gapFor({ tallest: 812, height: 556, screenHeight: 874, standalone: false })).toBe(0)
  })
  it('with nothing remembered, a page cut short is measured against the screen', () => {
    expect(gapFor({ tallest: 0, height: 443, screenHeight: 874 })).toBe(874 - 62 - 443)
    expect(gapFor({ tallest: 0, height: 812, screenHeight: 874 })).toBe(0)
  })
  it('never remembers a cut page as the full height', () => {
    expect(looksWhole({ height: 443, screenHeight: 874 })).toBe(false)
    expect(looksWhole({ height: 812, screenHeight: 874 })).toBe(true)
  })
  it('knows when a text box has the keyboard', () => {
    expect(typing({ tagName: 'TEXTAREA' })).toBe(true)
    expect(typing({ tagName: 'INPUT', type: 'checkbox' })).toBe(false)
    expect(typing(null)).toBe(false)
  })
})
