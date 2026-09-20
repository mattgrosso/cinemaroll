import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  availability,
  criticScores,
  acclaim,
  shortlistReleases,
  anniversariesThisWeek,
  featureCandidates,
  issueBrief,
  weekKey,
  issueDue,
  VOTE_FLOOR
} from '../../aws-lambda/newsletterCompose.js';

const providers = (us) => ({ results: { US: us } });
const omdb = ({ rt = null, mc = null, imdb = null } = {}) => ({
  Ratings: [
    ...(imdb == null ? [] : [{ Source: 'Internet Movie Database', Value: `${imdb}/10` }]),
    ...(rt == null ? [] : [{ Source: 'Rotten Tomatoes', Value: `${rt}%` }])
  ],
  Metascore: mc == null ? 'N/A' : String(mc)
});

const candidate = (over = {}) => ({
  id: 1,
  title: 'A New Film',
  release_date: '2026-06-01',
  vote_count: 900,
  vote_average: 7.4,
  overview: 'Something happens.',
  ...over
});

describe('availability', () => {
  it('bills streaming over renting, and keeps both lists', () => {
    const where = availability(providers({
      flatrate: [{ provider_name: 'Netflix' }],
      rent: [{ provider_name: 'Amazon Video' }]
    }));
    expect(where.summary).toBe('Streaming on Netflix');
    expect(where.stream).toEqual(['Netflix']);
    expect(where.rent).toEqual(['Amazon Video']);
  });

  it('falls back to rental when nothing streams it', () => {
    expect(availability(providers({ rent: [{ provider_name: 'Apple TV' }] })).summary)
      .toBe('Rent on Apple TV');
  });

  it('dedupes a provider that both rents and sells', () => {
    const where = availability(providers({
      rent: [{ provider_name: 'Amazon Video' }],
      buy: [{ provider_name: 'Amazon Video' }]
    }));
    expect(where.rent).toEqual(['Amazon Video']);
  });

  // The whole promise of the section is "available now", and TMDB's release
  // window really does include titles whose providers haven't landed — one
  // did on the first real run against 2026-09-06..19.
  it('returns null when a film is in the window but not watchable anywhere', () => {
    expect(availability(providers({}))).toBe(null);
    expect(availability(undefined)).toBe(null);
  });
});

describe('criticScores and acclaim', () => {
  it('reads Rotten Tomatoes, Metacritic and IMDb out of an OMDb payload', () => {
    expect(criticScores(omdb({ rt: 83, mc: 68, imdb: 7.0 })))
      .toEqual({ rottenTomatoes: 83, metacritic: 68, imdb: 7 });
  });

  // Direct-to-video animation, foreign releases and small documentaries
  // routinely carry no critic score. Scoring those as zero would delete a
  // whole class of film from the newsletter.
  it('reports a missing score as null, never as zero', () => {
    const scores = criticScores({ Ratings: [], Metascore: 'N/A' });
    expect(scores).toEqual({ rottenTomatoes: null, metacritic: null, imdb: null });
    expect(acclaim(scores)).toBe(null);
    expect(acclaim(scores)).not.toBe(0);
  });

  it('averages only the critic scores that exist', () => {
    expect(acclaim({ rottenTomatoes: 90, metacritic: 70, imdb: null })).toBe(80);
    expect(acclaim({ rottenTomatoes: null, metacritic: 64, imdb: null })).toBe(64);
  });

  // The first live run: Batman: Knightfall Part 1 carries no RT and no
  // Metacritic, an IMDb of 8.1, and placed SECOND in the whole shortlist on
  // that alone. IMDb's average is fan enthusiasm wearing a score's clothing —
  // the exact inflation OMDb was added to correct for.
  it('does not let IMDb alone stand in for critical reception', () => {
    expect(acclaim({ rottenTomatoes: null, metacritic: null, imdb: 8.1 })).toBe(null);
  });

  it('but keeps IMDb in the scores, as context for the model', () => {
    expect(criticScores(omdb({ imdb: 8.1 })).imdb).toBe(8.1);
  });
});

describe('shortlistReleases', () => {
  const enrich = (id, us, scores) => [id, { providers: providers(us), omdb: omdb(scores) }];
  const streaming = { flatrate: [{ provider_name: 'Netflix' }] };

  it('keeps a genuinely new, watchable, well-reviewed film', () => {
    const rows = shortlistReleases({
      candidates: [candidate()],
      enriched: new Map([enrich(1, streaming, { rt: 92, mc: 80 })]),
      now: Date.UTC(2026, 8, 20)
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: 'A New Film', acclaim: 86 });
    expect(rows[0].where.summary).toBe('Streaming on Netflix');
  });

  // The trap the first real run surfaced: TMDB logs re-releases and new
  // physical editions with fresh digital dates, so FIGHT CLUB (1999) turned
  // up in a list of this week's new releases.
  it('drops a reissued classic that only just got a new digital date', () => {
    const rows = shortlistReleases({
      candidates: [candidate({ id: 2, title: 'Fight Club', release_date: '1999-10-15', vote_count: 32887 })],
      enriched: new Map([enrich(2, streaming, { rt: 81, mc: 67 })]),
      now: Date.UTC(2026, 8, 20)
    });
    expect(rows).toEqual([]);
  });

  it('drops anything already in the library', () => {
    const rows = shortlistReleases({
      candidates: [candidate()],
      enriched: new Map([enrich(1, streaming, { rt: 92 })]),
      library: new Set([1]),
      now: Date.UTC(2026, 8, 20)
    });
    expect(rows).toEqual([]);
  });

  it('drops anything below the vote floor', () => {
    const rows = shortlistReleases({
      candidates: [candidate({ vote_count: VOTE_FLOOR - 1 })],
      enriched: new Map([enrich(1, streaming, { rt: 92 })]),
      now: Date.UTC(2026, 8, 20)
    });
    expect(rows).toEqual([]);
  });

  it('drops a film nothing carries yet, however good it is', () => {
    const rows = shortlistReleases({
      candidates: [candidate()],
      enriched: new Map([enrich(1, {}, { rt: 99, mc: 95 })]),
      now: Date.UTC(2026, 8, 20)
    });
    expect(rows).toEqual([]);
  });

  it('dedupes a film that appears on two discover pages', () => {
    const rows = shortlistReleases({
      candidates: [candidate(), candidate()],
      enriched: new Map([enrich(1, streaming, { rt: 92 })]),
      now: Date.UTC(2026, 8, 20)
    });
    expect(rows).toHaveLength(1);
  });

  it('ranks by acclaim, not by how many people voted', () => {
    const rows = shortlistReleases({
      candidates: [
        candidate({ id: 1, title: 'Loud and Bad', vote_count: 9000 }),
        candidate({ id: 2, title: 'Quiet and Good', vote_count: 400 })
      ],
      enriched: new Map([
        enrich(1, streaming, { rt: 15, mc: 35 }),
        enrich(2, streaming, { rt: 100, mc: 90 })
      ]),
      now: Date.UTC(2026, 8, 20)
    });
    expect(rows.map((r) => r.title)).toEqual(['Quiet and Good', 'Loud and Bad']);
  });

  // An unscored film must survive to the model with its nulls intact, so the
  // model can say "no critic has written about this yet" — but it must not
  // outrank a film critics actually liked.
  it('keeps an unscored film, ordered behind every scored one', () => {
    const rows = shortlistReleases({
      candidates: [
        candidate({ id: 1, title: 'Straight to Video', vote_count: 345 }),
        candidate({ id: 2, title: 'Reviewed', vote_count: 400 })
      ],
      enriched: new Map([
        enrich(1, streaming, {}),
        enrich(2, streaming, { rt: 40, mc: 45 })
      ]),
      now: Date.UTC(2026, 8, 20)
    });
    expect(rows.map((r) => r.title)).toEqual(['Reviewed', 'Straight to Video']);
    expect(rows[1].scores.rottenTomatoes).toBe(null);
  });

  // The live-data version of the same rule: a beloved-by-fans film with a big
  // IMDb and no critic score must not outrank a modestly-reviewed one.
  it('a high IMDb with no critic score does not outrank a reviewed film', () => {
    const rows = shortlistReleases({
      candidates: [
        candidate({ id: 1, title: 'Batman: Knightfall', vote_count: 345 }),
        candidate({ id: 2, title: 'Modestly Reviewed', vote_count: 400 })
      ],
      enriched: new Map([
        enrich(1, streaming, { imdb: 8.1 }),
        enrich(2, streaming, { rt: 52, mc: 53 })
      ]),
      now: Date.UTC(2026, 8, 20)
    });
    expect(rows.map((r) => r.title)).toEqual(['Modestly Reviewed', 'Batman: Knightfall']);
  });
});

describe('anniversariesThisWeek', () => {
  const film = (over) => ({ id: 1, title: 'Old Film', vote_count: 5000, ...over });

  it('finds a round anniversary falling inside the coming week', () => {
    const [hit] = anniversariesThisWeek(
      [film({ release_date: '1976-09-22' })],
      Date.UTC(2026, 8, 20)
    );
    expect(hit).toMatchObject({ title: 'Old Film', age: 50, daysAway: 2 });
  });

  it('counts an anniversary that is today', () => {
    const [hit] = anniversariesThisWeek(
      [film({ release_date: '2001-09-20' })],
      Date.UTC(2026, 8, 20)
    );
    expect(hit).toMatchObject({ age: 25, daysAway: 0 });
  });

  // A 37th is a date, not an anniversary. Roundness is the entire hook.
  it('ignores an un-round year', () => {
    expect(anniversariesThisWeek(
      [film({ release_date: '1989-09-22' })],
      Date.UTC(2026, 8, 20)
    )).toEqual([]);
  });

  it('ignores an anniversary just outside the window', () => {
    expect(anniversariesThisWeek(
      [film({ release_date: '1976-09-28' })],
      Date.UTC(2026, 8, 20)
    )).toEqual([]);
  });

  // A week that straddles New Year still has to find a 2 January anniversary.
  it('finds an anniversary in the next calendar year', () => {
    const [hit] = anniversariesThisWeek(
      [film({ release_date: '1997-01-02' })],
      Date.UTC(2026, 11, 29)
    );
    expect(hit).toMatchObject({ age: 30, daysAway: 4 });
  });

  it('puts the louder anniversary first, then the better-known film', () => {
    const ranked = anniversariesThisWeek([
      film({ id: 1, title: 'Turning ten', release_date: '2016-09-22' }),
      film({ id: 2, title: 'Turning fifty', release_date: '1976-09-22' }),
      film({ id: 3, title: 'Also fifty, less seen', release_date: '1976-09-23', vote_count: 12 })
    ], Date.UTC(2026, 8, 20));
    expect(ranked.map((a) => a.title)).toEqual(['Turning fifty', 'Also fifty, less seen', 'Turning ten']);
  });

  it('skips a film with no usable release date', () => {
    expect(anniversariesThisWeek([film({ release_date: '' }), film({ id: 2 })], Date.UTC(2026, 8, 20)))
      .toEqual([]);
  });
});

describe('issueBrief', () => {
  it('hands the model nulls rather than holes to fill', () => {
    const brief = issueBrief({
      shortlist: [{
        id: 7, title: 'Unreviewed', year: 2026, director: null, genres: [], overview: '',
        scores: { rottenTomatoes: null, metacritic: null, imdb: null },
        where: { summary: 'Streaming on Netflix', stream: ['Netflix'], rent: [] }
      }],
      features: [],
      weekOf: '2026-09-18'
    });
    expect(brief.releases[0]).toMatchObject({
      rottenTomatoes: null, metacritic: null, availability: 'Streaming on Netflix'
    });
  });
});

describe('weekKey', () => {
  it('is the Friday an issue belongs to', () => {
    expect(weekKey(Date.UTC(2026, 8, 18))).toBe('2026-09-18');   // a Friday
    expect(weekKey(Date.UTC(2026, 8, 20))).toBe('2026-09-18');   // Sunday after
    expect(weekKey(Date.UTC(2026, 8, 24))).toBe('2026-09-18');   // Thursday after
    expect(weekKey(Date.UTC(2026, 8, 25))).toBe('2026-09-25');   // next Friday
  });

  // A retry, a manual rebuild and the scheduled run must land on ONE issue
  // rather than stacking three up.
  it('gives every moment in a week the same issue id', () => {
    const keys = [18, 19, 20, 21, 22, 23, 24].map((d) => weekKey(Date.UTC(2026, 8, d, 13)));
    expect(new Set(keys).size).toBe(1);
  });
});

describe('issueDue', () => {
  const friday = Date.UTC(2026, 8, 18, 13);
  const tuesday = Date.UTC(2026, 8, 22, 13);

  it('sends on Friday when the week has no issue yet', () => {
    expect(issueDue({ prefs: { newsletter: true }, now: friday }))
      .toMatchObject({ due: true, weekKey: '2026-09-18' });
  });

  it('does not send twice for the same week', () => {
    expect(issueDue({ prefs: { newsletter: true }, lastIssue: '2026-09-18', now: friday }).due).toBe(false);
  });

  it('does not send on other days', () => {
    expect(issueDue({ prefs: { newsletter: true }, now: tuesday }).due).toBe(false);
  });

  it('stays quiet for anyone who has not opted in', () => {
    expect(issueDue({ prefs: {}, now: friday }).due).toBe(false);
  });

  // Matt asked for an always-on testing mode. It bypasses the schedule...
  it('always-on ignores the day and the already-sent check', () => {
    expect(issueDue({ prefs: { newsletter: true }, lastIssue: '2026-09-18', now: tuesday, alwaysOn: true }).due)
      .toBe(true);
  });

  // ...but it must never bypass the opt-in, or testing would push an issue at
  // somebody who turned the newsletter off.
  it('always-on still respects an account that opted out', () => {
    expect(issueDue({ prefs: { newsletter: false }, now: friday, alwaysOn: true }).due).toBe(false);
  });
});

// The newsletter Lambda and the push Lambda each discover accounts by
// shallow-listing the database root, so both need the same list of roots that
// are NOT people. The first draft of newsletter.js guessed it and got it wrong
// in both directions — it carried Movie Hat's `requests`/`siteUsers` and
// omitted `testing-database`, which is a real readable account (devMode's)
// that would have been sent a newsletter.
describe('the two Lambdas agree on what is not an account', () => {
  const roots = (file) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8');
    const block = source.match(/NON_ACCOUNT_ROOTS = new Set\(\[([\s\S]*?)\]\)/);
    expect(block, `NON_ACCOUNT_ROOTS not found in ${file}`).toBeTruthy();
    return (block[1].match(/'[^']+'/g) || []).map((s) => s.slice(1, -1)).sort();
  };

  it('has identical NON_ACCOUNT_ROOTS in both files', () => {
    expect(roots('../../aws-lambda/newsletter.js'))
      .toEqual(roots('../../aws-lambda/push-notify.js'));
  });

  it('excludes testing-database, which is a real account devMode writes to', () => {
    expect(roots('../../aws-lambda/newsletter.js')).toContain('testing-database');
  });
});

describe('featureCandidates', () => {
  const anniversary = (over) => ({
    id: 1, title: 'Turning Fifty', year: 1976, releaseDate: '1976-09-22',
    age: 50, daysAway: 2, weight: 90, voteCount: 4000, overview: '', ...over
  });
  const trend = (over) => ({
    id: 9, title: 'Back Again', release_date: '1999-03-31', vote_count: 20000,
    overview: '', ...over
  });

  it('ranks a big anniversary above a film that is merely trending', () => {
    const ranked = featureCandidates({
      anniversaries: [anniversary()],
      trending: [trend()],
      now: Date.UTC(2026, 8, 20)
    });
    expect(ranked.map((f) => f.title)).toEqual(['Turning Fifty', 'Back Again']);
    expect(ranked[1]).toMatchObject({ reason: 'trending', turning: null });
  });

  // Matt, 2026-09-20: "something's in the zeitgeist". A film back in
  // circulation should beat a minor birthday nobody would notice.
  it('ranks a trending film above a 15th anniversary', () => {
    const ranked = featureCandidates({
      anniversaries: [anniversary({ id: 2, title: 'Turning Fifteen', age: 15, weight: 45 })],
      trending: [trend()],
      now: Date.UTC(2026, 8, 20)
    });
    expect(ranked[0].title).toBe('Back Again');
  });

  it('a film with BOTH claims outranks either alone', () => {
    const ranked = featureCandidates({
      anniversaries: [
        anniversary({ id: 1, title: 'Just A Birthday', age: 40, weight: 75 }),
        anniversary({ id: 2, title: 'Birthday And Back', age: 40, weight: 75, voteCount: 10 })
      ],
      trending: [trend({ id: 2, title: 'Birthday And Back', release_date: '1986-09-22' })],
      now: Date.UTC(2026, 8, 20)
    });
    expect(ranked[0]).toMatchObject({ title: 'Birthday And Back', reason: 'anniversary', alsoTrending: true });
  });

  // Trending is full of this year's films; only an OLD one being back means
  // anything.
  it('ignores a new release in the trending list', () => {
    const ranked = featureCandidates({
      anniversaries: [],
      trending: [trend({ id: 5, title: 'Out Last Month', release_date: '2026-08-01' })],
      now: Date.UTC(2026, 8, 20)
    });
    expect(ranked).toEqual([]);
  });

  it('ignores a trending entry with no usable release date', () => {
    expect(featureCandidates({
      anniversaries: [], trending: [trend({ id: 6, release_date: '' })], now: Date.UTC(2026, 8, 20)
    })).toEqual([]);
  });

  it('carries the occasion through, so the page can say why', () => {
    const [first] = featureCandidates({
      anniversaries: [anniversary({ daysAway: 0 })], trending: [], now: Date.UTC(2026, 8, 20)
    });
    expect(first).toMatchObject({ reason: 'anniversary', turning: 50, daysAway: 0, releaseDate: '1976-09-22' });
  });
});
