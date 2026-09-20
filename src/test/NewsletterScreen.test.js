import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import NewsletterScreen from '@/components/NewsletterScreen.vue';

vi.mock('axios', () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: {} })), post: vi.fn(() => Promise.resolve({ data: {} })) }
}));

const pick = (over = {}) => ({
  id: 42,
  title: 'Look Back',
  year: 2024,
  director: 'Kiyotaka Oshiyama',
  posterPath: '/look-back.jpg',
  availability: 'Streaming on Amazon Prime Video',
  rottenTomatoes: 100,
  metacritic: 90,
  why: 'You rate animation highly and this is the best-reviewed thing all week.',
  tmdb: { id: 42, title: 'Look Back', poster_path: '/look-back.jpg', release_date: '2024-06-28' },
  ...over
});

const issue = (over = {}) => ({
  weekKey: '2026-09-18',
  builtAt: Date.UTC(2026, 8, 18),
  testing: false,
  intro: 'A quiet week, with one very loud exception.',
  picks: [pick()],
  feature: {
    id: 9,
    title: 'Down by Law',
    year: 1986,
    turning: 40,
    headline: 'Three men, one cell, no plot',
    hook: 'Forty years on, it is still the funniest film about doing nothing.',
    article: 'First paragraph about the film.\n\nSecond paragraph about its influence.'
  },
  ...over
});

function mountScreen ({ state = {}, dispatch = vi.fn(() => Promise.resolve()) } = {}) {
  const store = {
    state: {
      newsletterIssue: null,
      newsletterPrefs: null,
      newsletterLoaded: true,
      pushSubscribed: false,
      devMode: false,
      ...state
    },
    getters: { linkedMovieHats: [] },
    commit: vi.fn(),
    dispatch
  };
  return mount(NewsletterScreen, {
    global: {
      mocks: { $store: store },
      stubs: { SendToHat: true, RouterLink: { template: '<a><slot/></a>' } }
    }
  });
}

describe('NewsletterScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks for the issue on mount', () => {
    const dispatch = vi.fn(() => Promise.resolve());
    mountScreen({ dispatch });
    expect(dispatch).toHaveBeenCalledWith('loadNewsletter');
  });

  // An empty issue and an unread one look the same without this, so the
  // screen would flash "no issue yet" on every open.
  it('shows a spinner until the read comes back', () => {
    const wrapper = mountScreen({ state: { newsletterLoaded: false } });
    expect(wrapper.find('.newsletter-loading').exists()).toBe(true);
    expect(wrapper.find('.newsletter-empty').exists()).toBe(false);
  });

  // "Send me the newsletter" read as email — Matt, 2026-09-20: "What does it
  // mean to send it to me? Because like, where's it going to send it?"
  it('pitches the newsletter without implying anything gets emailed', () => {
    const wrapper = mountScreen();
    const text = wrapper.find('.newsletter-empty').text();
    expect(text).toContain('every Friday');
    expect(text).toContain('nothing gets emailed');
    expect(wrapper.find('.newsletter-optout').text()).toBe('Turn the newsletter on');
    expect(text).not.toContain('Send me');
  });

  it('opting in saves the pref', async () => {
    const dispatch = vi.fn(() => Promise.resolve());
    const wrapper = mountScreen({ dispatch });
    await wrapper.find('.newsletter-optout').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('saveNewsletterPrefs', { newsletter: true });
  });

  describe('opted in with no issue yet', () => {
    const optedInEmpty = { newsletterPrefs: { newsletter: true } };

    // The dead end Matt hit: the build button lived only in a rendered
    // issue's footer, so opting in led to a screen with nothing to press.
    it('offers a way to build a first issue right now', async () => {
      const dispatch = vi.fn(() => Promise.resolve());
      const wrapper = mountScreen({ state: optedInEmpty, dispatch });
      const build = wrapper.find('.newsletter-empty .btn-primary');
      expect(build.exists()).toBe(true);
      expect(build.text()).toContain('Build this week');
      await build.trigger('click');
      expect(dispatch).toHaveBeenCalledWith('rebuildNewsletter');
    });

    it('does not offer to build for someone who has not opted in', () => {
      expect(mountScreen().find('.newsletter-empty .btn-primary').exists()).toBe(false);
    });

    it('says where the issue will appear, not that it will be sent', () => {
      const text = mountScreen({ state: optedInEmpty }).find('.newsletter-empty').text();
      expect(text).toContain('appears on this page');
    });

    // Promising a buzz that never comes is worse than saying nothing.
    it('tells the truth when notifications are off', () => {
      const text = mountScreen({ state: optedInEmpty }).find('.newsletter-quiet').text();
      expect(text).toContain('Notifications are off');
    });

    it('promises the buzz only when a device is actually subscribed', () => {
      const text = mountScreen({ state: { ...optedInEmpty, pushSubscribed: true } })
        .find('.newsletter-quiet').text();
      expect(text).toContain('buzz');
      expect(text).not.toContain('Notifications are off');
    });

    it('surfaces a failed first build', async () => {
      const dispatch = vi.fn((action) => (action === 'rebuildNewsletter'
        ? Promise.reject(new Error('Nothing built: nothing available'))
        : Promise.resolve()));
      const wrapper = mountScreen({ state: optedInEmpty, dispatch });
      await wrapper.find('.newsletter-empty .btn-primary').trigger('click');
      await new Promise((resolve) => setTimeout(resolve, 0));
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.newsletter-error').text()).toContain('nothing available');
    });
  });

  it('opting out from a rendered issue turns it off again', async () => {
    const dispatch = vi.fn(() => Promise.resolve());
    const wrapper = mountScreen({
      state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: true } },
      dispatch
    });
    await wrapper.find('.newsletter-optout').trigger('click');
    expect(dispatch).toHaveBeenCalledWith('saveNewsletterPrefs', { newsletter: false });
  });

  describe('a rendered issue', () => {
    it('renders the intro, the pick and the feature', () => {
      const wrapper = mountScreen({ state: { newsletterIssue: issue() } });
      const text = wrapper.text();
      expect(text).toContain('A quiet week');
      expect(text).toContain('Look Back');
      expect(text).toContain('You rate animation highly');
      expect(text).toContain('Down by Law turns 40');
      expect(text).toContain('Three men, one cell, no plot');
    });

    it('splits the article into real paragraphs rather than one block', () => {
      const wrapper = mountScreen({ state: { newsletterIssue: issue() } });
      const paras = wrapper.findAll('.newsletter-para');
      expect(paras).toHaveLength(2);
      expect(paras[1].text()).toContain('influence');
    });

    it('shows the poster and where to watch it', () => {
      const wrapper = mountScreen({ state: { newsletterIssue: issue() } });
      expect(wrapper.find('.newsletter-poster').exists()).toBe(true);
      expect(wrapper.find('.newsletter-where').text()).toBe('Streaming on Amazon Prime Video');
    });

    it('hands the hat button TMDB-shaped fields, not the display copy', () => {
      const wrapper = mountScreen({ state: { newsletterIssue: issue() } });
      const hat = wrapper.findComponent({ name: 'SendToHat' });
      expect(hat.exists()).toBe(true);
      // toHatMovie reads poster_path and release_date; a camelCase copy would
      // send a hat a film with no poster and no year.
      expect(hat.props('movies')).toMatchObject({ id: 42, poster_path: '/look-back.jpg' });
    });

    it('renders both critic scores when both exist', () => {
      const wrapper = mountScreen({ state: { newsletterIssue: issue() } });
      const scores = wrapper.find('.newsletter-scores').text();
      expect(scores).toContain('100% RT');
      expect(scores).toContain('90 Metacritic');
    });

    // A missing score is unknown, not zero — the whole reason criticScores
    // returns null. Rendering "0% RT" would be a lie about a real film.
    it('says so plainly when nothing has been scored, and never shows a zero', () => {
      const wrapper = mountScreen({
        state: { newsletterIssue: issue({ picks: [pick({ rottenTomatoes: null, metacritic: null })] }) }
      });
      const scores = wrapper.find('.newsletter-scores').text();
      expect(scores).toContain('No critic score yet');
      expect(scores).not.toContain('0%');
      expect(scores).not.toContain('RT');
    });

    it('shows only the score that exists when one is missing', () => {
      const wrapper = mountScreen({
        state: { newsletterIssue: issue({ picks: [pick({ rottenTomatoes: null, metacritic: 52 })] }) }
      });
      const scores = wrapper.find('.newsletter-scores').text();
      expect(scores).toContain('52 Metacritic');
      expect(scores).not.toContain('RT');
      expect(scores).not.toContain('No critic score yet');
    });

    it('renders an issue with no feature at all', () => {
      const wrapper = mountScreen({ state: { newsletterIssue: issue({ feature: null }) } });
      expect(wrapper.find('.newsletter-feature').exists()).toBe(false);
      expect(wrapper.text()).toContain('Look Back');
    });

    it('renders an issue with no picks at all', () => {
      const wrapper = mountScreen({ state: { newsletterIssue: issue({ picks: [] }) } });
      expect(wrapper.findAll('.newsletter-pick')).toHaveLength(0);
      expect(wrapper.text()).toContain('Down by Law');
    });
  });

  describe('the rebuild', () => {
    // NOT gated on devMode: devMode repoints databaseTopKey at
    // `testing-database` while the Lambda derives the account from the ID
    // token, so a devMode rebuild would poll a different node than the one it
    // writes and wait forever. Spend is bounded on the server instead.
    it('is offered to anyone opted in, whatever devMode says', () => {
      const wrapper = mountScreen({
        state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: true }, devMode: false }
      });
      expect(wrapper.find('.btn-outline-warning').exists()).toBe(true);
    });

    it('is hidden for someone who has not opted in', () => {
      const wrapper = mountScreen({
        state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: false } }
      });
      expect(wrapper.find('.btn-outline-warning').exists()).toBe(false);
    });

    it('rebuilds on tap', async () => {
      const dispatch = vi.fn(() => Promise.resolve({}));
      const wrapper = mountScreen({
        state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: true } }, dispatch
      });
      await wrapper.find('.btn-outline-warning').trigger('click');
      expect(dispatch).toHaveBeenCalledWith('rebuildNewsletter');
    });

    it('surfaces a rebuild failure instead of failing silently', async () => {
      // Only the rebuild rejects — a blanket mockRejectedValue would also
      // reject mount's loadNewsletter, which is a different failure.
      const dispatch = vi.fn((action) => (action === 'rebuildNewsletter'
        ? Promise.reject(new Error('Nothing built: not opted in'))
        : Promise.resolve()));
      const wrapper = mountScreen({
        state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: true } }, dispatch
      });
      await wrapper.find('.btn-outline-warning').trigger('click');
      await new Promise((resolve) => setTimeout(resolve, 0));
      await wrapper.vm.$nextTick();
      expect(wrapper.find('.newsletter-error').text()).toContain('not opted in');
    });

    // A rebuilt issue is otherwise indistinguishable from Friday's, which
    // makes every screenshot ambiguous.
    it('stamps an issue built for testing', () => {
      const wrapper = mountScreen({ state: { newsletterIssue: issue({ testing: true }) } });
      expect(wrapper.find('.newsletter-testing').exists()).toBe(true);
    });

    it('does not stamp a real Friday issue', () => {
      const wrapper = mountScreen({ state: { newsletterIssue: issue() } });
      expect(wrapper.find('.newsletter-testing').exists()).toBe(false);
    });
  });
});
