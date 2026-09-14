import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { reactive } from 'vue'
import TweakInline from '@/components/TweakInline.vue'

vi.mock('@/assets/javascript/GetRating.js', () => ({
  // Folds tweakValue in, same as the real GetRating.js, so a fixture's tie
  // can be tested as "resolved" by giving it a non-zero tweakValue.
  getRating: vi.fn((movie) => ({
    calculatedTotal: movie.ratings[0].calculatedTotal + (movie.ratings[0].tweakValue || 0)
  }))
}))

function movie (dbKey, title, calculatedTotal, tweakValue = 0) {
  return {
    dbKey,
    movie: { id: dbKey, title, poster_path: `/${dbKey}.jpg` },
    ratings: [{ calculatedTotal, date: '2024-01-01', tweakValue }]
  }
}

function mountTweak (movies, { tieBreakTournament = null, tieBreakPromptState = 'auto' } = {}) {
  const dispatch = vi.fn()
  const mockStore = {
    state: { currentLog: 'movieLog', settings: { tieBreakTournament, tieBreakPromptState } },
    getters: { allMoviesAsArray: movies },
    dispatch
  }

  const wrapper = mount(TweakInline, {
    global: { mocks: { $store: mockStore } },
    props: { allEntriesWithFlatKeywordsAdded: movies, showTweakModal: true }
  })

  return { wrapper, dispatch, mockStore }
}

// Finds the value most recently dispatched to a given settings/movieLog path.
function lastDispatchTo (dispatch, path) {
  const call = [...dispatch.mock.calls].reverse().find(([, entry]) => entry.path === path)
  return call ? call[1].value : undefined
}


// The posters are gated on both images having loaded (bug report: a
// half-swapped pair was tappable and you hit the wrong film). jsdom never
// loads images and so never fires `load`, so tests have to say when the pair
// is on screen — exactly what a browser does for real.
async function postersLoaded (wrapper) {
  const images = wrapper.findAll('.poster-image')
  for (const image of images) {
    await image.trigger('load')
  }
  await wrapper.vm.$nextTick()
}


// For tests that call chooseWinner() on the vm directly rather than tapping:
// the same gate applies, so say the pair is on screen first.
async function markPostersLoaded (wrapper) {
  // The matchKey watcher clears the gate on a "pre" flush, i.e. AFTER the
  // tournament is created and not synchronously with it — so settle first,
  // or this gets wiped a tick later and the tap is refused.
  await wrapper.vm.$nextTick()
  wrapper.vm.loadedPosterKeys = [wrapper.vm.firstResult?.dbKey, wrapper.vm.secondResult?.dbKey].filter(Boolean)
}

describe('TweakInline', () => {
  describe('no ties present', () => {
    it('renders nothing', () => {
      const { wrapper } = mountTweak([movie('a', 'A', 9), movie('b', 'B', 7)])
      expect(wrapper.find('.tweak-inline').exists()).toBe(false)
    })
  })

  describe('a fresh 2-way tie', () => {
    it('auto-starts and persists a tournament on mount', () => {
      const { dispatch } = mountTweak([movie('a', 'A', 8), movie('b', 'B', 8)])
      const tournament = lastDispatchTo(dispatch, 'settings/tieBreakTournament')
      expect(tournament.contestantIds.sort()).toEqual(['a', 'b'])
      expect(tournament.schedule).toEqual([{ a: 'a', b: 'b' }])
    })

    it('shows the notice first, then the matchup after tapping it, with no contestant-count/progress narration for a single match', async () => {
      const { wrapper } = mountTweak([movie('a', 'A', 8), movie('b', 'B', 8)])
      expect(wrapper.text()).toContain('Two films are sitting on the same score')

      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      expect(wrapper.findAll('.poster-container')).toHaveLength(2)
      // A 2-way tie is exactly one match — not really a "tournament", so no
      // "N contestants · match X of Y" ceremony (per bug report feedback).
      expect(wrapper.text()).not.toContain('contestants')
      expect(wrapper.text()).not.toContain('match 1 of 1')
    })

    it('picking a winner (the only match) applies the result and skips straight past the results screen — no "Done" tap needed', async () => {
      const { wrapper, dispatch } = mountTweak([movie('a', 'A', 8), movie('b', 'B', 8)])
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)

      await wrapper.findAll('.poster-container')[0].trigger('click')
      await postersLoaded(wrapper)

      // Winner (rank 0) untouched, loser (rank 1) gets the -0.05 penalty —
      // matching the old single-pair tiebreak's behavior exactly for N=2.
      const loserUpdate = lastDispatchTo(dispatch, 'movieLog/b')
      expect(loserUpdate.ratings[0].tweakValue).toBeCloseTo(-0.0005, 6)
      expect(lastDispatchTo(dispatch, 'movieLog/a')).toBeUndefined()

      // No "Tournament Complete!" standings screen/Done tap for a 2-way tie
      // — per bug report feedback, it should just apply and move on.
      expect(wrapper.text()).not.toContain('Tournament Complete!')
      expect(dispatch).toHaveBeenCalledWith('writeDurably', { path: 'settings/tieBreakTournament', value: null })
    })

    it('always closes and stamps the daily-quota clock once a 2-way tie resolves, even when another tied group exists (bug report: "it didn\'t actually close... that should count as my tiebreak for this time")', async () => {
      // In this fixture, dispatch is a spy only — the underlying movies array
      // never actually changes score — so after the fast-path clears the
      // tournament, the SAME pair still reads as tied. Previously this used
      // to auto-start a fresh tournament for it and show the next match
      // immediately, with no visual break - confusing, and it meant the
      // daily-quota clock never got a chance to reset. Now it always closes
      // here, regardless of whether another tied group exists; the next
      // scan (whenever the quota next allows) picks it up fresh.
      const { wrapper, dispatch } = mountTweak([movie('a', 'A', 8), movie('b', 'B', 8)])
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      await wrapper.findAll('.poster-container')[0].trigger('click')
      await postersLoaded(wrapper)

      expect(wrapper.text()).not.toContain('Tournament Complete!')
      expect(wrapper.vm.showTweakInline).toBe(false)
      expect(dispatch).toHaveBeenCalledWith('writeDurably', { path: 'settings/lastTweak', value: expect.any(Number) })
    })

    it('does not offer "Save for later" for a single-match (2-way) tie', async () => {
      const { wrapper } = mountTweak([movie('a', 'A', 8), movie('b', 'B', 8)])
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      expect(wrapper.find('.save-for-later-btn').exists()).toBe(false)
    })
  })

  // Bug report, 2026-08-19: "the posters are a little bit slow to load and so
  // sometimes while I'm trying to go through the rounds quickly a poster
  // won't seem to swap, but then it suddenly changes something else and it's
  // awkward. We need to make some kind of indication that we're swapping and
  // then only show both posters when both posters are fully loaded."
  describe('poster loading gate', () => {
    const openMatchup = async (movies) => {
      const { wrapper, dispatch } = mountTweak(movies)
      await wrapper.find('.prompt-card').trigger('click')
      return { wrapper, dispatch }
    }

    it('shows a swapping indicator and hides the pair until both have loaded', async () => {
      const { wrapper } = await openMatchup([movie('a', 'A', 8), movie('b', 'B', 8)])

      // This used to assert `element.style.display === 'none'`, i.e. exactly
      // what v-show writes — and stayed green while the row was plainly
      // visible on a real phone, because jsdom loads no Bootstrap CSS and so
      // never saw the `.d-flex { display: flex !important }` that beat that
      // inline style. Assert the class the component controls instead; it is
      // the thing that actually hides the row now.
      const pair = () => wrapper.find('.poster-row')
      expect(wrapper.find('.posters-swapping').exists()).toBe(true)
      expect(pair().classes()).toContain('posters-hidden')

      await postersLoaded(wrapper)

      expect(wrapper.find('.posters-swapping').exists()).toBe(false)
      expect(pair().classes()).not.toContain('posters-hidden')
    })

    // Bug report, 2026-08-20: "The new loading state on the tie breaker is
    // forcing the two empty poster spots down and then popping them back up."
    it('stacks the indicator over the pair rather than above it, so nothing is pushed down', async () => {
      const { wrapper } = await openMatchup([movie('a', 'A', 8), movie('b', 'B', 8)])

      // Both live inside one positioned stage — the indicator is a sibling
      // OVERLAY of the row, never a block that takes its own height in flow
      // above it.
      const stage = wrapper.find('.poster-stage')
      expect(stage.exists()).toBe(true)
      expect(stage.find('.posters-swapping').exists()).toBe(true)
      expect(stage.find('.poster-row').exists()).toBe(true)

      // And the row keeps reserving its space while hidden, so the swap costs
      // no height change: it is hidden by visibility, not removed or
      // display:none'd.
      const row = wrapper.find('.poster-row')
      expect(row.classes()).toContain('posters-hidden')
      expect(row.element.style.display).toBe('')
      expect(wrapper.findAll('.poster-image')).toHaveLength(2)
    })

    it('refuses a tap while only ONE poster has loaded — the actual misfire', async () => {
      const { wrapper, dispatch } = await openMatchup([movie('a', 'A', 8), movie('b', 'B', 8)])
      const before = dispatch.mock.calls.length

      await wrapper.findAll('.poster-image')[0].trigger('load')
      await wrapper.vm.$nextTick()
      await wrapper.findAll('.poster-container')[0].trigger('click')

      expect(wrapper.vm.postersReady).toBe(false)
      expect(wrapper.vm.selectedDbKey).toBeNull()
      expect(dispatch.mock.calls.length).toBe(before)
    })

    it('re-closes the gate on the next matchup, so the second pair cannot be tapped early either', async () => {
      const { wrapper } = await openMatchup([
        movie('a', 'A', 7), movie('b', 'B', 7), movie('c', 'C', 7), movie('d', 'D', 7)
      ])
      await postersLoaded(wrapper)
      expect(wrapper.vm.postersReady).toBe(true)

      await wrapper.findAll('.poster-container')[0].trigger('click')

      // A new matchup is up; nothing has loaded for it yet.
      expect(wrapper.vm.postersReady).toBe(false)
      expect(wrapper.find('.posters-swapping').exists()).toBe(true)
    })

    it('lifts the gate on a broken poster rather than hanging forever', async () => {
      const { wrapper } = await openMatchup([movie('a', 'A', 8), movie('b', 'B', 8)])

      for (const image of wrapper.findAll('.poster-image')) {
        await image.trigger('error')
      }
      await wrapper.vm.$nextTick()

      expect(wrapper.vm.postersReady).toBe(true)
    })
  })

  describe('selection checkmark (bug report: "I do want an indication that I have clicked on one")', () => {
    it('sets selectedDbKey to the tapped poster synchronously, driving the checkmark badge before the save resolves', async () => {
      const { wrapper } = mountTweak([movie('a', 'A', 8), movie('b', 'B', 8)])
      wrapper.vm.showTweakInline = true
      await markPostersLoaded(wrapper)
      const winner = wrapper.vm.firstResult
      wrapper.vm.chooseWinner(winner) // deliberately not awaited
      expect(wrapper.vm.selectedDbKey).toBe(winner.dbKey)
    })

    it('clears selectedDbKey once the winner has been fully processed', async () => {
      const { wrapper, dispatch } = mountTweak([movie('a', 'A', 8), movie('b', 'B', 8)])
      wrapper.vm.showTweakInline = true
      await markPostersLoaded(wrapper)
      const winner = wrapper.vm.firstResult
      const dispatchesBefore = dispatch.mock.calls.length
      await wrapper.vm.chooseWinner(winner)

      expect(wrapper.vm.selectedDbKey).toBeNull()
      // Not vacuous: a REFUSED tap also leaves selectedDbKey null, so prove
      // the pick was actually processed rather than silently dropped.
      expect(dispatch.mock.calls.length).toBeGreaterThan(dispatchesBefore)
    })

    it('renders the checkmark only on the poster matching selectedDbKey', async () => {
      const { wrapper } = mountTweak([movie('a', 'A', 7), movie('b', 'B', 7), movie('c', 'C', 7), movie('d', 'D', 7)])
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      wrapper.vm.selectedDbKey = wrapper.vm.firstResult.dbKey
      await wrapper.vm.$nextTick()

      const posters = wrapper.findAll('.poster-container')
      expect(posters[0].find('.selected-checkmark').exists()).toBe(true)
      expect(posters[1].find('.selected-checkmark').exists()).toBe(false)
    })
  })

  describe('poster prefetching (bug report: "swaps out one of the posters, but not the other one... pre-cache the next setup")', () => {
    let originalImage
    let createdImages

    beforeEach(() => {
      originalImage = global.Image
      createdImages = []
      global.Image = vi.fn(function FakeImage () {
        createdImages.push(this)
      })
    })

    afterEach(() => {
      global.Image = originalImage
    })

    it('warms the browser image cache for every contestant as soon as a tournament is created', () => {
      mountTweak([movie('a', 'A', 8), movie('b', 'B', 8)])
      const srcs = createdImages.map((img) => img.src)
      expect(srcs).toContain('https://image.tmdb.org/t/p/w500/a.jpg')
      expect(srcs).toContain('https://image.tmdb.org/t/p/w500/b.jpg')
    })

    it('also warms the cache on mount when resuming an already-persisted tournament (e.g. after a page reload)', () => {
      const movies = [movie('a', 'A', 8), movie('b', 'B', 8), movie('c', 'C', 8)]
      const mockStore = {
        state: {
          currentLog: 'movieLog',
          settings: { tieBreakTournament: { contestantIds: ['a', 'b', 'c'], schedule: [], results: [] } }
        },
        getters: { allMoviesAsArray: movies },
        dispatch: vi.fn()
      }
      mount(TweakInline, {
        global: { mocks: { $store: mockStore } },
        props: { allEntriesWithFlatKeywordsAdded: movies, showTweakModal: true }
      })

      const srcs = createdImages.map((img) => img.src)
      expect(srcs).toContain('https://image.tmdb.org/t/p/w500/a.jpg')
      expect(srcs).toContain('https://image.tmdb.org/t/p/w500/b.jpg')
      expect(srcs).toContain('https://image.tmdb.org/t/p/w500/c.jpg')
    })
  })

  describe('a 4-way tie', () => {
    function fourWayMovies () {
      return [movie('a', 'A', 7), movie('b', 'B', 7), movie('c', 'C', 7), movie('d', 'D', 7)]
    }

    it('schedules all 6 round-robin matches and shows progress', async () => {
      const { wrapper } = mountTweak(fourWayMovies())
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      expect(wrapper.text()).toContain('4 contestants')
      expect(wrapper.text()).toContain('match 1 of 6')
    })

    it('walks through all 6 matches then shows a full final ranking with score adjustments applied once', async () => {
      const { wrapper, dispatch } = mountTweak(fourWayMovies())
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)

      // 'a' wins every match it's in; among the rest, whoever is posed first wins.
      for (let i = 0; i < 6; i++) {
        expect(wrapper.text()).not.toContain('Tournament Complete!')
        await wrapper.findAll('.poster-container')[0].trigger('click')
        await postersLoaded(wrapper)
      }

      expect(wrapper.text()).toContain('Tournament Complete!')
      expect(wrapper.findAll('.tournament-results li')).toHaveLength(4)

      // No movie should receive more than one score-adjustment dispatch —
      // the whole standing is applied once, in a single batch, at the end.
      const movieDispatches = dispatch.mock.calls.filter(([, entry]) => entry.path.startsWith('movieLog/'))
      const paths = movieDispatches.map(([, entry]) => entry.path)
      expect(new Set(paths).size).toBe(paths.length)
    })

    it('does NOT reset the daily-quota clock between matches — the whole tournament runs in one sitting by default', async () => {
      const { wrapper, dispatch } = mountTweak(fourWayMovies())
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)

      for (let i = 0; i < 5; i++) {
        await wrapper.findAll('.poster-container')[0].trigger('click')
        await postersLoaded(wrapper)
      }
      // 5 of 6 matches done — tournament still in progress.
      expect(wrapper.text()).not.toContain('Tournament Complete!')
      expect(dispatch).not.toHaveBeenCalledWith('writeDurably', { path: 'settings/lastTweak', value: expect.any(Number) })

      // The 6th (final) match completes the tournament but still doesn't
      // stamp the clock — that only happens once the results are acknowledged.
      await wrapper.findAll('.poster-container')[0].trigger('click')
      await postersLoaded(wrapper)
      expect(wrapper.text()).toContain('Tournament Complete!')
      expect(dispatch).not.toHaveBeenCalledWith('writeDurably', { path: 'settings/lastTweak', value: expect.any(Number) })

      dispatch.mockClear()
      await wrapper.find('.btn').trigger('click') // "Done"
      expect(dispatch).toHaveBeenCalledWith('writeDurably', { path: 'settings/lastTweak', value: expect.any(Number) })
    })

    it('offers "Save for later" mid-tournament — tapping it pauses without losing progress', async () => {
      const { wrapper, dispatch } = mountTweak(fourWayMovies())
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      await wrapper.findAll('.poster-container')[0].trigger('click')
      await postersLoaded(wrapper) // 1 of 6 matches done

      const saveBtn = wrapper.find('.save-for-later-btn')
      expect(saveBtn.exists()).toBe(true)
      await saveBtn.trigger('click')

      // Collapses back to the notice, resets the quota clock... and the
      // notice names the real size of THIS tie. It used to read "Two films"
      // even here, in a 4-way tie (report -P-FN61DdMmTJ0J9XJWy).
      expect(wrapper.find('.prompt-card').text()).toContain('Four films are sitting on the same score')
      expect(dispatch).toHaveBeenCalledWith('writeDurably', { path: 'settings/lastTweak', value: expect.any(Number) })
      // ...but does NOT clear the tournament — progress is preserved.
      expect(dispatch).not.toHaveBeenCalledWith('writeDurably', { path: 'settings/tieBreakTournament', value: null })

      // Reopening resumes the SAME tournament, one match further along.
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      expect(wrapper.text()).toContain('match 2 of 6')
    })

    // Bug report: a large tournament's final match "seemed frozen for 5-6
    // seconds" with no indication anything was happening. Two fixes: (1)
    // allMoviesRanked no longer does an O(n) getRating() call PER COMPARISON
    // across the whole library (see the sortResultsFast switch), and (2) the
    // spinner now genuinely tracks the score-adjustment writes instead of
    // flipping back to false the instant they're merely kicked off.
    it('keeps "submitting" true (and Done disabled) until every final-score write actually resolves', async () => {
      const dispatch = vi.fn()
      let resolveLastWrite
      dispatch.mockImplementation((action, entry) => {
        if (entry.path === 'movieLog/d') {
          return new Promise((resolve) => { resolveLastWrite = resolve })
        }
        return Promise.resolve()
      })
      const movies = fourWayMovies()
      const mockStore = {
        state: { currentLog: 'movieLog', settings: { tieBreakTournament: null } },
        getters: { allMoviesAsArray: movies },
        dispatch
      }
      const wrapper = mount(TweakInline, {
        global: { mocks: { $store: mockStore } },
        props: { allEntriesWithFlatKeywordsAdded: movies, showTweakModal: true }
      })

      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      for (let i = 0; i < 6; i++) {
        await wrapper.findAll('.poster-container')[0].trigger('click')
        await postersLoaded(wrapper)
      }

      // The results screen renders immediately (finalRanking is local/sync)...
      expect(wrapper.text()).toContain('Tournament Complete!')
      expect(wrapper.find('.tournament-results').exists()).toBe(true)

      // ...but the save is still in flight (movieLog/d's write hasn't
      // resolved), and the BUTTON is what says so. Bug report (2026-08-24):
      // "the spinner should be in the button and should disable the button
      // until we're done and then I can click done." A spinner on its own
      // line above a dead button read as two unrelated things.
      const doneBtn = wrapper.find('.tournament-done')
      expect(doneBtn.attributes('disabled')).toBeDefined()
      expect(doneBtn.text()).toContain('Saving scores')
      expect(doneBtn.find('.spinner-border').exists()).toBe(true)
      // Nothing outside the button claims to be saving.
      expect(wrapper.findAll('.spinner-border')).toHaveLength(1)

      resolveLastWrite()
      await vi.waitFor(() => expect(wrapper.find('.tournament-done').text()).toContain('Done'))
      const settled = wrapper.find('.tournament-done')
      expect(settled.attributes('disabled')).toBeUndefined()
      expect(settled.find('.spinner-border').exists()).toBe(false)
      expect(settled.text()).not.toContain('Saving')
    })
  })

  // Bug report: "tie break tournaments are only adjusting the score of one
  // movie. I will do a tournament with 5 contestants and get a whole ranking
  // and then it gives me a tournament with 4 of those same 5. And then 3."
  // One contestant's entry throwing mid-batch used to abandon every write
  // after it — exactly one movie escaped the tie per tournament.
  describe('score application resilience', () => {
    it("applies EVERY contestant's delta even when one entry's ratings came back object-shaped (the documented {...someArray} mangling)", () => {
      const movies = [
        movie('a', 'A', 7),
        movie('b', 'B', 7),
        // ratings as {0: …} instead of an array — .slice() throws on this,
        // which used to kill the writes for every rank after this one.
        { dbKey: 'c', movie: { id: 'c', title: 'C', poster_path: '/c.jpg' }, ratings: { 0: { calculatedTotal: 7, date: '2024-01-01', tweakValue: 0 } } },
        movie('d', 'D', 7),
        movie('e', 'E', 7)
      ]
      const { wrapper, dispatch } = mountTweak(movies)
      dispatch.mockClear()

      wrapper.vm.applyTournamentResults({
        finalRanking: [
          { dbKey: 'a', wins: 4, rank: 0 },
          { dbKey: 'b', wins: 3, rank: 1 },
          { dbKey: 'c', wins: 2, rank: 2 },
          { dbKey: 'd', wins: 1, rank: 3 },
          { dbKey: 'e', wins: 0, rank: 4 }
        ]
      })

      const byPath = Object.fromEntries(
        dispatch.mock.calls
          .filter(([, entry]) => entry.path.startsWith('movieLog/'))
          .map(([, entry]) => [entry.path, entry.value])
      )
      expect(Object.keys(byPath).sort()).toEqual(['movieLog/b', 'movieLog/c', 'movieLog/d', 'movieLog/e'])
      // The mangled entry is written back as a REAL array, normalized.
      expect(Array.isArray(byPath['movieLog/c'].ratings)).toBe(true)
      expect(byPath['movieLog/c'].ratings[0].tweakValue).toBeCloseTo(-0.001, 6)
      // And the ranks below it still received their own distinct deltas.
      expect(byPath['movieLog/d'].ratings[0].tweakValue).toBeCloseTo(-0.0015, 6)
      expect(byPath['movieLog/e'].ratings[0].tweakValue).toBeCloseTo(-0.002, 6)
    })

    it('a contestant deleted from the library mid-tournament is skipped without aborting the others', () => {
      const movies = [movie('a', 'A', 7), movie('b', 'B', 7), movie('c', 'C', 7)]
      const { wrapper, dispatch } = mountTweak(movies)
      dispatch.mockClear()

      wrapper.vm.applyTournamentResults({
        finalRanking: [
          { dbKey: 'a', wins: 2, rank: 0 },
          { dbKey: 'gone', wins: 1, rank: 1 },
          { dbKey: 'c', wins: 0, rank: 2 }
        ]
      })

      const paths = dispatch.mock.calls.map(([, entry]) => entry.path)
      expect(paths).toContain('movieLog/c')
      expect(paths).not.toContain('movieLog/gone')
    })
  })

  describe('an already-running tournament (freeze-out)', () => {
    it('does not start a new tournament, and ignores a movie that newly ties with the frozen group', () => {
      const existingTournament = {
        contestantIds: ['a', 'b'],
        schedule: [{ a: 'a', b: 'b' }],
        nextIndex: 0,
        wins: { a: 0, b: 0 },
        startedAt: Date.now(),
        finalRanking: null,
        completedAt: null
      }

      // 'c' now also has the same score as a/b, but the tournament already
      // in progress must not be touched or have 'c' merged into it.
      const movies = [movie('a', 'A', 8), movie('b', 'B', 8), movie('c', 'C', 8)]
      const { wrapper, dispatch } = mountTweak(movies, { tieBreakTournament: existingTournament })

      expect(dispatch).not.toHaveBeenCalledWith('writeDurably', expect.objectContaining({ path: 'settings/tieBreakTournament' }))

      const notice = wrapper.find('.prompt-card')
      expect(notice.exists()).toBe(true)
    })
  })

  // Regression test for a real bug report: with "force tiebreak to show" on
  // in settings, the showTweakModal PROP is pinned true and never toggles.
  // The original trigger was a watcher on showTweakModal *changing*, so it
  // fired once on mount and never again — after finishing one tournament,
  // the "you have another tie" notice would render but tapping it crashed/
  // went blank because no tournament existed for it to display.
  describe('showTweakModal pinned true throughout (forced-mode simulation)', () => {
    it('auto-starts the next tournament after Done, without showTweakModal ever toggling', async () => {
      // A 3-way tie, deliberately NOT 2-way — a 2-way tie now skips the
      // results screen/Done button entirely (see above), which would no
      // longer exercise the thing this regression test is actually about:
      // acknowledgeResults's watcher-independent restart after a Done tap.
      const movies = [movie('a', 'A', 8), movie('b', 'B', 8), movie('c', 'C', 8)]
      // showTweakModal: true, fixed prop, never changes — which is what the
      // 'forced' setting does in the real app, so say so explicitly: the
      // restart below is now conditional on it (see the delay test that
      // follows).
      const { wrapper, dispatch } = mountTweak(movies, { tieBreakPromptState: 'forced' })

      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      for (let i = 0; i < 3; i++) {
        await wrapper.findAll('.poster-container')[0].trigger('click')
        await postersLoaded(wrapper)
      }
      expect(wrapper.text()).toContain('Tournament Complete!')

      dispatch.mockClear()
      await wrapper.find('.btn').trigger('click') // "Done"

      // A fresh tournament must exist immediately — not "eventually", and
      // not left null waiting for a prop change that will never come.
      const restarted = [...dispatch.mock.calls].reverse().find(([, e]) => e.path === 'settings/tieBreakTournament')
      expect(restarted[1].value).not.toBeNull()

      // Tapping the notice must show an actual, playable matchup — not a
      // blank/crashed panel.
      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      expect(wrapper.findAll('.poster-container')).toHaveLength(2)
      expect(wrapper.text()).not.toContain('Tournament Complete!')
    })
  })

  // Bug report, 2026-08-20: "I just finished a tie break tournament and it is
  // immediately offering me another one. There is supposed to be a delay
  // between prompts."
  //
  // The counterpart to the forced-mode test above: in ORDINARY use the eager
  // restart is what defeated the delay, because Home pins the prompt open for
  // as long as a tournament record exists and only consults the daily quota
  // when there is none.
  describe('the delay between tournaments (not forced)', () => {
    it('does not start the next tournament on "Done", even with another tied group waiting', async () => {
      // One contiguous tied run of 3 to play through, plus a second pair tied
      // on a different score — so there is definitely another group sitting
      // there for the eager restart to have grabbed.
      const movies = [
        movie('a', 'A', 8), movie('b', 'B', 8), movie('c', 'C', 8),
        movie('d', 'D', 6), movie('e', 'E', 6)
      ]
      const { wrapper, dispatch } = mountTweak(movies)

      await wrapper.find('.prompt-card').trigger('click')
      await postersLoaded(wrapper)
      for (let i = 0; i < 3; i++) {
        await wrapper.findAll('.poster-container')[0].trigger('click')
        await postersLoaded(wrapper)
      }
      expect(wrapper.text()).toContain('Tournament Complete!')

      dispatch.mockClear()
      await wrapper.find('.btn').trigger('click') // "Done"

      // The record is cleared and the quota clock is stamped...
      expect(lastDispatchTo(dispatch, 'settings/tieBreakTournament')).toBeNull()
      expect(lastDispatchTo(dispatch, 'settings/lastTweak')).toEqual(expect.any(Number))

      // ...and crucially, nothing writes a NEW tournament on the way out. A
      // record here is what re-opened the prompt on the spot, since Home
      // treats an existing record as work in progress and skips the delay.
      const writes = dispatch.mock.calls.filter(([, e]) => e.path === 'settings/tieBreakTournament')
      expect(writes).toHaveLength(1)
      expect(writes[0][1].value).toBeNull()
    })
  })
})

// Bug report (2026-09-13): opened from a chore notification, the prompt
// should already be the tournament, not the card that asks for a tap.
describe('TweakInline autoOpen', () => {
  const tied = () => [movie('a', 'A', 8), movie('b', 'B', 8), movie('c', 'C', 6)]

  function mountWith (movies, props) {
    return mount(TweakInline, {
      global: { mocks: { $store: { state: { currentLog: 'movieLog', settings: { tieBreakTournament: null, tieBreakPromptState: 'auto' } }, getters: { allMoviesAsArray: movies }, dispatch: vi.fn() } } },
      props: { allEntriesWithFlatKeywordsAdded: movies, showTweakModal: true, ...props }
    })
  }

  it('opens the tournament straight away when asked to and a tie is waiting', async () => {
    const wrapper = mountWith(tied(), { autoOpen: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.prompt-card').exists()).toBe(false)
    expect(wrapper.find('.tweak-container').exists()).toBe(true)
  })

  it('still shows the card first when not asked to', () => {
    const wrapper = mountWith(tied(), {})
    expect(wrapper.find('.prompt-card').exists()).toBe(true)
  })

  // The tie scan reads the STORE getter, not the prop (see tiedGroupDbKeys),
  // so the films have to land there — a reactive mock stands in for
  // Firebase filling the library after the request arrived.
  it('opens once the films arrive, when the request came first', async () => {
    const store = reactive({
      state: { currentLog: 'movieLog', settings: { tieBreakTournament: null, tieBreakPromptState: 'auto' } },
      getters: { allMoviesAsArray: [] },
      dispatch: vi.fn()
    })
    const wrapper = mount(TweakInline, {
      global: { mocks: { $store: store } },
      props: { allEntriesWithFlatKeywordsAdded: [], showTweakModal: true, autoOpen: true }
    })
    expect(wrapper.find('.tweak-container').exists()).toBe(false)

    store.getters.allMoviesAsArray = tied()
    await wrapper.setProps({ allEntriesWithFlatKeywordsAdded: tied() })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.tweak-container').exists()).toBe(true)
  })
})
