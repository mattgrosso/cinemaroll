import { describe, it, expect } from 'vitest'
import {
  toInterchange,
  fromInterchange,
  fromMovieLog,
  detectFormat,
  profileFromFeed,
  INTERCHANGE_FORMAT
} from '@/assets/javascript/interchange.js'

const NOW = Date.UTC(2026, 7, 16)
const iso = (ms) => new Date(ms).toISOString()

function entry (id, title, rating, { watchedAt = NOW, medium = 'Theater', criteria = {}, year = 2000 } = {}) {
  return {
    dbKey: `k${id}`,
    movie: { id, title, poster_path: `/${id}.jpg`, release_date: `${year}-06-15` },
    ratings: [{ date: watchedAt, calculatedTotal: rating, medium, ...criteria }]
  }
}
const ratingOf = (e) => ({ calculatedTotal: e.ratings[e.ratings.length - 1].calculatedTotal })

// A Movie Log record, shaped exactly as its own client stores one.
function movieLogRecord (movieId, title, viewings, { year = 2014 } = {}) {
  return {
    cacheKey: `uid:${movieId}`,
    ownerUid: 'uid',
    movieId: String(movieId),
    titleLower: title.toLowerCase(),
    movie: {
      ownership: ['Bluray'],
      tags: ['Marvel'],
      title,
      year,
      tmdb: { id: movieId, poster_path: `/${movieId}.jpg`, cast: [], crew: [] },
      viewings
    }
  }
}

describe('toInterchange', () => {
  it('publishes a named, versioned payload with criteria and viewings', () => {
    const feed = toInterchange(
      [entry(568, 'Apollo 13', 9.97, { criteria: { love: 10, overall: 9, stickiness: 5, story: 9 } })],
      ratingOf,
      { name: 'Matt', now: NOW }
    )

    expect(feed.format).toBe(INTERCHANGE_FORMAT)
    expect(feed.marker).toBe(NOW)
    expect(feed.movieCount).toBe(1)

    const movie = feed.movies[0]
    expect(movie).toMatchObject({ tmdbId: 568, title: 'Apollo 13', posterPath: '/568.jpg', year: 2000, rating: 9.97 })
    // Named, not positional — a stranger can read it without our source.
    expect(movie.criteria).toEqual({ love: 10, overall: 9, stickiness: 5, story: 9 })
    expect(movie.viewings).toEqual([{ watchedAt: NOW, medium: 'Theater' }])
  })

  it('omits medium when there is none and skips unrated entries', () => {
    const feed = toInterchange(
      [
        entry(1, 'No Medium', 8, { medium: null }),
        { dbKey: 'k2', movie: { id: 2, title: 'Unrated' }, ratings: [{ date: NOW }] }
      ],
      (e) => ({ calculatedTotal: e.ratings[0].calculatedTotal }),
      { name: 'Matt', now: NOW }
    )
    expect(feed.movies.length).toBe(1)
    expect(feed.movies[0].viewings).toEqual([{ watchedAt: NOW }])
  })

  // starRating is the SOURCE-ASSIGNED star value: the normalized (library-
  // relative, curve-adjusted) rating through Cinema Roll's canonical
  // half-star conversion — never the composite score divided by two.
  describe('starRating', () => {
    const withNormalized = (normalizedRating) => (e) => ({
      calculatedTotal: e.ratings[e.ratings.length - 1].calculatedTotal,
      normalizedRating
    })

    it('publishes the assigned stars from the normalized rating, not the composite', () => {
      // Composite 6.23 would naively divide to 3.0 stars; the assigned
      // normalized rating of 7 gives 3.5 — the value the app shows.
      const feed = toInterchange([entry(123, 'Example', 6.23)], withNormalized(7), { name: 'Matt', now: NOW })
      expect(feed.movies[0].rating).toBe(6.23)
      expect(feed.movies[0].starRating).toBe(3.5)
    })

    it('snaps to the same half-star steps as every other star surface', () => {
      const starsFor = (normalized) =>
        toInterchange([entry(1, 'M', 5)], withNormalized(normalized), { now: NOW }).movies[0].starRating
      expect(starsFor(9.8)).toBe(5)     // 4.9 stars rounds up
      expect(starsFor(6.7)).toBe(3.5)   // 3.35 stars rounds up
      expect(starsFor(10)).toBe(5)
      expect(starsFor(1)).toBe(0.5)
    })

    it('omits starRating rather than sending zero when there is no usable value', () => {
      const feeds = [
        toInterchange([entry(1, 'M', 5)], ratingOf, { now: NOW }),                       // no normalizedRating at all
        toInterchange([entry(1, 'M', 5)], withNormalized(0), { now: NOW }),              // zero
        toInterchange([entry(1, 'M', 5)], withNormalized('junk'), { now: NOW }),         // non-numeric
        toInterchange([entry(1, 'M', 5)], withNormalized(0.9), { now: NOW })             // below half a star
      ]
      feeds.forEach((feed) => {
        expect(feed.movies[0].rating).toBe(5)                       // composite still published
        expect('starRating' in feed.movies[0]).toBe(false)
      })
    })

    it('leaves every existing field of the payload unchanged', () => {
      const criteria = { love: 10, overall: 9, stickiness: 5, story: 9 }
      const plain = toInterchange([entry(568, 'Apollo 13', 9.97, { criteria })], ratingOf, { name: 'Matt', now: NOW })
      const starred = toInterchange([entry(568, 'Apollo 13', 9.97, { criteria })], withNormalized(9), { name: 'Matt', now: NOW })
      const { starRating, ...rest } = starred.movies[0]
      expect(starRating).toBe(4.5)
      expect(rest).toEqual(plain.movies[0])
      // The body changed (a star rating appeared), so the revision moved too.
      expect(starred.revision).not.toBe(plain.revision)
      expect({ ...starred, movies: null, revision: null }).toEqual({ ...plain, movies: null, revision: null })
    })

    it('round trip: a feed carrying starRating still consumes cleanly', () => {
      const feed = toInterchange([entry(568, 'Apollo 13', 9.97)], withNormalized(9), { name: 'Matt', now: NOW })
      const profile = fromInterchange(feed)
      expect(profile.ratings[568].r).toBe(9.97)
    })
  })
})

describe('round trip', () => {
  it('publishing then consuming preserves scores, criteria and viewings', () => {
    const feed = toInterchange(
      [entry(568, 'Apollo 13', 9.97, { criteria: { love: 10, overall: 9, stickiness: 5, story: 9, direction: 9, imagery: 8, performance: 7, soundtrack: 6 } })],
      ratingOf,
      { name: 'Matt', now: NOW }
    )
    const profile = fromInterchange(feed)

    expect(profile.name).toBe('Matt')
    expect(profile.counts.titles).toBe(1)
    expect(profile.ratings[568].r).toBe(9.97)
    expect(profile.ratings[568].v).toEqual([{ at: NOW, m: 'Theater' }])
    // Criteria land in the positional order Film Club's comparison expects.
    expect(profile.ratings[568].c).toEqual([10, 9, 5, 9, 9, 8, 7, 6])
    expect(profile.topShelf[0].t).toBe('Apollo 13')
  })
})

describe('fromMovieLog', () => {
  const records = [
    movieLogRecord(100402, 'Captain America: The Winter Soldier', [
      { date: iso(NOW - 500000), direction: 8, imagery: 7, impression: 1, love: 2, medium: 'Theater', overall: 7, performance: 6, rating: 6.7, soundtrack: 7, story: 8 },
      { date: iso(NOW), direction: 8, imagery: 7, impression: 3, love: 4, medium: 'Bluray', overall: 8, performance: 6, rating: 7.4, soundtrack: 7, story: 8 }
    ]),
    movieLogRecord(603, 'The Matrix', [
      { date: iso(NOW - 900000), direction: 9, imagery: 10, impression: 5, love: 9, medium: 'Theater', overall: 9, performance: 8, rating: 9.1, soundtrack: 8, story: 9 }
    ])
  ]

  it('reads Movie Log records untouched, using the LATEST viewing for the score', () => {
    const profile = fromMovieLog(records, { name: 'Brian' })

    expect(profile.name).toBe('Brian')
    expect(profile.source).toBe('movielog')
    expect(profile.counts.titles).toBe(2)
    expect(profile.ratings[100402].r).toBe(7.4)          // the rewatch, not the 2014 first view
    expect(profile.ratings[100402].t).toBe('Captain America: The Winter Soldier')
    expect(profile.ratings[100402].p).toBe('/100402.jpg')
  })

  it('maps impression -> stickiness, the one field whose name differs', () => {
    const profile = fromMovieLog(records, { name: 'Brian' })
    // Order: love, overall, stickiness, story, direction, imagery, performance, soundtrack
    expect(profile.ratings[100402].c).toEqual([4, 8, 3, 8, 8, 7, 6, 7])
    expect(profile.ratings[603].c[2]).toBe(5)            // Matrix impression 5
  })

  it('keeps every viewing with its medium, newest first', () => {
    const profile = fromMovieLog(records, { name: 'Brian' })
    expect(profile.ratings[100402].v).toEqual([
      { at: NOW, m: 'Bluray' },
      { at: NOW - 500000, m: 'Theater' }
    ])
  })

  it('accepts the records as an object map as well as an array', () => {
    const asMap = { a: records[0], b: records[1] }
    expect(fromMovieLog(asMap, { name: 'Brian' }).counts.titles).toBe(2)
  })

  it('skips records with no usable rating rather than inventing one', () => {
    const broken = [movieLogRecord(1, 'No Viewings', []), movieLogRecord(2, 'Fine', [{ date: iso(NOW), rating: 8 }])]
    const profile = fromMovieLog(broken, { name: 'Brian' })
    expect(profile.counts.titles).toBe(1)
    expect(profile.ratings[2].r).toBe(8)
  })
})

describe('detectFormat / profileFromFeed', () => {
  it('recognises our own payload and Movie Log records', () => {
    const ours = toInterchange([entry(1, 'A', 8)], ratingOf, { name: 'Matt', now: NOW })
    const theirs = [movieLogRecord(2, 'B', [{ date: iso(NOW), rating: 7 }])]

    expect(detectFormat(ours)).toBe('interchange')
    expect(detectFormat(theirs)).toBe('movielog')
    expect(detectFormat({ nonsense: true })).toBeNull()
    expect(detectFormat(null)).toBeNull()
  })

  it('profileFromFeed handles either without the caller caring', () => {
    const ours = toInterchange([entry(1, 'A', 8)], ratingOf, { name: 'Matt', now: NOW })
    const theirs = [movieLogRecord(2, 'B', [{ date: iso(NOW), rating: 7 }])]

    expect(profileFromFeed(ours).ratings[1].r).toBe(8)
    expect(profileFromFeed(theirs, { fallbackName: 'Brian' }).ratings[2].r).toBe(7)
    expect(profileFromFeed({ junk: 1 })).toBeNull()
  })

  it('falls back to the name we stored when a feed carries none', () => {
    const nameless = { format: INTERCHANGE_FORMAT, movies: [{ tmdbId: 5, title: 'X', rating: 6 }] }
    expect(profileFromFeed(nameless, { fallbackName: 'Brian' }).name).toBe('Brian')
  })
})

describe('golden fixture: a real Movie Log record', () => {
  // Captured verbatim from Movie Log's own client cache (test account,
  // uid scrubbed) on 2026-08-16, so this test fails if Brian's shape ever
  // drifts from what the adapter was written against.
  it('adapts real data with no hand-holding', async () => {
    const records = (await import('./fixtures/movieLogRecords.json')).default
    const profile = fromMovieLog(records, { name: 'Brian' })
    const movie = profile.ratings[100402]

    expect(profile.counts.titles).toBe(1)
    expect(movie.t).toBe('Captain America: The Winter Soldier')
    expect(movie.p).toBe('/l79VoTIPEXwo9zCTPTnpqdASvus.jpg')
    expect(movie.r).toBe(6.696499999999999)

    // Both viewings survive, newest first, each with where it was watched.
    expect(movie.v).toEqual([
      { at: Date.parse('2019-08-17T07:00:00.000Z'), m: 'Bluray' },
      { at: Date.parse('2014-04-25T07:00:00.000Z'), m: 'Theater' }
    ])

    // love, overall, stickiness(impression), story, direction, imagery,
    // performance, soundtrack
    expect(movie.c).toEqual([2, 7, 1, 8, 8, 7, 6, 7])
  })
})

describe('cross-app connect', () => {
  const DB = 'https://db.example.com'

  it('an invite carries both a feed to subscribe to and an inbox to ask through', async () => {
    const { buildInvite } = await import('@/assets/javascript/interchange.js')
    const invite = buildInvite({
      accountKey: 'matt-example-com',
      inviteCode: 'abc123',
      feedUrl: `${DB}/clubFeed/matt-example-com/secret.json`,
      name: 'Matt',
      databaseUrl: DB
    })
    expect(invite.app).toBe('cinemaroll')
    expect(invite.inboxUrl).toBe(`${DB}/clubInbox/matt-example-com/abc123.json`)
    expect(buildInvite({ accountKey: 'x' })).toBeNull()
  })

  it('parses an invite from JSON, and accepts a bare feed URL as a one-way invite', async () => {
    const { parseInvite } = await import('@/assets/javascript/interchange.js')
    const json = JSON.stringify({ name: 'Brian', app: 'movielog', feedUrl: `${DB}/f.json`, inboxUrl: `${DB}/i.json` })

    expect(parseInvite(json)).toEqual({ name: 'Brian', app: 'movielog', feedUrl: `${DB}/f.json`, inboxUrl: `${DB}/i.json` })
    expect(parseInvite(`${DB}/just-a-feed.json`)).toEqual({ feedUrl: `${DB}/just-a-feed.json` })
    expect(parseInvite('not a url or json')).toBeNull()
    expect(parseInvite('')).toBeNull()
  })

  it('normalizes inbox requests and refuses anything untrustworthy', async () => {
    const { normalizeInboxRequests } = await import('@/assets/javascript/interchange.js')
    const now = Date.UTC(2026, 7, 16)
    const raw = {
      good: { name: 'Brian', app: 'movielog', feedUrl: 'https://ok.example/f.json', at: now - 1000, replyInboxUrl: 'https://ok.example/i.json' },
      insecure: { name: 'Bad', app: 'x', feedUrl: 'http://plain.example/f.json', at: now },
      notAUrl: { name: 'Bad', app: 'x', feedUrl: 'javascript:alert(1)', at: now },
      ancient: { name: 'Old', app: 'x', feedUrl: 'https://ok.example/old.json', at: now - 400 * 86400000 },
      badReply: { name: 'Odd', app: 'x', feedUrl: 'https://ok.example/f2.json', at: now, replyInboxUrl: 'http://insecure' }
    }
    const rows = normalizeInboxRequests(raw, { now })

    // Newest first (badReply is 1s newer), and the junk is gone.
    expect(rows.map((r) => r.id)).toEqual(['badReply', 'good'])
    expect(rows[1].replyInboxUrl).toBe('https://ok.example/i.json')
    expect(rows[0].replyInboxUrl).toBeNull()                       // insecure reply URL ignored
  })

  it('builds a request another app can post with one call', async () => {
    const { buildConnectRequest } = await import('@/assets/javascript/interchange.js')
    const request = buildConnectRequest({ name: 'Matt', feedUrl: 'https://ok.example/f.json', replyInboxUrl: 'https://ok.example/i.json', now: 5 })
    expect(request).toEqual({ name: 'Matt', app: 'cinemaroll', feedUrl: 'https://ok.example/f.json', at: 5, replyInboxUrl: 'https://ok.example/i.json' })
    expect(buildConnectRequest({ name: 'Matt' })).toBeNull()
  })
})

describe('cross-app directory', () => {
  it('an entry carries how to find and knock, but never a feed URL', async () => {
    const { buildDirectoryEntry } = await import('@/assets/javascript/interchange.js')
    const entry = buildDirectoryEntry({ handle: 'mattg', name: 'Matt Grosso', inboxUrl: 'https://db/clubInbox/matt/code.json' })

    expect(entry).toEqual({ handle: 'mattg', name: 'Matt Grosso', app: 'cinemaroll', inboxUrl: 'https://db/clubInbox/matt/code.json' })
    expect(JSON.stringify(entry)).not.toContain('clubFeed')   // capability never published
    expect(buildDirectoryEntry({ handle: 'x', name: 'y' })).toBeNull()
  })

  it('normalizes another app\'s directory and drops anything unusable', async () => {
    const { normalizeDirectory } = await import('@/assets/javascript/interchange.js')
    const payload = {
      bgoegan: { handle: 'bgoegan', name: 'Brian Goegan', inboxUrl: 'https://ml/inbox/brian.json', avatarUrl: 'https://ml/a.png' },
      keyOnly: { name: 'Handle From Key', inboxUrl: 'https://ml/inbox/k.json' },
      insecure: { handle: 'bad', name: 'Bad', inboxUrl: 'http://ml/inbox/bad.json' },
      noInbox: { handle: 'none', name: 'No Inbox' },
      dupe: { handle: 'bgoegan', name: 'Impostor', inboxUrl: 'https://ml/inbox/fake.json' }
    }
    const rows = normalizeDirectory(payload, { app: 'movielog' })

    expect(rows.map((r) => r.handle)).toEqual(['bgoegan', 'keyOnly'])   // sorted by name
    expect(rows[0].app).toBe('movielog')
    expect(rows[0].avatarUrl).toBe('https://ml/a.png')
    expect(rows[1].handle).toBe('keyOnly')                              // handle falls back to the key
  })

  it('rejects a non-https avatar without dropping the person', async () => {
    const { normalizeDirectory } = await import('@/assets/javascript/interchange.js')
    const rows = normalizeDirectory([{ handle: 'a', name: 'A', inboxUrl: 'https://ml/i.json', avatarUrl: 'http://x/a.png' }])
    expect(rows.length).toBe(1)
    expect(rows[0].avatarUrl).toBeNull()
  })

  it('hides people you already have or already asked', async () => {
    const { filterDirectory } = await import('@/assets/javascript/interchange.js')
    const entries = [
      { handle: 'a', name: 'Alice', inboxUrl: 'https://ml/a.json' },
      { handle: 'b', name: 'Bob', inboxUrl: 'https://ml/b.json' },
      { handle: 'c', name: 'Carol', inboxUrl: 'https://ml/c.json' }
    ]
    expect(filterDirectory(entries, { excludeInboxUrls: ['https://ml/a.json'] }).map((e) => e.handle)).toEqual(['b', 'c'])
    expect(filterDirectory(entries, { excludeHandles: ['b'] }).map((e) => e.handle)).toEqual(['a', 'c'])
    expect(filterDirectory(entries, { search: 'car' }).map((e) => e.handle)).toEqual(['c'])
    expect(filterDirectory(entries, { search: 'A' }).map((e) => e.handle)).toEqual(['a', 'c'])  // Alice + Carol
  })
})

// "What ratings does Movie Log send us? Do they have normalized ratings of some
// sort (star ratings maybe?) Let's use those for Movie Log" (2026-08-25).
//
// They do: Brian's live feed carries a starRating on all 2,980 films, in half
// steps. We were parsing the composite and dropping the stars on the floor.
describe('incoming feeds — stars', () => {
  const feed = (movie) => ({
    format: 'film-club/1',
    name: 'Brian Goegan',
    source: 'movielog',
    movies: [{ tmdbId: 1368337, title: 'The Odyssey', rating: 6.779875, ...movie }]
  })

  it('keeps the sender’s own star rating', () => {
    const profile = fromInterchange(feed({ starRating: 4.5 }))
    expect(profile.ratings[1368337].s).toBe(4.5)
    expect(profile.ratings[1368337].r).toBe(6.779875)
  })

  it('never invents stars from the composite when the sender sent none', () => {
    // Stars present the normalized, library-relative, curve-adjusted score.
    // We hold neither their library nor their curve, so rescaling `rating`
    // would be a guess wearing the costume of their opinion.
    const profile = fromInterchange(feed({}))
    expect(profile.ratings[1368337].r).toBe(6.779875)
    expect(profile.ratings[1368337].s).toBeUndefined()
  })

  it('survives a nonsense star value', () => {
    const profile = fromInterchange(feed({ starRating: 'excellent' }))
    expect(profile.ratings[1368337].s).toBeUndefined()
  })

  it('round-trips our own feed back to the same stars', () => {
    const entries = [{
      movie: { id: 42, title: 'Heat', poster_path: '/h.jpg' },
      ratings: [{ date: '2026-06-15', calculatedTotal: 8.7 }]
    }]
    const ours = toInterchange(entries, () => ({ calculatedTotal: 8.7, normalizedRating: 9 }), { name: 'Matt' })
    expect(ours.movies[0].starRating).toBe(4.5)
    expect(fromInterchange(ours).ratings[42].s).toBe(4.5)
  })
})
