import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import NewsletterNotice from '@/components/NewsletterNotice.vue';

const READ_KEY = 'cinemaRoll.newsletter.lastRead';

const issue = (over = {}) => ({
  weekKey: '2026-09-18',
  picks: [{ id: 1 }, { id: 2 }, { id: 3 }],
  feature: { title: 'Down by Law', turning: 40 },
  ...over
});

function mountNotice ({ state = {}, push = vi.fn() } = {}) {
  const store = {
    state: { newsletterIssue: null, newsletterPrefs: null, ...state },
    dispatch: vi.fn(() => Promise.resolve()),
    commit: vi.fn(),
    getters: {}
  };
  const wrapper = mount(NewsletterNotice, {
    global: { mocks: { $store: store, $router: { push } } }
  });
  return { wrapper, store, push };
}

describe('NewsletterNotice', () => {
  beforeEach(() => localStorage.clear());

  it('shows an unread issue in Home’s notice space', () => {
    const { wrapper } = mountNotice({
      state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: true } }
    });
    expect(wrapper.find('.prompt-card').exists()).toBe(true);
    expect(wrapper.text()).toContain('3 new films worth your time');
    expect(wrapper.text()).toContain('Down by Law at 40');
  });

  it('stays out of the way for anyone who has not opted in', () => {
    const { wrapper } = mountNotice({
      state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: false } }
    });
    expect(wrapper.find('.prompt-card').exists()).toBe(false);
  });

  it('shows nothing when there is no issue', () => {
    const { wrapper } = mountNotice({ state: { newsletterPrefs: { newsletter: true } } });
    expect(wrapper.find('.prompt-card').exists()).toBe(false);
  });

  it('hides an issue already read on this device', () => {
    localStorage.setItem(READ_KEY, '2026-09-18');
    const { wrapper } = mountNotice({
      state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: true } }
    });
    expect(wrapper.find('.prompt-card').exists()).toBe(false);
  });

  it('comes back for the NEXT issue', () => {
    localStorage.setItem(READ_KEY, '2026-09-11');
    const { wrapper } = mountNotice({
      state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: true } }
    });
    expect(wrapper.find('.prompt-card').exists()).toBe(true);
  });

  it('opening marks it read and navigates', async () => {
    const { wrapper, push } = mountNotice({
      state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: true } }
    });
    await wrapper.find('.prompt-card').trigger('click');
    expect(push).toHaveBeenCalledWith('/newsletter');
    expect(localStorage.getItem(READ_KEY)).toBe('2026-09-18');
    expect(wrapper.find('.prompt-card').exists()).toBe(false);
  });

  it('asks for the newsletter, since Home does not otherwise read it', () => {
    const { store } = mountNotice({ state: { newsletterPrefs: { newsletter: true } } });
    expect(store.dispatch).toHaveBeenCalledWith('loadNewsletter');
  });

  it('phrases a single-pick issue in the singular', () => {
    const { wrapper } = mountNotice({
      state: {
        newsletterIssue: issue({ picks: [{ id: 1 }], feature: null }),
        newsletterPrefs: { newsletter: true }
      }
    });
    expect(wrapper.text()).toContain('1 new film worth your time');
    expect(wrapper.text()).not.toContain('films');
  });

  it('handles an issue that is only a feature', () => {
    const { wrapper } = mountNotice({
      state: { newsletterIssue: issue({ picks: [] }), newsletterPrefs: { newsletter: true } }
    });
    expect(wrapper.text()).toContain('Down by Law at 40');
    expect(wrapper.text()).not.toContain('0 new');
  });

  // A notice card must never be what takes Home down — localStorage throws
  // outright in a locked-down private window.
  it('survives localStorage throwing on read and on write', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    try {
      const { wrapper, push } = mountNotice({
        state: { newsletterIssue: issue(), newsletterPrefs: { newsletter: true } }
      });
      expect(wrapper.find('.prompt-card').exists()).toBe(true);
      await wrapper.find('.prompt-card').trigger('click');
      expect(push).toHaveBeenCalledWith('/newsletter');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});
