import { describe, it, expect, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import ClubVenn from '@/components/ClubVenn.vue';

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => ({ calculatedTotal: media?.ratings?.[0]?.calculatedTotal ?? 0 }))
}));

function movie (id, title, rating) {
  return {
    dbKey: `k${id}`,
    ratings: [{ calculatedTotal: rating, date: '2026-03-01' }],
    movie: { id, title, poster_path: `/${id}.jpg`, release_date: '2001-06-15' }
  };
}

function profileWith (name, ratings) {
  return { name, counts: { titles: Object.keys(ratings).length }, ratings };
}

function factory ({ profiles = {}, myEntries = [], selection = [] } = {}) {
  const push = vi.fn();
  const wrapper = shallowMount(ClubVenn, {
    props: { selection },
    global: {
      mocks: {
        $store: {
          state: { settings: {} },
          getters: {
            allMoviesAsArray: myEntries,
            filmClubProfiles: profiles
          },
          dispatch: vi.fn(() => Promise.resolve())
        },
        $router: { push }
      }
    }
  });
  return { wrapper, push };
}

const PROFILES = {
  seth: profileWith('Seth', {
    1: { r: 9, t: 'Heat', p: '/1.jpg' },
    3: { r: 8.5, t: 'Ronin', p: '/3.jpg' }
  }),
  nat: profileWith('Nat', {
    1: { r: 7, t: 'Heat', p: '/1.jpg' },
    4: { r: 9, t: 'Clue', p: '/4.jpg' }
  })
};

describe('ClubVenn (a section of Club Charts, fed by the page picker)', () => {
  it('draws the first three of the parent selection and says so past three', async () => {
    const { wrapper } = factory({
      profiles: PROFILES,
      myEntries: [movie(1, 'Heat', 8)],
      selection: ['you', 'seth', 'nat', 'other']
    });

    expect(wrapper.vm.selectedKeys).toEqual(['you', 'seth', 'nat']);
    expect(wrapper.find('.cv-cap-note').exists()).toBe(true);

    await wrapper.setProps({ selection: ['you', 'seth'] });
    expect(wrapper.find('.cv-cap-note').exists()).toBe(false);
  });

  it('asks for at least two people instead of drawing a one-circle Venn', () => {
    const { wrapper } = factory({ profiles: PROFILES, myEntries: [movie(1, 'Heat', 8)], selection: ['you'] });

    expect(wrapper.text()).toContain('Pick at least two people');
    expect(wrapper.find('.cv-stage').exists()).toBe(false);
    expect(wrapper.find('.cv-lenses').exists()).toBe(false);
  });

  it('lists only occupied regions and opens one from the legend', async () => {
    const { wrapper } = factory({
      profiles: PROFILES,
      myEntries: [movie(1, 'Heat', 8), movie(2, 'Cats', 4)],
      selection: ['you', 'seth', 'nat']
    });
    await wrapper.vm.$nextTick();

    const labels = wrapper.findAll('.cv-legend-row .cv-legend-name').map((node) => node.text());
    expect(labels).toContain('You, Seth & Nat');
    expect(labels).not.toContain('You & Seth');

    const rows = wrapper.findAll('.cv-legend-row');
    await rows[rows.length - 1].trigger('click');
    expect(wrapper.find('.cv-section-title').text()).toBe('You, Seth & Nat');
    expect(wrapper.findAll('.cv-poster-card')).toHaveLength(1);
  });

  it('re-cuts the same circles under the loved lens', async () => {
    const { wrapper } = factory({
      profiles: PROFILES,
      myEntries: [movie(1, 'Heat', 8), movie(2, 'Cats', 4)],
      selection: ['you', 'seth', 'nat']
    });

    wrapper.vm.setLens('loved');
    await wrapper.vm.$nextTick();

    const labels = wrapper.findAll('.cv-legend-row .cv-legend-name').map((node) => node.text());
    expect(labels).toContain('You & Seth');
    expect(labels).not.toContain('You, Seth & Nat');
    expect(labels).not.toContain('Only You');
  });

  it('closes the open region when the parent changes who is in the Venn', async () => {
    const { wrapper } = factory({
      profiles: PROFILES,
      myEntries: [movie(1, 'Heat', 8)],
      selection: ['you', 'seth', 'nat']
    });

    wrapper.vm.selectRegion('you|seth|nat');
    await wrapper.vm.$nextTick();
    expect(wrapper.find('.cv-section-title').exists()).toBe(true);

    await wrapper.setProps({ selection: ['you', 'seth'] });
    expect(wrapper.vm.selectedSignature).toBe(null);
  });

  it('navigates only for films in your own library; the rest get a hat ribbon and the preview sheet', async () => {
    const { wrapper, push } = factory({
      profiles: PROFILES,
      myEntries: [movie(1, 'Heat', 8)],
      selection: ['you', 'seth', 'nat']
    });
    await wrapper.vm.$nextTick();

    wrapper.vm.selectRegion('seth');
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: 'SendToHat' }).exists()).toBe(true);
    await wrapper.find('.cv-poster-card').trigger('click');
    expect(push).not.toHaveBeenCalled();
    // A film only a friend rated opens the preview sheet (2026-11-17); it
    // used to do nothing at all.
    expect(wrapper.vm.previewing).toMatchObject({ id: 3, title: 'Ronin', poster_path: '/3.jpg' });
    wrapper.vm.previewing = null;

    wrapper.vm.selectRegion('you|seth|nat');
    await wrapper.vm.$nextTick();
    expect(wrapper.findComponent({ name: 'SendToHat' }).exists()).toBe(false);
    await wrapper.find('.cv-poster-card').trigger('click');
    expect(push).toHaveBeenCalledWith('/movie/1');
  });
});
