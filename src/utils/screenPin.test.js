import { describe, it, expect } from 'vitest'
import { gapFor, looksWhole, typing, phantomBand, slideFor, heldHeight, fixedWindow } from './screenPin'

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
  it('a phantom keyboard: the view a keyboard short with nothing focused', () => {
    // Matt's phone, 2026-10-31: the page 812, the view 511, pushed 70 down.
    expect(phantomBand({ innerHeight: 812, vvHeight: 511, vvTop: 70 })).toBe(231)
    expect(phantomBand({ innerHeight: 812, vvHeight: 511, vvTop: 0 })).toBe(301)
  })
  it('no phantom while typing, zoomed in, or only a little short', () => {
    expect(phantomBand({ innerHeight: 812, vvHeight: 511, typingNow: true })).toBe(0)
    expect(phantomBand({ innerHeight: 812, vvHeight: 511, scale: 2 })).toBe(0)
    expect(phantomBand({ innerHeight: 812, vvHeight: 760 })).toBe(0)
    expect(phantomBand({ innerHeight: 812, vvHeight: 812, vvTop: 46 })).toBe(0) // pushed alone is a scroll bounce
  })
  it('our own hidden box is never taken for typing', () => {
    expect(typing({ tagName: 'INPUT', type: 'text', dataset: { screenPinCure: '1' } })).toBe(false)
  })
  it('slides a thing WebKit hung from the shrunken view, and only that', () => {
    // The phantom: page 812, view 511 pushed 70 down; the button's bottom drawn at the view's bottom.
    expect(slideFor({ bottom: 567, band: 231, vvTop: 70, vvHeight: 511 })).toBe(231)
    // Already slid: measured where it is now, judged by where it would be unslid.
    expect(slideFor({ bottom: 798, slid: 231, band: 231, vvTop: 70, vvHeight: 511 })).toBe(231)
    // The button at the page's true bottom (798 of 812): sliding it would push it off the screen.
    expect(slideFor({ bottom: 798, band: 231, vvTop: 70, vvHeight: 511 })).toBe(0)
    // A short page's gap always applies.
    expect(slideFor({ bottom: 542, gap: 256 })).toBe(256)
  })
  it('measures a page on its side against the screen on its side', () => {
    // iOS says 820 x 1180 for an iPad Air however it is held.
    expect(heldHeight({ screenWidth: 820, screenHeight: 1180, landscape: true })).toBe(820)
    expect(heldHeight({ screenWidth: 820, screenHeight: 1180, landscape: false })).toBe(1180)
    // An iPhone on its side: 402 of a "874" screen is the whole page, not a cut one.
    const held = heldHeight({ screenWidth: 402, screenHeight: 874, landscape: true })
    expect(looksWhole({ height: 381, screenHeight: held })).toBe(true)
    expect(gapFor({ tallest: 0, height: 381, screenHeight: held })).toBe(0)
    // What it used to do (Nba Tonight's tab bar, 2026-11-11): 298px off the bottom of an iPad.
    expect(gapFor({ tallest: 0, height: 820, screenHeight: 1180 })).toBe(298)
    expect(heldHeight({ screenHeight: 874 })).toBe(874)
  })
  it('the short-page fix is for phones: an iPad window can be any size', () => {
    expect(fixedWindow({ screenWidth: 402, screenHeight: 874 })).toBe(true)
    expect(fixedWindow({ screenWidth: 744, screenHeight: 1133 })).toBe(false) // iPad mini, the smallest
    expect(fixedWindow({ screenWidth: 1024, screenHeight: 1366 })).toBe(false)
    expect(fixedWindow({})).toBe(true)
  })
})
