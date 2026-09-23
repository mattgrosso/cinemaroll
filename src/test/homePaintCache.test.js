import { describe, it, expect, beforeEach } from 'vitest'
import { captureHomePaint, saveHomePaint, loadHomePaint, clearHomePaint } from '@/utils/homePaintCache.js'
import { placeholdersReadyToFinish } from '@/assets/javascript/reconcilePlaceholder.js'

describe('homePaintCache', () => {
  beforeEach(() => clearHomePaint('tester'))

  it('captures the search bar and grid as inert html, without ids or lazy state', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="search-bar"><input id="search"></div><div class="results"><ul><li id="m1"><img class="poster" lazy="loaded" src="/p.jpg"></li></ul></div>'
    const html = captureHomePaint(root)
    expect(html).toContain('class="search-bar"')
    expect(html).toContain('/p.jpg')
    expect(html).not.toContain('id="')
    expect(html).not.toContain('lazy=')
  })

  it('captures nothing when the grid is not on screen', () => {
    const root = document.createElement('div')
    root.innerHTML = '<div class="search-bar"></div>'
    expect(captureHomePaint(root)).toBeNull()
  })

  it('round-trips per account key', () => {
    expect(saveHomePaint('tester', '<div>x</div>')).toBe(true)
    expect(loadHomePaint('tester')).toBe('<div>x</div>')
    expect(loadHomePaint('someone-else')).toBeNull()
    clearHomePaint('tester')
    expect(loadHomePaint('tester')).toBeNull()
  })
})

// Item 1 of the 2026-09-23 ideas: a placeholder that already knows its
// movie finishes itself; one that was typed from memory still needs a pick.
describe('placeholdersReadyToFinish', () => {
  it('selects only unreconciled placeholders that carry pendingTmdbId', () => {
    const pending = [
      { id: 'a', type: 'placeholder', status: 'unreconciled', dbEntry: { path: 'movieLog/a', value: { movie: { pendingTmdbId: 550 } } } },
      { id: 'b', type: 'placeholder', status: 'unreconciled', dbEntry: { path: 'movieLog/b', value: { movie: {} } } },
      { id: 'c', type: 'placeholder', status: 'reconciled', dbEntry: { path: 'movieLog/c', value: { movie: { pendingTmdbId: 1 } } } },
      { id: 'd', type: 'write', dbEntry: { path: 'movieLog/d', value: { movie: { pendingTmdbId: 2 } } } }
    ]
    expect(placeholdersReadyToFinish(pending).map((e) => e.id)).toEqual(['a'])
    expect(placeholdersReadyToFinish(null)).toEqual([])
  })
})
