import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  parseRss,
  friendReviewsFromItems,
  friendReviewsFromNode,
  friendLetterboxdTargets,
  nestReviews
} from '../../aws-lambda/letterboxdSync.js'
import { syncFriends } from '../../aws-lambda/letterboxd.js'

// Friends' written Letterboxd reviews (2026-11-17): the sweep reads each
// friend's public feed and keeps the reviews with words in the READER's own
// account, so the database rules stay as they are.
const rss = readFileSync(join(__dirname, 'fixtures/letterboxd-rss.xml'), 'utf8')

describe('friendReviewsFromItems', () => {
  it('keeps only entries with words, without stars or publish time', () => {
    const items = parseRss(rss)
    const out = friendReviewsFromItems(items)
    const withWords = items.filter((i) => i.review)
    expect(Object.keys(out)).toHaveLength(withWords.length)
    expect(withWords.length).toBeLessThan(items.length)
    for (const value of Object.values(out)) {
      expect(value.review).toBeTruthy()
      expect(value).not.toHaveProperty('rating')
      expect(value).not.toHaveProperty('publishedAt')
    }
    const first = withWords[0]
    expect(out[`${first.tmdbId}/${first.reviewId}`]).toMatchObject({ review: first.review, url: first.url })
  })
})

describe('friendReviewsFromNode', () => {
  it('flattens a synced node, words only', () => {
    expect(friendReviewsFromNode({
      42: { 'review-1': { review: 'Yes.', rating: 4, watchedDate: '2026-01-01', source: 'csv' }, 'watch-2': { rating: 3 } },
      sync: { lastAt: 1 }
    })).toEqual({ '42/review-1': { review: 'Yes.', watchedDate: '2026-01-01' } })
  })
})

describe('friendLetterboxdTargets', () => {
  it('uses a typed name over their own, their own otherwise, and typed only for other-app friends', () => {
    expect(friendLetterboxdTargets({
      mutualKeys: ['ben', 'ada', 'cy'],
      externalIds: ['brian', 'dee'],
      typed: { ada: 'https://letterboxd.com/AdaTyped/', brian: '@brianlog', gone: 'someone' },
      ownUsernames: { ben: 'BenOwn', ada: 'adaown' }
    })).toEqual([
      { friendKey: 'ben', username: 'benown', source: 'account' },
      { friendKey: 'ada', username: 'adatyped', source: 'typed' },
      { friendKey: 'brian', username: 'brianlog', source: 'typed' }
    ])
  })
})

describe('nestReviews', () => {
  it('turns flat paths into a node', () => {
    expect(nestReviews({ '1/a': { review: 'x' }, '1/b': { review: 'y' } })).toEqual({ 1: { a: { review: 'x' }, b: { review: 'y' } } })
  })
})

// A tiny RTDB: nested object, REST-style get (shallow=true gives keys), set, patch.
const fakeDb = (initial) => {
  const root = JSON.parse(JSON.stringify(initial))
  const walk = (path, create) => {
    const parts = path.split('/').filter(Boolean)
    let node = root
    for (let i = 0; i < parts.length - 1; i += 1) {
      if (node[parts[i]] == null) { if (!create) return [null, null]; node[parts[i]] = {} }
      node = node[parts[i]]
    }
    return [node, parts[parts.length - 1]]
  }
  const read = (path) => { const [parent, key] = walk(path); return parent ? (parent[key] ?? null) : null }
  const write = (path, value) => {
    const [parent, key] = walk(path, true)
    if (value === null) delete parent[key]; else parent[key] = JSON.parse(JSON.stringify(value))
  }
  return {
    root,
    get: vi.fn(async (path, query) => {
      const value = read(path)
      if (query === 'shallow=true' && value && typeof value === 'object') return Object.fromEntries(Object.keys(value).map((k) => [k, true]))
      return value
    }),
    set: vi.fn(async (path, value) => write(path, value)),
    patch: vi.fn(async (path, update) => { for (const [k, v] of Object.entries(update)) write(`${path}/${k}`, v) })
  }
}

describe('syncFriends', () => {
  afterEach(() => vi.unstubAllGlobals())

  const world = () => ({
    social: { friends: { matt: { ben: true, ada: true, stranger: true }, ben: { matt: true }, ada: { matt: 'day' } } },
    matt: {
      settings: { friendLetterboxd: { brian: 'brianlog' }, externalFriends: { brian: { name: 'Brian' } } },
      letterboxd: { friends: { oldfriend: { username: 'x', reviews: {} } } }
    },
    ben: {
      settings: { letterboxdUsername: 'benown' },
      letterboxd: { reviews: { 99: { 'csv-1': { review: 'An old one.', watchedDate: '2019-03-03', source: 'csv' } } } }
    },
    ada: { settings: {} }
  })

  it('writes friends\' reviews into the reader\'s own branch, history once, and drops old friends', async () => {
    const fetchMock = vi.fn(async (url) => ({ ok: true, status: 200, url, text: async () => rss }))
    vi.stubGlobal('fetch', fetchMock)
    const db = fakeDb(world())
    const feeds = new Map([['benown', { items: parseRss(rss) }]])
    const now = 1_800_000_000_000

    const result = await syncFriends({ topKey: 'matt', db, now, feeds })
    expect(result).toMatchObject({ friends: 2, synced: 2, failed: 0 })

    const mine = db.root.matt.letterboxd.friends
    expect(Object.keys(mine).sort()).toEqual(['ben', 'brian'])
    // Ben connected his own account: his synced history (the CSV one) comes too.
    expect(mine.ben).toMatchObject({ username: 'benown', source: 'account', syncedAt: now })
    expect(mine.ben.reviews[99]['csv-1'].review).toBe('An old one.')
    // Brian's typed name: his feed, fetched once (Ben's came from the sweep's cache).
    expect(mine.brian).toMatchObject({ username: 'brianlog', source: 'typed' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('https://letterboxd.com/brianlog/rss/')
    // Only the reader's own branch is written.
    for (const call of [...db.set.mock.calls, ...db.patch.mock.calls]) expect(call[0].startsWith('matt/letterboxd/friends')).toBe(true)
    // Not a friend back (stranger) -> nothing, and no settings read of theirs.
    expect(db.get.mock.calls.some(([path]) => path.startsWith('stranger/'))).toBe(false)

    // Second run, same names: a patch, the history read is not repeated.
    db.get.mockClear()
    await syncFriends({ topKey: 'matt', db, now: now + 1, feeds })
    expect(db.get.mock.calls.some(([path]) => path === 'ben/letterboxd/reviews')).toBe(false)
    expect(db.root.matt.letterboxd.friends.ben.reviews[99]['csv-1']).toBeTruthy()
    expect(db.root.matt.letterboxd.friends.ben.syncedAt).toBe(now + 1)
  }, 10000)

  it('records a missing member as an error on that friend', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url) => ({ ok: false, status: 404, url, text: async () => '' })))
    const db = fakeDb({ matt: { settings: { friendLetterboxd: { brian: 'nobodyhere' }, externalFriends: { brian: {} } } } })
    const result = await syncFriends({ topKey: 'matt', db, now: 5 })
    expect(result.failed).toBe(1)
    expect(db.root.matt.letterboxd.friends.brian).toMatchObject({ username: 'nobodyhere', error: 'No Letterboxd member called nobodyhere' })
  }, 10000)
})
