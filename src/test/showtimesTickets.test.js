import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mount, flushPromises } from '@vue/test-utils';
import { reactive } from 'vue';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { ticketsMark, isTicketsMark, filmCopies, ticketFilms } from '@/assets/javascript/showtimesTickets.js';
import { showtimesWaiting, hasUnseenShowtimes } from '@/assets/javascript/showtimesUnread.js';

vi.mock('@/utils/posterLookup.js', () => ({
  lookupFilm: vi.fn(() => Promise.resolve(null)),
  titleWithYear: (title, year) => (year ? `${title} (${year})` : title)
}));

// "There should be a third option for my Showtimes screens … swipe right to
// dismiss, swipe left to snooze, and then there should be a third way that I
// can mark as that I got tickets" - then: "a long press on the poster, and
// then it like confirms and I tap a got tickets button" (Matt, 2026-10-27).

const BOARD = {
  updatedAt: Date.now(),
  theaters: [
    { key: 'alamo', name: 'Alamo', ok: true, listings: [
      { slug: 'dune', title: 'Dune: Part Three', year: 2026, poster: 'p.jpg', firstShowTime: '2099-01-02T19:00:00' },
      { slug: 'heat', title: 'Heat', year: 1995, poster: 'p.jpg', firstShowTime: '2099-01-03T19:00:00' }
    ] },
    { key: 'imax', name: 'IMAX', ok: true, listings: [
      { slug: 'dune-imax', title: 'Dune: Part Three (IMAX)', year: 2026, poster: 'p.jpg', firstShowTime: '2099-01-02T20:00:00', coveredBy: 'alamo' }
    ] }
  ]
};

describe('Got tickets, the stored mark', () => {
  it('is a dismissal with a note, so every "is it dismissed" reader skips it', () => {
    const mark = ticketsMark(5);
    expect(mark).toEqual({ at: 5, tickets: true });
    expect(isTicketsMark(mark)).toBe(true);
    expect(isTicketsMark(5)).toBe(false);
    expect(isTicketsMark(null)).toBe(false);
    const dismissed = { alamo: { dune: mark } };
    // The badge and the Watchlist dot stop counting it, with no change of their own.
    expect(showtimesWaiting({ board: BOARD, dismissed })).toBe(1);
    expect(hasUnseenShowtimes({ board: { theaters: [{ key: 'alamo', listings: [{ slug: 'dune', title: 'Dune', firstSeenAt: 10 }] }] }, dismissed, seenAt: 0 })).toBe(false);
  });

  it('is for the film at every theater on the board', () => {
    expect(filmCopies(BOARD.theaters, 'Dune: Part Three')).toEqual([
      { theaterKey: 'alamo', slug: 'dune' },
      { theaterKey: 'imax', slug: 'dune-imax' }
    ]);
    expect(filmCopies(BOARD.theaters, 'Heat')).toEqual([{ theaterKey: 'alamo', slug: 'heat' }]);
    expect([...ticketFilms(BOARD.theaters, { imax: { 'dune-imax': ticketsMark(1) }, alamo: { heat: 9 } })]).toEqual(['dune part three']);
  });

  it('stores the mark through the store, the durable way dismissals go', () => {
    const store = readFileSync(resolve(process.cwd(), 'src/store/index.js'), 'utf8');
    expect(store).toMatch(/dismissListing \(context, \{ theaterKey, slug, restore = false, tickets = false \}\)/);
    expect(store).toContain('tickets ? ticketsMark(Date.now()) : Date.now()');
  });
});

describe('Got tickets, on the Showtimes screen', () => {
  let ShowtimesScreen;
  let state;
  let dispatch;

  beforeEach(async () => {
    vi.useFakeTimers();
    ShowtimesScreen = (await import('@/components/ShowtimesScreen.vue')).default;
    state = reactive({
      theaterBoard: BOARD,
      theaterFollow: null,
      theaterDismissed: {},
      theaterReminders: { imax: { 'dune-imax': { remindAt: 1 } } },
      databaseTopKey: 'tester'
    });
    dispatch = vi.fn(() => Promise.resolve());
  });
  afterEach(() => vi.useRealTimers());

  async function mountScreen () {
    const wrapper = mount(ShowtimesScreen, {
      global: {
        mocks: { $store: { state, dispatch }, $route: { query: {}, path: '/showtimes' }, $router: { push: vi.fn(), replace: vi.fn(() => Promise.resolve()) } },
        stubs: { BackLink: true, SkeletonBlock: true }
      }
    });
    await flushPromises();
    return wrapper;
  }
  const card = (wrapper, id) => wrapper.find(`[data-card="${id}"]`);
  const touch = (x, y) => ({ touches: [{ clientX: x, clientY: y }] });

  it('a hold lifts the card, letting go opens the sheet, and the link stays shut', async () => {
    const wrapper = await mountScreen();
    const dune = card(wrapper, 'alamo/dune');
    await dune.trigger('touchstart', touch(100, 100));
    vi.advanceTimersByTime(520);
    await wrapper.vm.$nextTick();
    expect(dune.classes()).toContain('pressed');
    await dune.trigger('touchend');
    expect(dune.find('.st-sheet').exists()).toBe(true);
    expect(dune.find('.st-sheet').text()).toContain('Got tickets for Dune: Part Three?');
    // The click iOS sends after the lift doesn't follow the poster's link.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true });
    dune.find('.st-card-link').element.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
    expect(dispatch).not.toHaveBeenCalledWith('dismissListing', expect.anything());
  });

  it('moving during the hold calls it off, so scrolling and swipes are unchanged', async () => {
    const wrapper = await mountScreen();
    const dune = card(wrapper, 'alamo/dune');
    await dune.trigger('touchstart', touch(100, 100));
    await dune.trigger('touchmove', touch(100, 140));
    vi.advanceTimersByTime(600);
    await dune.trigger('touchend');
    expect(dune.classes()).not.toContain('pressed');
    expect(dune.find('.st-sheet').exists()).toBe(false);
    // A quick tap is still a tap: no sheet.
    await dune.trigger('touchstart', touch(100, 100));
    vi.advanceTimersByTime(200);
    await dune.trigger('touchend');
    expect(dune.find('.st-sheet').exists()).toBe(false);
  });

  it('Got tickets marks every copy of the film and cancels its reminder', async () => {
    const wrapper = await mountScreen();
    const dune = card(wrapper, 'alamo/dune');
    await dune.trigger('touchstart', touch(100, 100));
    vi.advanceTimersByTime(520);
    await dune.trigger('touchend');
    await dune.find('.st-sheet-yes').trigger('click');
    vi.advanceTimersByTime(200);
    expect(dispatch).toHaveBeenCalledWith('dismissListing', { theaterKey: 'alamo', slug: 'dune', tickets: true });
    expect(dispatch).toHaveBeenCalledWith('dismissListing', { theaterKey: 'imax', slug: 'dune-imax', tickets: true });
    expect(dispatch).toHaveBeenCalledWith('remindListing', { theaterKey: 'imax', slug: 'dune-imax', reminder: null });
    expect(dispatch).not.toHaveBeenCalledWith('dismissListing', expect.objectContaining({ slug: 'heat' }));
  });

  it('Cancel just closes the sheet', async () => {
    const wrapper = await mountScreen();
    const dune = card(wrapper, 'alamo/dune');
    await dune.trigger('touchstart', touch(100, 100));
    vi.advanceTimersByTime(520);
    await dune.trigger('touchend');
    await dune.find('.st-sheet-cancel').trigger('click');
    expect(dune.find('.st-sheet').exists()).toBe(false);
    vi.advanceTimersByTime(200);
    expect(dispatch).not.toHaveBeenCalledWith('dismissListing', expect.anything());
  });

  it('ticketed films have their own pill, label and undo, apart from dismissed', async () => {
    state.theaterDismissed = { alamo: { dune: ticketsMark(1), heat: 2 }, imax: { 'dune-imax': ticketsMark(1) } };
    const wrapper = await mountScreen();
    expect(card(wrapper, 'alamo/dune').exists()).toBe(false);
    const pill = wrapper.find('[aria-label="Show 1 film you have tickets for"]');
    expect(pill.exists()).toBe(true);
    // Heat is the one dismissed film; Dune isn't counted there.
    expect(wrapper.find('[aria-label="Show 1 dismissed"]').exists()).toBe(true);
    await pill.trigger('click');
    const dune = card(wrapper, 'alamo/dune');
    expect(dune.find('.st-tag.tickets').exists()).toBe(true);
    await dune.find('[aria-label="Undo got tickets for Dune: Part Three"]').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('dismissListing', { theaterKey: 'alamo', slug: 'dune', restore: true });
    expect(dispatch).toHaveBeenCalledWith('dismissListing', { theaterKey: 'imax', slug: 'dune-imax', restore: true });
    expect(dispatch).not.toHaveBeenCalledWith('dismissListing', expect.objectContaining({ slug: 'heat', restore: true }));
  });

  it('turns off the iOS link preview on the posters', () => {
    const screen = readFileSync(resolve(process.cwd(), 'src/components/ShowtimesScreen.vue'), 'utf8');
    expect(screen).toMatch(/\.st-card-link \{[^}]*-webkit-touch-callout: none/);
    expect(screen).toContain('@contextmenu.prevent');
  });
});
