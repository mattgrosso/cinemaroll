import { describe, it, expect } from 'vitest'
import router from '@/router/index.js'

// 2026-10-25: Awards became a tab of Insights. Every old link — a movie's
// award rows, Home's "a year is ready" card — still says /awards, and must
// land on that tab with its year and ceremony intact.
describe('/awards redirects to the Insights Awards tab', () => {
  const redirectFor = (path) => router.resolve(path).matched[0].redirect

  it('keeps the year and ceremony', () => {
    const to = router.resolve('/awards?year=1997&ceremony=oscars')
    expect(redirectFor('/awards')(to)).toEqual({ path: '/insights', query: { year: '1997', ceremony: 'oscars', tab: 'awards' } })
  })

  it('a bare /awards opens the tab', () => {
    expect(redirectFor('/awards')(router.resolve('/awards'))).toEqual({ path: '/insights', query: { tab: 'awards' } })
  })

  it('Trophy Case backs out to the Awards tab', () => {
    expect(router.resolve('/trophy-case').meta.parent).toBe('/insights?tab=awards')
  })
})
