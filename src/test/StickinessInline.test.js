import { describe, it, expect, vi } from 'vitest';
import { mount } from '@vue/test-utils';
import StickinessInline from '@/components/StickinessInline.vue';

vi.mock('@/assets/javascript/GetRating.js', async () => {
  // Deliberately mirrors the REAL GetRating.js contract, including the bit
  // this suite exists to protect: it bails when ratings has no `.length`,
  // which is exactly what an object-spread `ratings` produced.
  const getRating = (media) => {
    if (!media?.ratings?.length) return { calculatedTotal: 0 };
    const mostRecent = [...media.ratings].sort((a, b) => new Date(b.date) - new Date(a.date))[0];
    return { ...mostRecent, calculatedTotal: 5 };
  };
  return { getRating };
});

function daysAgo (days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}

// Rated 30 days ago: past the one-week threshold (so it's due for the
// first stickiness pass) but NOT past six months, so once that pass is
// recorded it should drop out of the queue entirely. Relative to now
// rather than a fixed date, so it can't drift into the six-month window
// as time passes.
function staleEntry (id, ratedDaysAgo = 30) {
  return {
    dbKey: `key-${id}`,
    movie: { id, title: `Movie ${id}`, poster_path: '/p.jpg' },
    ratings: [{ date: daysAgo(ratedDaysAgo), love: 5, overall: 5, stickiness: 2 }]
  };
}

// The real writeDurably commits to local state synchronously, which is what
// makes the queue shrink as you go. The mock mirrors that by applying the
// write back onto the fixture, so resultsThatNeedStickiness behaves the way
// it does in the app rather than looking permanently un-rated.
function factory (entries) {
  const dispatch = vi.fn((action, dbEntry) => {
    if (action !== 'writeDurably' || !dbEntry?.path?.startsWith('movieLog/')) return;
    const target = entries.find((e) => e.dbKey === dbEntry.path.split('movieLog/')[1]);
    if (target) target.ratings = dbEntry.value.ratings;
  });
  const wrapper = mount(StickinessInline, {
    global: {
      mocks: {
        $store: {
          state: { currentLog: 'movieLog', settings: {} },
          getters: { allMoviesAsArray: entries },
          dispatch
        }
      }
    },
    props: { allEntriesWithFlatKeywordsAdded: entries, showStickinessModal: true, now: Date.now() }
  });
  return { wrapper, dispatch };
}

describe('StickinessInline', () => {
  // Bug report, 2026-08-20: "I don't like the language on the stickiness
  // prompt like 'you've had time to sit with' isn't that great? Can you
  // reword that to me a bit more direct?" The other prompt cards state a
  // plain fact and leave the verb to the action link.
  describe('the prompt copy', () => {
    it('says plainly what is wanted, not how long it has been', () => {
      const { wrapper } = factory([staleEntry(1), staleEntry(2)]);

      expect(wrapper.find('.prompt-text').text()).toBe('2 movies are ready for a stickiness score.');
      expect(wrapper.text()).not.toContain('sit with');
    });

    it('agrees with itself for a single movie', () => {
      const { wrapper } = factory([staleEntry(1)]);

      expect(wrapper.find('.prompt-text').text()).toBe('1 movie is ready for a stickiness score.');
    });
  });

  it('lists entries that are due for a stickiness rating', () => {
    const { wrapper } = factory([staleEntry(1), staleEntry(2)]);
    expect(wrapper.vm.resultsThatNeedStickiness).toHaveLength(2);
  });

  // The regression this suite exists for: `ratings` must stay an ARRAY.
  // Building it with an object spread produced {0: …} with no `.length`,
  // which makes GetRating fall back to {calculatedTotal: 0} - stripping the
  // date and the userAddedStickiness flag, so the movie immediately
  // re-entered the queue and its score read as 0.
  it('writes ratings back as a real array, preserving the entry through GetRating', async () => {
    const { wrapper, dispatch } = factory([staleEntry(1), staleEntry(2)]);
    wrapper.vm.showStickinessInline = true;
    wrapper.vm.stickinessRating = '4';

    wrapper.vm.addStickinessRating();

    const [action, dbEntry] = dispatch.mock.calls.find(([, e]) => e?.path?.startsWith('movieLog/'));
    expect(action).toBe('writeDurably');
    expect(Array.isArray(dbEntry.value.ratings)).toBe(true);
    expect(dbEntry.value.ratings).toHaveLength(1);
    expect(dbEntry.value.ratings[0].userAddedStickiness).toBe(true);
    expect(dbEntry.value.ratings[0].stickiness).toBe(4);
    // The date must survive - losing it is what made the movie look
    // "rated in 2021" and therefore permanently due again.
    expect(dbEntry.value.ratings[0].date).toBeTruthy();
  });

  it('marks the six-month pass once the one-week one is already done', () => {
    const entry = staleEntry(1, 400); // old enough for the six-month window
    entry.ratings[0].userAddedStickiness = true;
    const { wrapper, dispatch } = factory([entry]);
    wrapper.vm.showStickinessInline = true;
    wrapper.vm.stickinessRating = '3';

    wrapper.vm.addStickinessRating();

    const [, dbEntry] = dispatch.mock.calls.find(([, e]) => e?.path?.startsWith('movieLog/'));
    expect(dbEntry.value.ratings[0].userAddedSixMonthStickiness).toBe(true);
    expect(Array.isArray(dbEntry.value.ratings)).toBe(true);
  });

  // Bug report: "after each one it should just immediately take me to the
  // next stickiness that is ready to go."
  it('stays on the form when more entries remain', () => {
    const { wrapper } = factory([staleEntry(1), staleEntry(2)]);
    wrapper.vm.showStickinessInline = true;
    wrapper.vm.stickinessRating = '4';

    wrapper.vm.addStickinessRating();

    expect(wrapper.vm.showStickinessInline).toBe(true); // one still to go
  });

  // The other half of the same fix: a saved entry must actually LEAVE the
  // queue. Before the array fix it came straight back - GetRating fell back
  // to {calculatedTotal: 0}, losing the date and the userAddedStickiness
  // flag, so the filter read it as "never rated, watched in 2021".
  // Asserted by feeding the ACTUAL written payload back through a fresh
  // mount (rather than mutating the prop in place, which wouldn't
  // invalidate the computed).
  it('a saved entry no longer qualifies for the queue', () => {
    const { wrapper, dispatch } = factory([staleEntry(1)]);
    wrapper.vm.showStickinessInline = true;
    wrapper.vm.stickinessRating = '4';
    wrapper.vm.addStickinessRating();

    const [, dbEntry] = dispatch.mock.calls.find(([, e]) => e?.path?.startsWith('movieLog/'));
    const savedEntry = { ...staleEntry(1), ratings: dbEntry.value.ratings };

    const { wrapper: rechecked } = factory([savedEntry]);
    expect(rechecked.vm.resultsThatNeedStickiness).toHaveLength(0);
  });
});

// Bug report (2026-09-13): opened from a chore notification, the prompt
// should already be the form, not the card that asks for a tap.
describe('StickinessInline autoOpen', () => {
  function mountWith (entries, props) {
    return mount(StickinessInline, {
      global: {
        mocks: {
          $store: { state: { currentLog: 'movieLog', settings: {} }, getters: { allMoviesAsArray: entries }, dispatch: vi.fn() }
        }
      },
      props: { allEntriesWithFlatKeywordsAdded: entries, showStickinessModal: true, now: Date.now(), ...props }
    });
  }

  it('opens the form straight away when asked to and there is something to rate', () => {
    const wrapper = mountWith([staleEntry(1)], { autoOpen: true });
    expect(wrapper.find('.stickiness-container').exists()).toBe(true);
    expect(wrapper.find('.prompt-card').exists()).toBe(false);
  });

  it('still shows the card first when not asked to', () => {
    const wrapper = mountWith([staleEntry(1)], {});
    expect(wrapper.find('.prompt-card').exists()).toBe(true);
    expect(wrapper.find('.stickiness-container').exists()).toBe(false);
  });

  it('opens when the request arrives after the prompt is already on screen', async () => {
    const wrapper = mountWith([staleEntry(1)], {});
    await wrapper.setProps({ autoOpen: true });
    expect(wrapper.find('.stickiness-container').exists()).toBe(true);
  });

  it('opens once the films arrive, when the request came first', async () => {
    const wrapper = mountWith([], { autoOpen: true });
    expect(wrapper.find('.stickiness-container').exists()).toBe(false);
    await wrapper.setProps({ allEntriesWithFlatKeywordsAdded: [staleEntry(1)] });
    expect(wrapper.find('.stickiness-container').exists()).toBe(true);
  });
});
