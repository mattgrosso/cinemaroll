import { describe, it, expect, beforeEach } from 'vitest';
import { mount } from '@vue/test-utils';
import BoxOfficePeople from '@/components/BoxOfficePeople.vue';
import { boxOfficeByPerson, namesInRole, TOP_BILLING } from '@/assets/javascript/boxOfficePeople.js';
import { BASE_YEAR } from '@/assets/javascript/inflation.js';

// Bug report -P1as4TtI_22xUMjtflq (Matt, 2026-09-15): "see box office
// returns by person, so like we could have a list of highest grossing
// directors and highest grossing performers, and maybe even crew, and show
// those lists based on my database".

const film = (id, title, year, revenue, { cast = [], crew = [] } = {}) => ({
  dbKey: `k${id}`,
  movie: {
    id,
    title,
    release_date: `${year}-06-15`,
    revenue,
    cast: cast.map((name, order) => ({ name, order })),
    crew: crew.map(([name, job]) => ({ name, job }))
  }
});

const LIBRARY = [
  film(1, 'Jaws', BASE_YEAR, 470e6, { cast: ['Roy Scheider', 'Robert Shaw'], crew: [['Steven Spielberg', 'Director'], ['John Williams', 'Original Music Composer'], ['Peter Benchley', 'Novel'], ['Peter Benchley', 'Screenplay']] }),
  film(2, 'E.T.', BASE_YEAR, 790e6, { cast: ['Henry Thomas', 'Drew Barrymore'], crew: [['Steven Spielberg', 'Director'], ['John Williams', 'Original Music Composer'], ['Kathleen Kennedy', 'Producer']] }),
  film(3, 'Heat', BASE_YEAR, 187e6, { cast: ['Al Pacino', 'Robert De Niro'], crew: [['Michael Mann', 'Director']] }),
  // No figure: adds nothing, not even a film count.
  film(4, 'Unknown', BASE_YEAR, 0, { crew: [['Steven Spielberg', 'Director']] })
];

describe('boxOfficeByPerson', () => {
  it('ranks directors by the summed gross of their films, naming the biggest', () => {
    const rows = boxOfficeByPerson(LIBRARY, { role: 'director' });
    expect(rows.map((r) => r.name)).toEqual(['Steven Spielberg', 'Michael Mann']);
    expect(rows[0].total).toBe(1260e6);
    expect(rows[0].count).toBe(2);
    expect(rows[0].top.movie.title).toBe('E.T.');
    expect(rows[0].topGross).toBe(790e6);
  });

  it('counts a person once per film however many credits they hold on it', () => {
    const writers = boxOfficeByPerson(LIBRARY, { role: 'writer' });
    expect(writers).toEqual([expect.objectContaining({ name: 'Peter Benchley', count: 1, total: 470e6 })]);
  });

  it('matches crew by job, so composers and producers each get their own list', () => {
    expect(boxOfficeByPerson(LIBRARY, { role: 'composer' })[0]).toMatchObject({ name: 'John Williams', total: 1260e6 });
    expect(boxOfficeByPerson(LIBRARY, { role: 'producer' })).toEqual([expect.objectContaining({ name: 'Kathleen Kennedy', total: 790e6 })]);
  });

  it('performers count top billing only', () => {
    const crowd = Array.from({ length: TOP_BILLING + 3 }, (_, i) => `Extra ${i}`);
    const movie = film(9, 'Crowd', BASE_YEAR, 100e6, { cast: crowd }).movie;
    expect(namesInRole(movie, 'performer')).toEqual(crowd.slice(0, TOP_BILLING));

    const rows = boxOfficeByPerson(LIBRARY, { role: 'performer' });
    expect(rows[0]).toMatchObject({ name: 'Drew Barrymore', total: 790e6 });
    expect(rows.map((r) => r.name)).toContain('Al Pacino');
  });

  it('today\'s dollars re-order the list the same way the years list does', () => {
    const entries = [
      film(1, 'Old Hit', 1975, 470e6, { crew: [['Old Director', 'Director']] }),
      film(2, 'New Hit', BASE_YEAR, 600e6, { crew: [['New Director', 'Director']] })
    ];
    expect(boxOfficeByPerson(entries, { role: 'director', adjusted: false })[0].name).toBe('New Director');
    expect(boxOfficeByPerson(entries, { role: 'director', adjusted: true })[0].name).toBe('Old Director');
  });
});

describe('BoxOfficePeople', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const factory = (entries = LIBRARY) => mount(BoxOfficePeople, { props: { resultsWithRatings: entries } });

  it('opens on directors, and a role pill switches and remembers the list', async () => {
    const wrapper = factory();
    expect(wrapper.findAll('.person-row')[0].find('.person-name').text()).toBe('Steven Spielberg');
    expect(wrapper.findAll('.person-row')[0].find('.person-numbers').text()).toContain('$1.3B');

    const composers = wrapper.findAll('.role-option').find((b) => b.text() === 'Composers');
    await composers.trigger('click');
    expect(wrapper.findAll('.person-row')[0].find('.person-name').text()).toBe('John Williams');
    expect(window.localStorage.getItem('cinemaRoll.insights.boxOfficeRole')).toBe('composer');

    expect(factory().findAll('.person-row')[0].find('.person-name').text()).toBe('John Williams');
  });

  it('tapping a name searches for it, the way tapping a year does', async () => {
    const wrapper = factory();
    await wrapper.find('.person-row').trigger('click');
    expect(wrapper.emitted('updateSearchValue')).toEqual([['Steven Spielberg']]);
  });

  it('says so when no film has a figure yet', () => {
    const wrapper = factory([film(1, 'Unknown', 1999, 0, { crew: [['Nobody', 'Director']] })]);
    expect(wrapper.find('.box-office-empty').exists()).toBe(true);
    expect(wrapper.findAll('.person-row')).toHaveLength(0);
  });
});
