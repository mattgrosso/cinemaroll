import { describe, it, expect } from 'vitest';
import { validAwards, friendAwardsForMovie, friendCeremonies, awardLabel, memberFromProfile, clubAwardsByYear } from '@/assets/javascript/awardsShare.js';
import { entriesFromProfile, boardFromEntries, ceremonyTabs } from '@/assets/javascript/ceremonies.js';
import { fromInterchange } from '@/assets/javascript/interchange.js';

// Film Club Protocol 1.2.0 (proposal 0002, 2026-10-09): a Movie Log user may
// keep several public awards institutions, and each award entry may name
// its own as `ceremony`. During rollout the label may still carry the exact
// "<ceremony>: " prefix for older readers.
const feed = {
  format: 'film-club/1',
  source: 'movielog',
  name: 'Brian Goegan',
  movies: [{
    tmdbId: 550,
    title: 'Fight Club',
    rating: 8,
    awards: [
      { year: 2015, category: 'gg-pic', label: 'Goegan Globes: Best Picture', result: 'won', ceremony: 'Goegan Globes' },
      { year: 2015, category: 'br-pic', label: 'Best Picture', result: 'won', ceremony: 'The Bries' },
      { year: 2015, category: 'br-pic2', label: 'Best Picture', result: 'nominated', ceremony: 'The Bries' },
      { year: 2015, category: 'gg-dir', label: 'Goegan Globes: Best Director', result: 'nominated', name: 'David Fincher' }
    ]
  }]
};

describe('several institutions in one feed', () => {
  it('keeps ceremony through the wire, and drops a placeholder or an overlong one', () => {
    const row = fromInterchange(feed).ratings[550];
    expect(row.a.map((a) => a.ceremony ?? null)).toEqual(['Goegan Globes', 'The Bries', 'The Bries', null]);
    expect(validAwards([{ year: 2015, category: 'x', label: 'X', result: 'won', ceremony: 'Personal awards' }])[0].ceremony).toBeUndefined();
    expect(validAwards([{ year: 2015, category: 'x', label: 'X', result: 'won', ceremony: 'x'.repeat(81) }])[0].ceremony).toBeUndefined();
  });

  it('strips only the exact prefix of the entry\'s own ceremony', () => {
    expect(awardLabel({ label: 'Goegan Globes: Best Picture', ceremony: 'Goegan Globes' }, null)).toBe('Best Picture');
    expect(awardLabel({ label: 'The Bries: Best Picture', ceremony: 'Goegan Globes' }, 'The Bries')).toBe('The Bries: Best Picture');
    expect(awardLabel({ label: 'goegan globes: Best Picture', ceremony: 'Goegan Globes' }, null)).toBe('goegan globes: Best Picture');
    expect(awardLabel({ label: 'Goegan Globes: Best Picture' }, 'Goegan Globes')).toBe('Best Picture');
  });

  it('shows one group per institution on the movie page, the feed\'s own first', () => {
    const profile = fromInterchange(feed);
    const groups = friendAwardsForMovie([{ name: 'Brian Goegan', key: 'brian', profile }], 550);
    expect(groups.map((g) => [g.ceremony, g.tabId, g.won.map((a) => a.label), g.nominated.length])).toEqual([
      ['Goegan Globes', 'friend:brian', ['Best Picture'], 1],
      ['The Bries', 'friend:brian:The Bries', ['Best Picture'], 1]
    ]);
  });

  it('gives each institution its own /awards tab and keeps distinct category keys apart', () => {
    const profile = fromInterchange(feed);
    expect(friendCeremonies(profile, 'Brian Goegan')).toEqual(['Goegan Globes', 'The Bries']);
    const tabs = ceremonyTabs({ mine: 'The Groskers', friends: [{ key: 'brian', name: 'Brian Goegan', profile }] });
    expect(tabs.filter((t) => t.who).map((t) => [t.id, t.label])).toEqual([['friend:brian', 'Goegan Globes'], ['friend:brian:The Bries', 'The Bries']]);
    const bries = boardFromEntries(entriesFromProfile(profile, { ceremony: 'The Bries', fallbackName: 'Brian Goegan' }));
    expect(bries[0].categories.map((c) => c.label)).toEqual(['Best Picture', 'Best Picture']);
  });

  it('lists both institutions in the Club view without calling it agreement', () => {
    const member = memberFromProfile('Brian Goegan', fromInterchange(feed));
    const pic = clubAwardsByYear([member])[0].categories.find((c) => c.label === 'Best Picture');
    expect(pic.picks.map((p) => p.ceremony).sort()).toEqual(['Goegan Globes', 'The Bries']);
    expect(pic.agreed).toBe(false);
    expect(pic.choices[0].who).toEqual(['Brian Goegan']);
  });

  it('leaves a feed without the field read as before', () => {
    const old = { ...feed, movies: [{ ...feed.movies[0], awards: feed.movies[0].awards.map(({ ceremony, ...a }) => ({ ...a, label: a.label.startsWith('Goegan') ? a.label : `Goegan Globes: ${a.label}` })) }] };
    const groups = friendAwardsForMovie([{ name: 'Brian Goegan', key: 'brian', profile: fromInterchange(old) }], 550);
    expect(groups.map((g) => [g.ceremony, g.tabId])).toEqual([['Goegan Globes', 'friend:brian']]);
  });
});
