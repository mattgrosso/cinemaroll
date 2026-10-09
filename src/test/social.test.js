import { describe, it, expect } from 'vitest'
import { buildSocialProfile, compareWithFriend, filmClubSummary, socialSettingsWithDefaults, publishDue, countNewFriendUpdates, friendsLoveUnseen , friendRatingsFor ,
  friendSnapshot,
  myRatingsById,
  clubFetchesNeeded
} from '@/assets/javascript/social.js'

const NOW = Date.UTC(2026, 7, 15)

function entry (id, title, rating, { at = NOW - id * 1000, year = 2000, criteria = {}, medium = null, extraViewings = [] } = {}) {
  return {
    dbKey: `k${id}`,
    movie: { id, title, poster_path: `/${id}.jpg`, release_date: `${year}-06-15` },
    ratings: [
      ...extraViewings,
      { date: at, calculatedTotal: rating, direction: 9, ...(medium ? { medium } : {}), ...criteria }
    ]
  }
}
const ratingOf = (e) => ({ calculatedTotal: e.ratings[0].calculatedTotal })

describe('publishDue', () => {
  const hour = 60 * 60 * 1000
  it('republishes every six hours, and at once when the display name changed', () => {
    const now = 100 * hour
    expect(publishDue({ lastPublish: now - 2 * hour, lastName: 'Matt Grosso', name: 'Matt Grosso', now })).toBe(false)
    expect(publishDue({ lastPublish: now - 7 * hour, lastName: 'Matt Grosso', name: 'Matt Grosso', now })).toBe(true)
    // 2026-10-09: the feed kept saying "mattgrosso" after the profile said "Matt Grosso".
    expect(publishDue({ lastPublish: now - 2 * hour, lastName: 'mattgrosso', name: 'Matt Grosso', now })).toBe(true)
    // A new device has no stamp at all.
    expect(publishDue({ name: 'Matt Grosso', now })).toBe(true)
    // Publishers without a name in play keep the plain timer.
    expect(publishDue({ lastPublish: now - 2 * hour, now })).toBe(false)
  })
})

describe('socialSettingsWithDefaults', () => {
  it('defaults everything ON, and falls back to the email when no real name is known', () => {
    const settings = socialSettingsWithDefaults(undefined, 'mattgrosso@gmail.com')
    expect(settings.enabled).toBe(true)
    expect(settings.shareRatings).toBe(true)
    expect(settings.shareCriteria).toBe(true)
    expect(settings.displayName).toBe('mattgrosso')
  })

  // Bug report, 2026-08-20: "It would be nice if we could use someone's real
  // name when we mention them in film club."
  it('prefers the name the sign-in provider knows over the email handle', () => {
    const settings = socialSettingsWithDefaults(undefined, 'mattgrosso@gmail.com', 'Matt Grosso')
    expect(settings.displayName).toBe('Matt Grosso')
  })

  it('still lets a typed display name beat the real name', () => {
    const settings = socialSettingsWithDefaults({ displayName: 'MG' }, 'mattgrosso@gmail.com', 'Matt Grosso')
    expect(settings.displayName).toBe('MG')
  })

  // 2026-10-08: Matt's saved display name was "mattgrosso" — the old default
  // written back by the settings form — and it beat his real name, so Movie
  // Log showed him as "mattgrosso".
  it('a saved name that is only the email handle does not beat the real name', () => {
    expect(socialSettingsWithDefaults({ displayName: 'mattgrosso' }, 'mattgrosso@gmail.com', 'Matt Grosso').displayName).toBe('Matt Grosso')
    expect(socialSettingsWithDefaults({ displayName: 'mattgrosso' }, 'mattgrosso@gmail.com', null).displayName).toBe('mattgrosso')
  })

  it('ignores a blank or whitespace-only real name rather than publishing it', () => {
    expect(socialSettingsWithDefaults(undefined, 'mattgrosso@gmail.com', '   ').displayName).toBe('mattgrosso')
    expect(socialSettingsWithDefaults(undefined, 'mattgrosso@gmail.com', null).displayName).toBe('mattgrosso')
  })

  it('only an explicit false opts a tier out', () => {
    const settings = socialSettingsWithDefaults({ shareCriteria: false, displayName: 'Matt' }, 'mattgrosso@gmail.com')
    expect(settings.enabled).toBe(true)
    expect(settings.shareRatings).toBe(true)
    expect(settings.shareCriteria).toBe(false)
    expect(settings.displayName).toBe('Matt')
  })

  it('master opt-out sticks', () => {
    expect(socialSettingsWithDefaults({ enabled: false }, 'x@y.com').enabled).toBe(false)
  })
})

describe('buildSocialProfile', () => {
  const library = [
    entry(1, 'Best', 9.5, { year: 1980 }),
    entry(2, 'Mid', 7, { year: 1995 }),
    entry(3, 'Newest High', 9.9, { year: 2020 })
  ]

  it('publishes shelf, recent, counts, and the crown — composite scores only', () => {
    const profile = buildSocialProfile(library, ratingOf, { name: 'Matt', shareRatings: true, now: NOW })

    expect(profile.name).toBe('Matt')
    expect(profile.counts.titles).toBe(3)
    expect(profile.topShelf[0].t).toBe('Newest High')
    expect(profile.crown.t).toBe('Newest High') // 1980's 9.5 dethroned by 2020's 9.9
    expect(profile.ratings[1].r).toBe(9.5)
    // Privacy: NO criterion breakdown ever leaves the account.
    expect(JSON.stringify(profile)).not.toContain('direction')
  })

  it('omits the ratings map entirely unless sharing is on', () => {
    const profile = buildSocialProfile(library, ratingOf, { name: 'Matt', shareRatings: false })
    expect(profile.ratings).toBeUndefined()
    expect(profile.topShelf.length).toBeGreaterThan(0) // shelf still published
  })

  // 2026-08-31: the feed showed raw scores, which aren't comparable between
  // people. Only the source app can assign stars, so they have to travel in
  // `recent` — the map alone doesn't help a shelf-only sharer's feed.
  it('publishes stars alongside the score in the recent feed', () => {
    const scored = (e) => ({ calculatedTotal: e.ratings[0].calculatedTotal, normalizedRating: 9 })
    const profile = buildSocialProfile(library, scored, { name: 'Matt', shareRatings: true, now: NOW })

    expect(profile.recent[0].s).toBe(4.5)
    expect(profile.recent[0].r).toBeDefined() // the score stays, as the fallback
  })

  it('omits stars rather than publishing a zero when there are none to publish', () => {
    // Below half a star: normalizedRatingToStars returns null, and an absent
    // key is the difference between "no stars yet" and "rated zero".
    const scored = (e) => ({ calculatedTotal: e.ratings[0].calculatedTotal, normalizedRating: 0.4 })
    const profile = buildSocialProfile(library, scored, { name: 'Matt', shareRatings: true, now: NOW })

    expect(profile.recent[0]).not.toHaveProperty('s')
  })

  it('publishes feed stars even when the ratings map is opted out', () => {
    // `r` is already in `recent` regardless of shareRatings, and stars say
    // less than it does — withholding them would hide the comparable number
    // while publishing the incomparable one.
    const scored = (e) => ({ calculatedTotal: e.ratings[0].calculatedTotal, normalizedRating: 9 })
    const profile = buildSocialProfile(library, scored, { name: 'Matt', shareRatings: false, now: NOW })

    expect(profile.ratings).toBeUndefined()
    expect(profile.recent[0].s).toBe(4.5)
  })

  it('publishes the criteria array only behind its own opt-in', () => {
    const lib = [entry(1, 'Best', 9.5, { criteria: { love: 10, overall: 9, stickiness: 4, story: 9, imagery: 8, performance: 7, soundtrack: 6 } })]
    const withOptIn = buildSocialProfile(lib, ratingOf, { name: 'Matt', shareRatings: true, shareCriteria: true })
    // CRITERIA order: love, overall, stickiness, story, direction, imagery, performance, soundtrack
    expect(withOptIn.ratings[1].c).toEqual([10, 9, 4, 9, 9, 8, 7, 6])
    // shareRatings alone still means composite only
    const withoutOptIn = buildSocialProfile(lib, ratingOf, { name: 'Matt', shareRatings: true })
    expect(withoutOptIn.ratings[1].c).toBeUndefined()
  })
})

describe('compareWithFriend', () => {
  const myLibrary = [
    entry(1, 'Agreed Love', 9),
    entry(2, 'Fight Movie', 9),
    entry(3, 'Mine Only', 8)
  ]
  const friend = {
    name: 'Natalie',
    ratings: {
      1: { r: 8.8, t: 'Agreed Love', p: '/1.jpg' },
      2: { r: 4, t: 'Fight Movie', p: '/2.jpg' },
      9: { r: 9.2, t: 'Theirs Only Gem', p: '/9.jpg' }
    }
  }

  it('finds the overlap, gaps, shared loves, and their unseen gems', () => {
    const cmp = compareWithFriend(myLibrary, ratingOf, friend, { globalAvg: 6 })

    expect(cmp.sharedCount).toBe(2)
    expect(cmp.biggestDisagreements[0].entry.movie.title).toBe('Fight Movie')
    expect(cmp.biggestDisagreements[0].gap).toBe(5)
    expect(cmp.sharedLoves[0].entry.movie.title).toBe('Agreed Love')
    expect(cmp.theyLoveUnseen[0].t).toBe('Theirs Only Gem')
    expect(cmp.myLogScore).not.toBeNull()
    expect(cmp.alignment).toBeLessThan(10)
  })

  it('degrades gracefully with no overlap', () => {
    const cmp = compareWithFriend([entry(50, 'Lonely', 7)], ratingOf, friend, { globalAvg: 6 })
    expect(cmp.sharedCount).toBe(0)
    expect(cmp.theyLoveUnseen.length).toBeGreaterThan(0)
  })

  it('surfaces per-criterion tendencies when the friend shares their breakdown', () => {
    const lib = [
      entry(1, 'A', 9, { criteria: { love: 9, overall: 8, stickiness: 4, story: 8, imagery: 6, performance: 7, soundtrack: 5 } }),
      entry(2, 'B', 8, { criteria: { love: 8, overall: 8, stickiness: 3, story: 7, imagery: 5, performance: 7, soundtrack: 5 } })
    ]
    const sharing = {
      name: 'Natalie',
      ratings: {
        // c order: love, overall, stickiness, story, direction, imagery, performance, soundtrack
        1: { r: 8, t: 'A', p: '/1.jpg', c: [7, 8, 4, 8, 9, 7, 7, 5] },
        2: { r: 8, t: 'B', p: '/2.jpg', c: [6, 8, 3, 7, 9, 6, 7, 5] }
      }
    }
    const cmp = compareWithFriend(lib, ratingOf, sharing, { globalAvg: 6 })
    expect(cmp.criterionGaps).not.toBeNull()
    // I rate Love higher by 2 on both movies; that should lead the list.
    expect(cmp.criterionGaps[0].criterion).toBe('love')
    expect(cmp.criterionGaps[0].gap).toBe(2)
    expect(cmp.criterionGaps[0].count).toBe(2)
    // Imagery: I'm lower by 1 on both — negative gap.
    const imagery = cmp.criterionGaps.find((g) => g.criterion === 'imagery')
    expect(imagery.gap).toBe(-1)
  })

  it('criterionGaps is null when the friend shares composites only', () => {
    const cmp = compareWithFriend(myLibrary, ratingOf, friend, { globalAvg: 6 })
    expect(cmp.criterionGaps).toBeNull()
  })
})

describe('countNewFriendUpdates', () => {
  const profiles = {
    'natalie-key': { name: 'Natalie', recent: [{ id: 1, at: 1000 }, { id: 2, at: 3000 }] },
    'seth-key': { name: 'Seth', recent: [{ id: 3, at: 2000 }] }
  }

  it('counts only ratings newer than lastSeen, across all friends', () => {
    expect(countNewFriendUpdates(profiles, 1500)).toBe(2) // at 3000 and 2000
    expect(countNewFriendUpdates(profiles, 0)).toBe(3)
    expect(countNewFriendUpdates(profiles, 5000)).toBe(0)
  })

  it('tolerates empty and malformed profiles', () => {
    expect(countNewFriendUpdates({}, 0)).toBe(0)
    expect(countNewFriendUpdates({ x: null, y: { recent: null } }, 0)).toBe(0)
    expect(countNewFriendUpdates(undefined, undefined)).toBe(0)
  })
})

describe('filmClubSummary', () => {
  const myLibrary = [entry(1, 'Consensus', 9), entry(2, 'Divisive', 9)]
  const friends = {
    'natalie-key': {
      name: 'Natalie',
      recent: [{ id: 7, t: 'Nat Recent', p: '/7.jpg', r: 8, at: NOW - 100 }],
      ratings: { 1: { r: 8.5, t: 'Consensus', p: '/1.jpg' }, 2: { r: 3, t: 'Divisive', p: '/2.jpg' } }
    },
    'seth-key': {
      name: 'Seth',
      recent: [{ id: 8, t: 'Seth Recent', p: '/8.jpg', r: 6, at: NOW - 50 }],
      ratings: { 1: { r: 9.2, t: 'Consensus', p: '/1.jpg' } }
    }
  }

  it('merges the feed newest-first and surfaces consensus and divides', () => {
    const summary = filmClubSummary(myLibrary, ratingOf, friends)

    expect(summary.friendCount).toBe(2)
    expect(summary.feed[0].t).toBe('Seth Recent')
    expect(summary.feed[0].friendName).toBe('Seth')
    expect(summary.clubFavorites[0].t).toBe('Consensus')
    expect(summary.clubFavorites[0].scores.length).toBe(3)
    expect(summary.biggestDivides[0].t).toBe('Divisive')
    expect(summary.biggestDivides[0].spread).toBe(6)
  })

  // 2026-09-07: "everyone who likes it with their ratings, we should sort
  // them by rating." The chips used to come out You-first, then friends in
  // whatever order their profiles loaded.
  it('lists each movie\'s scores highest first, whoever gave them', () => {
    const summary = filmClubSummary(myLibrary, ratingOf, friends)
    expect(summary.clubFavorites[0].scores.map((s) => s.who)).toEqual(['Seth', 'You', 'Natalie'])
    expect(summary.biggestDivides[0].scores.map((s) => s.r)).toEqual([9, 3])
  })

  it('null with no friends', () => {
    expect(filmClubSummary(myLibrary, ratingOf, {})).toBeNull()
  })

  // The feed shows stars; a profile only gains `s` in `recent` when its owner
  // republishes, so the summary reads the ratings map in the meantime rather
  // than leaving the feed on raw scores for days.
  describe('feed stars', () => {
    it('takes stars straight from the feed item when the friend published them', () => {
      const friend = {
        'nat-key': {
          name: 'Natalie',
          recent: [{ id: 7, t: 'Nat Recent', r: 8, s: 4, at: NOW - 100 }],
          ratings: { 7: { r: 8, s: 2.5 } }   // stale; the feed item wins
        }
      }
      expect(filmClubSummary(myLibrary, ratingOf, friend).feed[0].s).toBe(4)
    })

    it('falls back to the ratings map for a profile published before feed stars', () => {
      const friend = {
        'nat-key': {
          name: 'Natalie',
          recent: [{ id: 7, t: 'Nat Recent', r: 8, at: NOW - 100 }],
          // Firebase returns the map as an object, so its keys are STRINGS
          // while the feed item's id is a number.
          ratings: { 7: { r: 8, s: 3.5 } }
        }
      }
      expect(filmClubSummary(myLibrary, ratingOf, friend).feed[0].s).toBe(3.5)
    })

    it('leaves stars null when nobody published any, so the screen shows the score', () => {
      const friend = {
        'nat-key': { name: 'Natalie', recent: [{ id: 7, t: 'Nat Recent', r: 8, at: NOW - 100 }] }
      }
      expect(filmClubSummary(myLibrary, ratingOf, friend).feed[0].s).toBeNull()
    })
  })
})


describe('friendsLoveUnseen', () => {
  const myLibrary = [entry(1, 'Seen It', 7)]
  const friends = {
    nat: {
      name: 'Natalie',
      ratings: {
        1: { r: 9, t: 'Seen It', p: '/1.jpg' },        // I've rated it — excluded
        2: { r: 9, t: 'Both Love', p: '/2.jpg' },
        3: { r: 8.5, t: 'Nat Only', p: '/3.jpg' },
        4: { r: 6, t: 'Lukewarm', p: '/4.jpg' }        // below the love floor
      }
    },
    seth: {
      name: 'Seth',
      ratings: {
        2: { r: 8.2, t: 'Both Love', p: '/2.jpg' },
        5: { r: 9.9, t: 'Seth Only', p: '/5.jpg' }
      }
    },
    shelfOnly: { name: 'Quiet One' }                    // shares no ratings map
  }

  it('ranks agreement above raw score', () => {
    const rows = friendsLoveUnseen(myLibrary, ratingOf, friends)
    expect(rows[0].title).toBe('Both Love')             // 2 fans beats Seth's lone 9.9
    expect(rows[0].fanCount).toBe(2)
    expect(rows[0].average).toBe(8.6)
    expect(rows[0].fans[0].name).toBe('Natalie')        // best score first
  })

  it('excludes what I have already rated and what nobody loved', () => {
    const titles = friendsLoveUnseen(myLibrary, ratingOf, friends).map((r) => r.title)
    expect(titles).not.toContain('Seen It')
    expect(titles).not.toContain('Lukewarm')
    expect(titles).toEqual(expect.arrayContaining(['Nat Only', 'Seth Only']))
  })

  it('is empty with no friends, and ignores friends who share no scores', () => {
    expect(friendsLoveUnseen(myLibrary, ratingOf, {})).toEqual([])
    expect(friendsLoveUnseen(myLibrary, ratingOf, { shelfOnly: friends.shelfOnly })).toEqual([])
  })
})

describe('published viewings (where and when)', () => {
  it('carries every viewing newest-first with its medium', () => {
    const library = [entry(1, 'Rewatched', 9, {
      at: NOW,
      medium: 'Theater',
      extraViewings: [{ date: NOW - 100000, calculatedTotal: 8, medium: 'Bluray' }]
    })]
    const profile = buildSocialProfile(library, ratingOf, { name: 'Matt', shareRatings: true })

    expect(profile.ratings[1].v).toEqual([
      { at: NOW, m: 'Theater' },
      { at: NOW - 100000, m: 'Bluray' }
    ])
    // The recent shelf shows the medium of the latest viewing.
    expect(profile.recent[0].m).toBe('Theater')
  })

  it('omits the medium key when a viewing has none, rather than writing null', () => {
    const profile = buildSocialProfile([entry(1, 'No Medium', 7)], ratingOf, { name: 'Matt', shareRatings: true })
    expect(profile.ratings[1].v).toEqual([{ at: NOW - 1000 }])
    expect(profile.recent[0].m).toBeUndefined()
  })

  it('skips viewings with unusable dates', () => {
    const library = [{
      dbKey: 'k1',
      movie: { id: 1, title: 'Undated', poster_path: '/1.jpg', release_date: '2000-06-15' },
      ratings: [{ calculatedTotal: 7 }]
    }]
    const profile = buildSocialProfile(library, ratingOf, { name: 'Matt', shareRatings: true })
    expect(profile.ratings[1].v).toBeUndefined()
  })
})

describe('friendSnapshot', () => {
  const mine = myRatingsById(
    [
      { movie: { id: 1 }, ratings: [{ calculatedTotal: 9 }] },
      { movie: { id: 2 }, ratings: [{ calculatedTotal: 4 }] },
      { movie: { id: 3 }, ratings: [{ calculatedTotal: 7 }] }
    ],
    (entry) => ({ calculatedTotal: entry.ratings[0].calculatedTotal })
  );

  const profile = {
    counts: { titles: 120, viewings: 200 },
    ratings: { 1: { r: 8 }, 2: { r: 6 }, 9: { r: 10 } },
    recent: [
      { id: 9, t: 'Newest', p: '/9.jpg', at: 300 },
      { id: 1, t: 'Older', p: '/1.jpg', at: 100 },
      { id: 2, t: 'Middle', p: '/2.jpg', at: 200 }
    ]
  };

  it('counts only the movies you have both rated', () => {
    // 3 is mine alone, 9 is theirs alone.
    expect(friendSnapshot(mine, profile).sharedCount).toBe(2);
  });

  it('scores alignment the same way the comparison page does', () => {
    // Gaps of 1 and 2 across two shared films: 10 - 1.5.
    expect(friendSnapshot(mine, profile).alignment).toBe(8.5);
  });

  it('has no alignment to report when nothing overlaps', () => {
    const snapshot = friendSnapshot(mine, { ratings: { 99: { r: 5 } } });

    expect(snapshot.sharedCount).toBe(0);
    expect(snapshot.alignment).toBe(null);
  });

  it('surfaces the most recent watches, newest first', () => {
    const snapshot = friendSnapshot(mine, profile);

    expect(snapshot.recent.map((item) => item.t)).toEqual(['Newest', 'Middle', 'Older']);
    expect(snapshot.lastWatchedAt).toBe(300);
  });

  it('caps how many recent posters a row asks for', () => {
    const many = { recent: Array.from({ length: 20 }, (unused, i) => ({ id: i, at: i })) };

    expect(friendSnapshot(mine, many, { recentCount: 4 }).recent).toHaveLength(4);
  });

  it('survives a friend with no profile at all', () => {
    const snapshot = friendSnapshot(mine, null);

    expect(snapshot.titles).toBe(null);
    expect(snapshot.sharedCount).toBe(0);
    expect(snapshot.recent).toEqual([]);
  });
});


// "Add director and cast and some other pertinent details to the unrated
// movie drawer" (2026-08-20). What the people you actually know made of a
// film is the most pertinent thing the app holds about one nobody has rated
// for you — and the profiles are already in memory, so it costs no request.
describe('friendRatingsFor', () => {
  const profiles = {
    a: { name: 'Natalie', ratings: { 550: { r: 9.2 }, 12: { r: 4 } } },
    b: { name: 'Brian', ratings: { 550: { r: 8.44 } } },
    c: { name: 'Seth', ratings: {} },
    // The shelf-only sharing tier publishes no ratings map at all.
    d: { name: 'Shelf Only' }
  }

  it('reports everyone who has rated the film, best first', () => {
    expect(friendRatingsFor(profiles, 550)).toEqual([
      { name: 'Natalie', rating: 9.2 },
      { name: 'Brian', rating: 8.44 }
    ])
  })

  it('takes a string id as readily as a number — Firebase keys are strings', () => {
    expect(friendRatingsFor(profiles, '550').map((f) => f.name)).toEqual(['Natalie', 'Brian'])
  })

  it('leaves out friends who have not rated it, rather than scoring them zero', () => {
    expect(friendRatingsFor(profiles, 12)).toEqual([{ name: 'Natalie', rating: 4 }])
  })

  it('is empty for a film nobody in the club has seen', () => {
    expect(friendRatingsFor(profiles, 999)).toEqual([])
  })

  it('breaks a tie alphabetically, so the order cannot wobble between renders', () => {
    const tied = {
      a: { name: 'Zoe', ratings: { 1: { r: 8 } } },
      b: { name: 'Adam', ratings: { 1: { r: 8 } } }
    }

    expect(friendRatingsFor(tied, 1).map((f) => f.name)).toEqual(['Adam', 'Zoe'])
  })

  it('names an anonymous profile rather than rendering undefined', () => {
    expect(friendRatingsFor({ x: { ratings: { 1: { r: 7 } } } }, 1)).toEqual([{ name: 'A friend', rating: 7 }])
  })

  it('is null-safe', () => {
    expect(friendRatingsFor(null, 1)).toEqual([])
    expect(friendRatingsFor(profiles, null)).toEqual([])
  })
})

// "let's use the normalized ratings as well. It would be best if we could show
// star ratings for these on the movie details" (2026-08-25).
//
// Stars can only be assigned by the person's own app: they present the
// NORMALIZED rating, which is library-relative and curve-adjusted, so a reader
// holding nothing but our composite `r` cannot derive them — they have neither
// our library's range nor our normalization tweak and anchors.
describe('buildSocialProfile — stars', () => {
  const scored = (total, normalized) => () => ({ calculatedTotal: total, normalizedRating: normalized })

  it('publishes the star rating alongside the composite', () => {
    const profile = buildSocialProfile([entry(1, 'Heat', 8.7)], scored(8.7, 9), {
      name: 'Matt', shareRatings: true
    })
    expect(profile.ratings[1].r).toBe(8.7)
    expect(profile.ratings[1].s).toBe(4.5)
  })

  it('derives the stars from the NORMALIZED rating, not the composite', () => {
    // The two numbers are on different scales — a composite of 8.7 against a
    // normalized 4 is two stars, not four and a half.
    const profile = buildSocialProfile([entry(1, 'Heat', 8.7)], scored(8.7, 4), {
      name: 'Matt', shareRatings: true
    })
    expect(profile.ratings[1].s).toBe(2)
  })

  it('omits the stars rather than publishing a zero when there is no normalized rating', () => {
    const profile = buildSocialProfile([entry(1, 'Heat', 8.7)], scored(8.7, undefined), {
      name: 'Matt', shareRatings: true
    })
    expect(profile.ratings[1].r).toBe(8.7)
    expect(profile.ratings[1].s).toBeUndefined()
  })

  it('still publishes nothing at all when ratings are not shared', () => {
    const profile = buildSocialProfile([entry(1, 'Heat', 8.7)], scored(8.7, 9), {
      name: 'Matt', shareRatings: false
    })
    expect(profile.ratings).toBeUndefined()
  })
})

// The 2026-08-29 report: "I'm definitely not seeing all of my friends ratings
// on my movie detail pages... I know for a fact several of my friends have
// seen [it]." Three Movie Log friends had it rated in their live feeds. The
// native half of the club self-healed through a socialFriendKeys watcher; the
// EXTERNAL half only ever loaded in a mount hook that reads
// settings/externalFriends, so on a cold start that ran before settings
// arrived, it fetched nothing and never tried again all session.
describe('clubFetchesNeeded', () => {
  it('asks for both halves when nothing is loaded yet', () => {
    expect(clubFetchesNeeded({
      friendKeys: ['seth-gmail-com'],
      externalFriends: { 'ext-1': { feedUrl: 'https://example.com/f.json' } }
    })).toEqual({ native: true, external: true })
  })

  it('asks for nothing once both halves are in — so re-dispatching is free', () => {
    expect(clubFetchesNeeded({
      friendKeys: ['seth-gmail-com'],
      nativeProfiles: { 'seth-gmail-com': { name: 'Seth' } },
      externalFriends: { 'ext-1': { feedUrl: 'https://example.com/f.json' } },
      externalProfiles: { 'ext-1': { name: 'Brian' } }
    })).toEqual({ native: false, external: false })
  })

  it('asks for the external half alone when only that is missing', () => {
    // The exact shape of the bug: native friends loaded, external didn't.
    expect(clubFetchesNeeded({
      friendKeys: ['seth-gmail-com'],
      nativeProfiles: { 'seth-gmail-com': { name: 'Seth' } },
      externalFriends: { 'ext-1': {}, 'ext-2': {} },
      externalProfiles: { 'ext-1': { name: 'Brian' } }
    })).toEqual({ native: false, external: true })
  })

  it('asks again for a feed that errored, so a transient failure heals', () => {
    expect(clubFetchesNeeded({
      externalFriends: { 'ext-1': {} },
      externalProfiles: {}
    }).external).toBe(true)
  })

  it('asks for nothing at all when the club is empty', () => {
    expect(clubFetchesNeeded()).toEqual({ native: false, external: false })
    expect(clubFetchesNeeded({ friendKeys: [], externalFriends: {} }))
      .toEqual({ native: false, external: false })
  })
})

// 2026-09-06: Seth logged a film, Matt's phone buzzed, and the film's page
// showed no rating — Matt's app had been open all day and held the copy of
// Seth's profile it fetched that morning. "Already here" was the only test.
describe('clubFetchesNeeded — staleness', () => {
  const NOW = Date.UTC(2026, 8, 6, 19, 37)
  const loaded = {
    friendKeys: ['seth-gmail-com'],
    nativeProfiles: { 'seth-gmail-com': { name: 'Seth' } },
    externalFriends: { 'ext-1': { feedUrl: 'https://example.com/f.json' } },
    externalProfiles: { 'ext-1': { name: 'Brian' } }
  }

  it('treats a copy older than maxAgeMs as missing', () => {
    expect(clubFetchesNeeded({ ...loaded, fetchedAt: NOW - 6 * 60 * 1000, maxAgeMs: 5 * 60 * 1000, now: NOW }))
      .toEqual({ native: true, external: true })
  })

  it('is satisfied by a copy younger than maxAgeMs', () => {
    expect(clubFetchesNeeded({ ...loaded, fetchedAt: NOW - 60 * 1000, maxAgeMs: 5 * 60 * 1000, now: NOW }))
      .toEqual({ native: false, external: false })
  })

  it('never fetches for an empty club, however stale', () => {
    expect(clubFetchesNeeded({ fetchedAt: 0, maxAgeMs: 1000, now: NOW })).toEqual({ native: false, external: false })
  })

  it('leaves the default behaviour alone: without maxAgeMs only a missing profile counts', () => {
    expect(clubFetchesNeeded({ ...loaded, fetchedAt: 0, now: NOW })).toEqual({ native: false, external: false })
  })
})
