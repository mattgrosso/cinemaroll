import { describe, it, expect, vi } from 'vitest';
import { shallowMount } from '@vue/test-utils';
import ClubCharts from '@/components/ClubCharts.vue';

vi.mock('@/assets/javascript/GetRating.js', () => ({
  getRating: vi.fn((media) => ({ calculatedTotal: media?.ratings?.[0]?.calculatedTotal ?? 0 }))
}));

function movie (id, title, rating) {
  return {
    dbKey: `k${id}`,
    ratings: [{ calculatedTotal: rating, date: '2026-03-01' }],
    movie: { id, title, poster_path: `/${id}.jpg`, release_date: '2001-06-15', genres: [{ name: 'Drama' }] }
  };
}

const PROFILES = {
  seth: { name: 'Seth', ratings: { 1: { r: 9, t: 'Heat', p: '/1.jpg' }, 3: { r: 8, t: 'Ronin', p: '/3.jpg' } } },
  nat: { name: 'Nat', ratings: { 1: { r: 7, t: 'Heat', p: '/1.jpg' } } }
};

function factory ({ profiles = PROFILES, myEntries = [movie(1, 'Heat', 8)] } = {}) {
  return shallowMount(ClubCharts, {
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
        $router: { push: vi.fn() }
      }
    }
  });
}

// The key doubles as the page-wide people picker (Matt, 2026-08-21: "let's
// pour a similar amount of customizability to the other charts in club
// charts and then we can put them all on that same page").
describe('ClubCharts people picker', () => {
  it('starts with everyone included, in you-first order', () => {
    const wrapper = factory();
    expect(wrapper.vm.selectedKeys).toEqual(['you', 'seth', 'nat']);
    expect(wrapper.findAll('.cc-key-item.excluded')).toHaveLength(0);
  });

  it('tapping a member drops them from every chart, tapping again restores them', async () => {
    const wrapper = factory();
    expect(wrapper.vm.overlaps.map((f) => f.key).sort()).toEqual(['nat', 'seth']);

    const sethChip = wrapper.findAll('.cc-key-item').find((chip) => chip.text().includes('Seth'));
    await sethChip.trigger('click');

    expect(wrapper.vm.overlaps.map((f) => f.key)).toEqual(['nat']);
    expect(wrapper.find('.cc-key-item.excluded').exists()).toBe(true);

    // Re-including appends to pick order — the Venn draws the first three.
    await sethChip.trigger('click');
    expect(wrapper.vm.selectedKeys).toEqual(['you', 'nat', 'seth']);
  });

  it('embeds the Venn and feeds it the pick order', () => {
    const wrapper = factory();
    const venn = wrapper.findComponent({ name: 'ClubVenn' });
    expect(venn.exists()).toBe(true);
    expect(venn.props('selection')).toEqual(['you', 'seth', 'nat']);
  });

  it('never hides the picker, even with every friend deselected', async () => {
    const wrapper = factory();
    for (const key of ['seth', 'nat']) {
      const chip = wrapper.findAll('.cc-key-item').find((c) => c.text().includes(key === 'seth' ? 'Seth' : 'Nat'));
      await chip.trigger('click');
    }

    expect(wrapper.vm.overlaps).toHaveLength(0);
    expect(wrapper.findAll('.cc-key-item').length).toBe(3);
    expect(wrapper.text()).not.toContain('Nothing to chart yet');
  });

  it('keeps colours stable when someone is excluded', async () => {
    const wrapper = factory();
    const before = wrapper.vm.colorFor('nat');

    const sethChip = wrapper.findAll('.cc-key-item').find((chip) => chip.text().includes('Seth'));
    await sethChip.trigger('click');

    expect(wrapper.vm.colorFor('nat')).toBe(before);
  });

  // 2026-11-17: a film you haven't rated did nothing on tap (MovieDetail
  // would bounce it back to Film Club); it opens the preview sheet now.
  it('opens your page for a film you have rated and the preview sheet for one you have not', () => {
    const wrapper = factory();
    wrapper.vm.openMovie({ id: 1, title: 'Heat', poster: '/1.jpg' });
    expect(wrapper.vm.$router.push).toHaveBeenCalledWith('/movie/1');
    expect(wrapper.vm.previewing).toBeNull();

    wrapper.vm.$router.push.mockClear();
    wrapper.vm.openMovie({ id: 3, title: 'Ronin', poster: '/3.jpg' });
    expect(wrapper.vm.$router.push).not.toHaveBeenCalled();
    expect(wrapper.vm.previewing).toMatchObject({ id: 3, title: 'Ronin', poster_path: '/3.jpg' });
  });
});
