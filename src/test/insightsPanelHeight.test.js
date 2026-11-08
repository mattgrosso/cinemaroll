// Report 2026-11-08: "Some of the panels in the insights tabs ... are much too
// tall. We should use our internal scrolling pattern to keep them all fairly
// consistently height ... scroll within that panel." Genres alone stacked a
// poster row per genre, thousands of pixels on a phone.
//
// jsdom loads no CSS, so this reads the sources: the shared .ds-scroll box
// caps its height and scrolls, and each section's REPEATING part (the v-for)
// sits inside it, parsed from the template rather than string-matched.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { parse } from '@vue/compiler-sfc'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '')

function ruleBody (css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const matches = [...stripComments(css).matchAll(new RegExp(`(?:^|[\\s,}])${escaped}\\s*\\{([^}]*)\\}`, 'g'))]
  return matches.map((m) => m[1]).join(';')
}

function classesOf (node) {
  const attr = (node.props || []).find((p) => p.type === 6 && p.name === 'class')
  return attr?.value?.content.split(/\s+/) || []
}

// The first element whose v-for expression starts with `forPrefix`, with
// whether any ancestor carries .ds-scroll.
function findLoop (node, forPrefix, scrolled = false) {
  const here = scrolled || classesOf(node).includes('ds-scroll')
  const vFor = (node.props || []).find((p) => p.type === 7 && p.name === 'for')
  if (vFor && vFor.exp?.content.trim().startsWith(forPrefix)) return { scrolled: scrolled }
  for (const child of node.children || []) {
    const found = findLoop(child, forPrefix, here)
    if (found) return found
  }
  return null
}

const MAX = '26rem'

describe('Insights panels scroll inside instead of growing', () => {
  it('the shared .ds-scroll box caps its height and scrolls', () => {
    const body = ruleBody(read('src/assets/scss/_stats-section.scss'), '.ds-scroll')
    expect(body).toMatch(new RegExp(`max-height:\\s*${MAX}`))
    expect(body).toMatch(/overflow-y:\s*auto/)
  })

  const SECTIONS = [
    ['src/components/stats/GenresSection.vue', '(genre, index)'],
    ['src/components/stats/TiesSection.vue', 'group in biggestTies'],
    ['src/components/stats/RewatchesSection.vue', 'film in rewatches.mostRewatched'],
    ['src/components/stats/RewatchesSection.vue', 'film in rewatches.longestReturns'],
    ['src/components/stats/StandoutsSection.vue', 'standout in standoutList'],
    ['src/components/stats/CrowdSection.vue', 'row in result.youLove'],
    ['src/components/stats/CrowdSection.vue', 'row in result.crowdLoves'],
    ['src/components/stats/DecadeChampionship.vue', '(competitor, index)']
  ]

  for (const [path, loop] of SECTIONS) {
    it(`${path.split('/').pop()}: "${loop}" scrolls inside the card`, () => {
      const { descriptor } = parse(read(path))
      expect(descriptor.styles.some((s) => s.content.includes("stats-section'"))).toBe(true)
      const found = findLoop(descriptor.template.ast, loop)
      expect(found).not.toBeNull()
      expect(found.scrolled).toBe(true)
    })
  }

  it('the Places lists cap at the same height', () => {
    const { descriptor } = parse(read('src/components/Insights.vue'))
    const css = descriptor.styles.map((s) => s.content).join('\n')
    const body = ruleBody(css, '.place-list')
    expect(body).toMatch(new RegExp(`max-height:\\s*${MAX}`))
    expect(body).toMatch(/overflow-y:\s*auto/)
  })
})
