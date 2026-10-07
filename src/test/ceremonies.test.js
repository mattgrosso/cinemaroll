import { describe, it, expect } from 'vitest';
import {
  categoryMatchKey,
  boardFromEntries,
  entriesFromProfile,
  entriesFromAcademy,
  entriesFromOther,
  titleIndex,
  ceremonyTabs,
  ACADEMY_BOARD_OPTIONS
} from '@/assets/javascript/ceremonies.js';

// Matt, 2026-10-07: tabs on the awards screen to "flip between the Groskers,
// the Golden Globes, all of my friends' awards, but also the Oscars... and
// look at the history of any award that we have access to."

// Brian's Movie Log feed as it actually arrived: no awardsName, every label
// prefixed with the ceremony, several winners in one category.
const brian = {
  ratings: {
    11: { r: 9, t: 'Star Wars', p: '/sw.jpg', a: [
      { year: 1977, category: 'institution-1-5c', label: 'Goegan Globes: Best Picture', result: 'won', name: 'Gary Kurtz' },
      { year: 1977, category: 'institution-1-63', label: 'Goegan Globes: Best Editing', result: 'won', name: 'Marcia Lucas' },
      { year: 1977, category: 'institution-1-63', label: 'Goegan Globes: Best Editing', result: 'won', name: 'Paul Hirsch' },
      { year: 1977, category: 'institution-1-58', label: 'Goegan Globes: Best Supporting Actor', result: 'nominated', name: 'Harrison Ford' }
    ] },
    1891: { r: 9.5, t: 'The Empire Strikes Back', p: '/esb.jpg', a: [{ year: 1980, category: 'institution-1-5c', label: 'Goegan Globes: Best Picture', result: 'won' }] },
    949: { r: 8, t: 'Heat' }
  }
};

describe('categoryMatchKey', () => {
  it('folds the common spellings onto one key without merging real distinctions', () => {
    expect(categoryMatchKey('Best Picture')).toBe('best picture');
    expect(categoryMatchKey('Best Film')).toBe('best picture');
    expect(categoryMatchKey('Best Screenplay or Writing')).toBe('best screenplay');
    expect(categoryMatchKey('Best Screenplay')).toBe('best screenplay');
    expect(categoryMatchKey('Best Original Screenplay')).not.toBe(categoryMatchKey('Best Adapted Screenplay'));
    expect(categoryMatchKey('Best Film Editing')).toBe(categoryMatchKey('Best Editing'));
    expect(categoryMatchKey('Best Score or Music')).toBe(categoryMatchKey('Best Original Score'));
    expect(categoryMatchKey('Best Actor in a Supporting Role')).toBe('best supporting actor');
    expect(categoryMatchKey('Best Motion Picture – Drama')).not.toBe(categoryMatchKey('Best Motion Picture – Musical or Comedy'));
    expect(categoryMatchKey('Best Needle Drop!')).toBe('best needle drop');
  });
});

describe('a friend\'s board', () => {
  it('peels the ceremony prefix off, keeps every winner, and puts Best Picture first', () => {
    const board = boardFromEntries(entriesFromProfile(brian));
    expect(board.map((y) => y.year)).toEqual([1980, 1977]);
    const y1977 = board[1];
    expect(y1977.categories.map((c) => c.label)).toEqual(['Best Picture', 'Best Supporting Actor', 'Best Editing']);
    expect(y1977.categories[0].winners).toEqual([{ movieId: 11, title: 'Star Wars', poster: '/sw.jpg', name: 'Gary Kurtz' }]);
    expect(y1977.categories[2].winners.map((p) => p.name)).toEqual(['Marcia Lucas', 'Paul Hirsch']);
    expect(y1977.categories[1].winners).toEqual([]);
    expect(y1977.categories[1].nominees[0]).toMatchObject({ movieId: 11, name: 'Harrison Ford' });
  });

  it('is empty for a profile without awards', () => {
    expect(boardFromEntries(entriesFromProfile({ ratings: { 1: { r: 5 } } }))).toEqual([]);
    expect(boardFromEntries(entriesFromProfile(null))).toEqual([]);
  });
});

describe('the Oscars board', () => {
  const records = [
    { year: 1994, category: 'Best Picture', tmdb: '278', title: 'The Shawshank Redemption', img: '/ssr.jpg', isWinner: false, isActing: false, names: [{ name: 'Niki Marvin' }] },
    { year: 1994, category: 'Best Picture', tmdb: '13', title: 'Forrest Gump', img: '/fg.jpg', isWinner: true, isActing: false, names: [{ name: 'Wendy Finerman' }] },
    { year: 1994, category: 'Best Actor', tmdb: '13', title: 'Forrest Gump', img: '/fg.jpg', isWinner: true, isActing: true, names: [{ name: 'Tom Hanks' }] },
    { year: 1994, category: 'Best Director', tmdb: '13', title: 'Forrest Gump', img: '/fg.jpg', isWinner: true, isActing: false, names: [{ name: 'Robert Zemeckis' }] },
    { year: 1994, category: 'Honorary Award', tmdb: null, title: null, img: null, isWinner: true, isActing: true, names: [{ name: 'Michelangelo Antonioni' }] },
    { year: 'x', category: 'Best Picture', tmdb: '1' }
  ];
  it('uses the Academy\'s order, names people for acting and directing, not producers', () => {
    const [y1994] = boardFromEntries(entriesFromAcademy(records), ACADEMY_BOARD_OPTIONS);
    expect(y1994.year).toBe(1994);
    expect(y1994.categories.map((c) => c.label)).toEqual(['Best Picture', 'Best Director', 'Best Actor', 'Honorary Award']);
    expect(y1994.categories[0].winners).toEqual([{ movieId: 13, title: 'Forrest Gump', poster: '/fg.jpg' }]);
    expect(y1994.categories[0].nominees).toEqual([{ movieId: 278, title: 'The Shawshank Redemption', poster: '/ssr.jpg' }]);
    expect(y1994.categories[1].winners[0].name).toBe('Robert Zemeckis');
    expect(y1994.categories[2].winners[0].name).toBe('Tom Hanks');
    expect(y1994.categories[3].winners[0]).toEqual({ movieId: null, title: null, poster: null, name: 'Michelangelo Antonioni' });
  });
});

describe('the other ceremonies', () => {
  const rows = [
    { ceremony: 'Cannes Film Festival', category: "Palme d'Or", year: 1994, title: 'Pulp Fiction', isWinner: true },
    { ceremony: 'Cannes Film Festival', category: "Palme d'Or", year: 1993, title: 'Farewell My Concubine', isWinner: true },
    { ceremony: 'Golden Globe Awards', category: 'Best Director', year: 1994, title: 'Forrest Gump', isWinner: true }
  ];
  it('borrows the TMDB id and poster from whoever in the club has seen the film', () => {
    const index = titleIndex({
      library: [{ movie: { id: 680, title: 'Pulp Fiction', release_date: '1994-10-14', poster_path: '/pf.jpg' } }],
      profiles: [{ ratings: { 10997: { t: 'Farewell My Concubine', p: '/fmc.jpg' } } }]
    });
    const board = boardFromEntries(entriesFromOther(rows, 'Cannes Film Festival', index));
    expect(board.map((y) => y.year)).toEqual([1994, 1993]);
    expect(board[0].categories[0].winners).toEqual([{ movieId: 680, title: 'Pulp Fiction', poster: '/pf.jpg' }]);
    expect(board[1].categories[0].winners).toEqual([{ movieId: 10997, title: 'Farewell My Concubine', poster: '/fmc.jpg' }]);
    expect(boardFromEntries(entriesFromOther(rows, 'Golden Globe Awards'))[0].categories[0].winners).toEqual([{ movieId: null, title: 'Forrest Gump', poster: null }]);
  });
});

describe('ceremonyTabs', () => {
  it('lists mine, friends who publish awards (named by their ceremony), then the real ones', () => {
    const tabs = ceremonyTabs({ mine: 'The Groskers', friends: [
      { key: 'ext-1', name: 'Brian Goegan', profile: brian },
      { key: 'ext-2', name: 'Luke', profile: { ratings: { 1: { r: 7 } } } },
      { key: 'seth', name: 'Seth', profile: { awardsName: 'The Smithies', ratings: { 1: { r: 7, a: [{ year: 2020, category: 'bp', label: 'Best Picture', result: 'won' }] } } } }
    ] });
    expect(tabs.map((t) => t.id)).toEqual(['mine', 'friend:ext-1', 'friend:seth', 'oscars', 'golden-globes', 'bafta', 'cannes', 'venice']);
    expect(tabs[0].label).toBe('The Groskers');
    expect(tabs[1]).toEqual({ id: 'friend:ext-1', label: 'Goegan Globes', who: 'Brian Goegan' });
    expect(tabs[2].label).toBe('The Smithies');
  });
});
