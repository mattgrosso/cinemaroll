import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { hasMovieToRate, rateMovieRedirect } from '@/router/rateMovieGuard.js'

// Sentry, 2026-10-09: a reload on /rate-movie left movieToRate as the store's
// empty {}, the screen opened blank, and /keywords answered 400 for no title.
describe('Rate screen route guard', () => {
  it('sends a reload with no film in memory back Home', () => {
    expect(rateMovieRedirect({ loggedIn: true, movieToRate: {} })).toBe('/')
    expect(rateMovieRedirect({ loggedIn: true, movieToRate: null })).toBe('/')
    expect(rateMovieRedirect({ loggedIn: true, movieToRate: { id: 1, title: '  ' } })).toBe('/')
  })

  it('lets a chosen film through, offline placeholders included', () => {
    expect(rateMovieRedirect({ loggedIn: true, movieToRate: { id: 555, title: 'Jaws' } })).toBeNull()
    expect(hasMovieToRate({ id: 'placeholder-1', title: 'Some film', release_date: null })).toBe(true)
  })

  it('still sends a signed-out visitor to sign in first', () => {
    expect(rateMovieRedirect({ loggedIn: false, movieToRate: {} })).toBe('/login')
  })

  it('is the guard the /rate-movie route actually uses', () => {
    const router = readFileSync(resolve(process.cwd(), 'src/router/index.js'), 'utf8')
    expect(router).toMatch(/path: '\/rate-movie',[\s\S]*?rateMovieRedirect\(\{ loggedIn: loggedIn\(\), movieToRate: store\.state\.movieToRate \}\)/)
  })
})
