import { describe, it, expect, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import FilmClubScreen from '@/components/FilmClubScreen.vue';
import SettingsSection from '@/components/SettingsSection.vue';

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => ({ calculatedTotal: media?.ratings?.[0]?.calculatedTotal ?? 0 }))
}));

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function myMovie (id, title, rating) {
  return {
    dbKey: `k${id}`,
    ratings: [{ calculatedTotal: rating, date: Date.now() - DAY }],
    movie: { id, title, poster_path: `/${id}.jpg`, release_date: '2001-06-15' }
  };
}

function factory ({ profiles = {}, myEntries = [] } = {}) {
  return shallowMount(FilmClubScreen, {
    global: {
      stubs: { SettingsSection: false, BackLink: true },
      mocks: {
        $store: {
          state: {
            settings: {},
            federatedDirectory: [],
            federatedDirectoryLoading: false,
            socialDirectory: {},
            socialRequests: {},
            clubInbox: {}
          },
          getters: {
            socialSettings: { enabled: true, displayName: 'Matt' },
            crossAppDiscoveryEnabled: false,
            allMoviesAsArray: myEntries,
            filmClubProfiles: profiles,
            filmClubFriends: Object.entries(profiles).map(([key, profile]) => ({
              key, name: profile.name, profile, external: false
            })),
            socialFriendKeys: Object.keys(profiles),
            socialUserKey: 'me',
            socialPendingSentKeys: []
          },
          dispatch: vi.fn(() => Promise.resolve()),
          commit: vi.fn()
        },
        $route: { query: {} },
        $router: { push: vi.fn() }
      }
    }
  });
}

const PROFILES = {
  brian: {
    name: 'Brian',
    counts: { titles: 2 },
    ratings: { 1: { r: 9 }, 2: { r: 3 } },
    recent: [{ id: 1, t: 'Heat', p: '/1.jpg', r: 9, at: Date.now() - 3 * HOUR }]
  }
};

describe('FilmClubScreen', () => {
  // "I have to scroll pretty far down before I can, like, select a friend and
  // look at what they've got going on." (Matt, 2026-08-16)
  it('puts the friends list above the club-wide lists', () => {
    const wrapper = factory({ profiles: PROFILES, myEntries: [myMovie(1, 'Heat', 8), myMovie(2, 'Cats', 9)] });
    const titles = wrapper.findAll('.cs-section-title').map((title) => title.text());

    const friends = titles.indexOf('Friends');
    const favorites = titles.indexOf('Club favorites');

    expect(friends).toBeGreaterThanOrEqual(0);
    expect(favorites).toBeGreaterThan(friends);
  });

  it('keeps the recently-watched feed at the very top', () => {
    const wrapper = factory({ profiles: PROFILES, myEntries: [myMovie(1, 'Heat', 8)] });
    const titles = wrapper.findAll('.cs-section-title').map((title) => title.text());

    expect(titles[0]).toBe('Recently watched');
  });

  // 2026-08-31: "We're showing their raw scores. I think I'd rather show
  // their star ratings." A friend's `r` is on their own scale, so it doesn't
  // compare to anyone else's; the stars behind it do.
  it('shows a friend stars rather than their raw score', () => {
    const starred = {
      brian: { ...PROFILES.brian, recent: [{ ...PROFILES.brian.recent[0], s: 4.5 }] }
    };
    const wrapper = factory({ profiles: starred, myEntries: [myMovie(1, 'Heat', 8)] });
    const note = wrapper.find('.cs-poster-note');

    expect(note.text()).toContain('Brian');
    expect(note.text()).not.toContain('9.00');
    expect(note.findAll('.bi-star-fill').length).toBe(4);
    expect(note.findAll('.bi-star-half').length).toBe(1);
  });

  // A shelf-only sharer publishes no stars anywhere; a blank pill would be
  // worse than the score we already have.
  it('falls back to the score when a friend publishes no stars', () => {
    const wrapper = factory({
      profiles: { brian: { ...PROFILES.brian, ratings: {} } },
      myEntries: [myMovie(1, 'Heat', 8)]
    });

    expect(wrapper.find('.cs-poster-stars').exists()).toBe(false);
    expect(wrapper.find('.cs-poster-score').text()).toBe('9.00');
  });

  it('says how long ago each viewing was', () => {
    const wrapper = factory({ profiles: PROFILES, myEntries: [myMovie(1, 'Heat', 8)] });

    expect(wrapper.find('.cs-poster-when').text()).toBe('3 hours ago');
    expect(wrapper.vm.watchedAgo(null)).toBeNull();
  });

  // "It feels like it takes up too much space vertically. Let's give that its
  // own little section in a independent scrolling."
  it('scrolls the club favorites and most-divisive lists in place', () => {
    const wrapper = factory({ profiles: PROFILES, myEntries: [myMovie(1, 'Heat', 8), myMovie(2, 'Cats', 9)] });

    expect(wrapper.findAll('.cs-scroll-list').length).toBe(2);
  });

  // "The sections about... finding friends in other apps, and finding people
  // [should] be somehow their own, like, maybe collapsible accordion."
  it('collapses the finding-people sections, and leaves Friends open', () => {
    const wrapper = factory({ profiles: PROFILES, myEntries: [myMovie(1, 'Heat', 8)] });
    const accordions = wrapper.findAllComponents(SettingsSection);

    expect(accordions.map((section) => section.props('title')))
      .toEqual(['Friends on other apps', 'Find people']);
    accordions.forEach((section) => {
      expect(section.props('collapsible')).toBe(true);
      expect(section.props('startOpen')).toBe(false);
    });

    // Friends is a plain section, not one of the accordions.
    expect(wrapper.findAll('.cs-section-title').map((t) => t.text())).toContain('Friends');
  });
});

// "Clicking a poster on the recent friends feed takes me to that movie in my
// db. But if I haven't seen that movie, it should instead take me nowhere.
// But we should have the universal 'add to hat' button on it so I can add it
// to a hat." (2026-08-17)
//
// MovieDetail is a pure lookup in YOUR library, so a friend's film you've
// never rated rendered an empty page rather than saying anything useful.
describe('FilmClubScreen feed taps', () => {
  const seenAndUnseen = {
    brian: {
      name: 'Brian',
      counts: { titles: 2 },
      ratings: { 1: { r: 9 }, 7: { r: 8 } },
      recent: [
        { id: 1, t: 'Heat', p: '/1.jpg', r: 9, at: Date.now() - 2 * HOUR },
        { id: 7, t: 'Unseen By Me', p: '/7.jpg', r: 8, at: Date.now() - 3 * HOUR }
      ]
    }
  };

  function feedScreen () {
    return factory({ profiles: seenAndUnseen, myEntries: [myMovie(1, 'Heat', 8)] });
  }

  it('opens a movie that is in your library', () => {
    const wrapper = feedScreen();
    const push = wrapper.vm.$router.push;

    wrapper.vm.openFeedItem({ id: 1, t: 'Heat' });

    expect(push).toHaveBeenCalledWith('/movie/1');
  });

  // Bug report, 2026-08-20: "if it's one that I have not yet rated... just
  // clicking the poster should pull up some kind of a summary of the movie so
  // that I can investigate further." This used to do nothing at all — a dead
  // poster — because MovieDetail is a local lookup and would render an empty
  // page for a film you've never rated.
  it('opens a summary for a movie you have never rated, rather than nothing at all', () => {
    const wrapper = feedScreen();
    const push = wrapper.vm.$router.push;

    wrapper.vm.openFeedItem({ id: 7, t: 'Unseen By Me', p: '/u.jpg' });

    expect(wrapper.vm.previewing).toMatchObject({ id: 7, title: 'Unseen By Me', poster_path: '/u.jpg' });
    // Still not navigating — the empty detail page is what this avoids.
    expect(push).not.toHaveBeenCalled();
  });

  it('hands the summary a hat-shaped movie, so rating from it has real fields', () => {
    const wrapper = feedScreen();

    wrapper.vm.openFeedItem({ id: 7, t: 'Unseen By Me', p: '/u.jpg' });

    expect(wrapper.vm.previewing.source).toMatchObject({ id: 7, title: 'Unseen By Me', poster_path: '/u.jpg' });
  });

  it('rating from the summary closes it and hands off to the rating flow', () => {
    const wrapper = feedScreen();
    const push = wrapper.vm.$router.push;
    const commit = wrapper.vm.$store.commit;

    wrapper.vm.openFeedItem({ id: 7, t: 'Unseen By Me', p: '/u.jpg' });
    wrapper.vm.rateFromPreview(wrapper.vm.previewing.source);

    expect(commit).toHaveBeenCalledWith('setMovieToRate', expect.objectContaining({ id: 7 }));
    expect(push).toHaveBeenCalledWith('/rate-movie');
    expect(wrapper.vm.previewing).toBeNull();
  });

  it('knows which feed items are in your library', () => {
    const wrapper = feedScreen();

    expect(wrapper.vm.inMyLibrary(1)).toBe(true);
    expect(wrapper.vm.inMyLibrary(7)).toBe(false);
    expect(wrapper.vm.inMyLibrary(null)).toBe(false);
  });

  // A feed item is a bare {id,t,p}, not a library entry — toHatMovie takes
  // either, but it reads TMDB field names.
  it('converts a feed item into something the hat understands', () => {
    const wrapper = feedScreen();

    expect(wrapper.vm.hatMovieFor({ id: 7, t: 'Unseen By Me', p: '/7.jpg' }))
      .toMatchObject({ id: 7, title: 'Unseen By Me', poster_path: '/7.jpg' });
  });

  // Two decimals, always (bug report 2026-08-18). 8.25 used to render as
  // "8.3" here, which is a score Brian never gave anything.
  it('labels the hat note with who watched it and what they gave it', () => {
    const wrapper = feedScreen();

    expect(wrapper.vm.feedNote({ friendName: 'Brian', r: 8.25 }))
      .toBe('Brian watched this (8.25)');
    expect(wrapper.vm.feedNote({ friendName: 'Brian', r: null }))
      .toBe('Brian watched this');
  });
});

// Bug report (2026-08-22): "In film club, we show lists of each friend's
// recent movies but they seem to be limited to just four movies. We should
// increase that so it's a scrollable horizontal list. Don't mess with the
// size of the posters just load more. And we don't want to load thousands of
// movies every time so these should be lazy loaded only when I scroll to see
// more."
describe("a friend's recent-poster strip", () => {
  // The published profile carries 40; the cap that produced "just four" was
  // friendSnapshot's recentCount default.
  const busyFriend = (count) => ({
    brian: {
      name: 'Brian',
      counts: { titles: count },
      ratings: {},
      recent: Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        t: `Film ${index + 1}`,
        p: `/${index + 1}.jpg`,
        r: 8,
        at: Date.now() - (index + 1) * HOUR
      }))
    }
  });

  // A scrollable strip stubbed at a width that shows part of it, with the
  // scroll position under the test's control — jsdom lays nothing out.
  function stripAt (wrapper, { scrollLeft, clientWidth = 300, scrollWidth = 1000 }) {
    const strip = wrapper.find('.cs-friend-posters');
    return { target: { scrollLeft, clientWidth, scrollWidth }, element: strip.element };
  }

  it('renders more than the four it used to, but not all forty at once', () => {
    const wrapper = factory({ profiles: busyFriend(40) });

    const posters = wrapper.findAll('.cs-friend-poster');
    expect(posters.length).toBeGreaterThan(4);
    expect(posters.length).toBeLessThan(40);
  });

  it('keeps the whole list available to page through', () => {
    const wrapper = factory({ profiles: busyFriend(40) });

    expect(wrapper.vm.friendRows[0].recent).toHaveLength(40);
  });

  it('loads the next page only once you scroll to the end', async () => {
    const wrapper = factory({ profiles: busyFriend(40) });
    const before = wrapper.findAll('.cs-friend-poster').length;
    const friend = wrapper.vm.friendRows[0];

    // Barely moved: nothing new, no extra image requests.
    wrapper.vm.growFriendPosters(friend, stripAt(wrapper, { scrollLeft: 10 }));
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.cs-friend-poster').length).toBe(before);

    // At the end: the next page arrives.
    wrapper.vm.growFriendPosters(friend, stripAt(wrapper, { scrollLeft: 700 }));
    await wrapper.vm.$nextTick();
    expect(wrapper.findAll('.cs-friend-poster').length).toBeGreaterThan(before);
  });

  it('stops growing at the end of what the friend published', async () => {
    const wrapper = factory({ profiles: busyFriend(40) });
    const friend = wrapper.vm.friendRows[0];

    for (let i = 0; i < 20; i += 1) {
      wrapper.vm.growFriendPosters(friend, stripAt(wrapper, { scrollLeft: 700 }));
    }
    await wrapper.vm.$nextTick();

    expect(wrapper.findAll('.cs-friend-poster').length).toBe(40);
  });

  it('leaves a friend with only a couple of films alone', () => {
    const wrapper = factory({ profiles: busyFriend(2) });

    expect(wrapper.findAll('.cs-friend-poster')).toHaveLength(2);
  });
});

// Report -P1lQnAdARMxUpPScybv (2026-09-17): "It would be cool to be able to
// search my film club to see if anybody has watched a specific movie... have
// it filter to show me who's seen it and who hasn't."
describe('FilmClubScreen — "Has anybody seen…"', () => {
  const SEARCH_PROFILES = {
    brian: {
      name: 'Brian',
      counts: { titles: 2 },
      // Shares his whole library, so silence from him is evidence.
      ratings: { 1: { r: 9, s: 4.5 }, 2: { r: 3 } },
      recent: []
    },
    seth: {
      name: 'Seth',
      counts: { titles: 1 },
      // Shelf only: no `ratings` map at all.
      recent: [{ id: 2, t: 'Cats', p: '/2.jpg', r: 7, at: Date.now() - HOUR }],
      topShelf: []
    }
  };

  const mountWithClub = () => factory({
    profiles: SEARCH_PROFILES,
    myEntries: [myMovie(1, 'Heat', 8), myMovie(2, 'Cats', 9)]
  });

  it('searches every title the club knows about, not just mine', async () => {
    const wrapper = mountWithClub();
    expect(wrapper.vm.clubTitles.map((t) => t.title)).toEqual(['Cats', 'Heat']);

    await wrapper.setData({ seenSearch: 'hea' });
    expect(wrapper.vm.seenMatches.map((t) => t.title)).toEqual(['Heat']);
  });

  it('splits the club into seen, hasn\'t seen, and no way to tell', async () => {
    const wrapper = mountWithClub();
    await wrapper.setData({ seenPick: { id: '1', title: 'Heat' } });

    const { seen, notSeen, unknown, youveSeen } = wrapper.vm.seenBreakdown;
    expect(seen.map((p) => p.name)).toEqual(['Brian']);
    expect(seen[0].stars).toBe(4.5);
    // Seth publishes no ratings map, so his silence is NOT "hasn't seen it".
    expect(notSeen).toEqual([]);
    expect(unknown.map((p) => p.name)).toEqual(['Seth']);
    expect(youveSeen).toBe(true);
  });

  it('will say a full sharer hasn\'t seen something', async () => {
    const wrapper = mountWithClub();
    await wrapper.setData({ seenPick: { id: '99', title: 'Solaris' } });
    expect(wrapper.vm.seenBreakdown.notSeen.map((p) => p.name)).toEqual(['Brian']);
    expect(wrapper.vm.seenBreakdown.youveSeen).toBe(false);
  });

  it('takes a shelf-only friend\'s own feed as proof they have seen it', async () => {
    const wrapper = mountWithClub();
    await wrapper.setData({ seenPick: { id: '2', title: 'Cats' } });
    expect(wrapper.vm.seenBreakdown.seen.map((p) => p.name)).toEqual(['Brian', 'Seth']);
  });

  it('clears the box along with the pick', async () => {
    const wrapper = mountWithClub();
    await wrapper.setData({ seenSearch: 'heat', seenPick: { id: '1', title: 'Heat' } });
    wrapper.vm.clearSeenPick();
    expect(wrapper.vm.seenPick).toBe(null);
    expect(wrapper.vm.seenSearch).toBe('');
  });
});
