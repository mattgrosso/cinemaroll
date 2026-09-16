// The kind registry: everything one kind of filter chip knows how to do,
// in one place. Phase 3 of the filter redesign.
//
// Before this, a chip kind's behaviours were spread across the codebase —
// how it matches a movie locally lived in applyFilter's switch, how it maps
// into a TMDB /discover question lived in partitionFilters, and adding a
// new kind meant finding every one of those places. Now a kind is one entry
// here, and the consumers iterate the registry:
//
//   matchLocal(result, filter, s) — does this movie satisfy the chip? `s` is
//     the precomputed search-fields object from buildSearchFields.
//   discoverGroup — which slot of the More from question this chip fills:
//     'genres' | 'people' | 'companies' | 'keywords' | 'years' | 'ranges' |
//     'texts' (free text leads a title search) | 'local' (ours alone — TMDB
//     has nothing to say about a viewing tag).
//
// Every matcher body is byte-for-byte the logic from applyFilter's old
// switch; the existing filtering tests (ChipFiltering, searchFiltering,
// QuickLinksFiltering) hold the behaviour still while the shape changes.

import { normalizeSearchText } from './searchText.js';
import { titleMatchesValue } from './numberWords.js';

/** Inclusive list of year strings between a {startYear, endYear} range. */
export function getListOfYearsFromRange (yearRange) {
  if (!yearRange || typeof yearRange !== 'object' || !yearRange.startYear || !yearRange.endYear) {
    return [];
  }
  const years = [];
  for (let year = yearRange.startYear; year <= yearRange.endYear; year++) {
    years.push(year.toString());
  }
  return years;
}

export const FILTER_KINDS = {
  general: {
    discoverGroup: 'texts',
    matchLocal (result, filter, s) {
      const searchValue = normalizeSearchText(filter.value);
      return titleMatchesValue(s, filter.value) ||
        s.keywords.some(keyword => keyword === searchValue) ||
        s.genres.some(genre => genre === searchValue) ||
        s.places.some(place => place === searchValue) ||
        // Tags are the user's own words, typed from memory, so a part of one
        // ("focus" for "back focus") should reach it the way a surname
        // reaches a cast name — unlike keywords and genres, which are TMDB's
        // vocabulary and have the typeahead to complete them.
        s.tags.some(tag => tag.includes(searchValue)) ||
        // A name-part (split on space) is always a substring of the full name,
        // so checking the full name covers part matches too.
        s.cast.some(name => name.includes(searchValue)) ||
        s.crew.some(person => person.name.includes(searchValue)) ||
        s.companies.some(company => company.includes(searchValue));
    }
  },

  person: {
    discoverGroup: 'people',
    matchLocal (result, filter, s) {
      const filterValueLower = normalizeSearchText(filter.value);
      if (!filterValueLower) return false;
      // Whole name, or the surname alone. Hyphens are already spaces by now, so
      // "jean pierre jeunet" reaches the same string as "Jean-Pierre Jeunet".
      const matches = (name) =>
        name === filterValueLower || name.split(' ').slice(-1)[0] === filterValueLower;

      return s.cast.some(matches) || s.crew.some(person => matches(person.name));
    }
  },

  year: {
    discoverGroup: 'years',
    matchLocal (result, filter) {
      // Extract year directly from release_date string to avoid timezone issues.
      // Guard against entries with no release_date — an unguarded .substring would
      // throw and blank the entire filtered result set.
      if (!result.movie.release_date) return false;
      const movieYear = result.movie.release_date.substring(0, 4);
      // String(): a year chip built from a number would never match otherwise.
      return movieYear === String(filter.value);
    }
  },

  yearRange: {
    discoverGroup: 'ranges',
    matchLocal (result, filter) {
      if (!result.movie.release_date) return false;
      const years = getListOfYearsFromRange(filter.value);
      return years.includes(result.movie.release_date.substring(0, 4));
    }
  },

  // genre/company/keyword used to compare the RAW typed text against the raw
  // TMDB name, case-sensitively. A chip built from the library always matched,
  // so this looked fine — but typing "warner bros. pictures" yourself matched
  // nothing at all. They compare normalized now, against the precomputed
  // fields, which is both more forgiving and cheaper.
  genre: {
    discoverGroup: 'genres',
    matchLocal (result, filter, s) {
      return s.genres.some(genre => genre === normalizeSearchText(filter.value));
    }
  },

  company: {
    discoverGroup: 'companies',
    matchLocal (result, filter, s) {
      return s.companies.some(company => company === normalizeSearchText(filter.value));
    }
  },

  keyword: {
    discoverGroup: 'keywords',
    matchLocal (result, filter, s) {
      return s.keywords.some(keyword => keyword === normalizeSearchText(filter.value));
    }
  },

  // A place a film was shot in or set in (Wikidata, see places.js). Exact
  // match like keyword/genre: "York" must not pull in New York. Local only —
  // TMDB has no idea where anything was filmed.
  place: {
    discoverGroup: 'local',
    matchLocal (result, filter, s) {
      return s.places.some(place => place === normalizeSearchText(filter.value));
    }
  },

  tag: {
    discoverGroup: 'local',
    matchLocal (result, filter) {
      // Tags are user-authored, so their capitalisation is a display choice,
      // not part of their identity.
      const tagValue = normalizeSearchText(filter.value);
      return Boolean(result.ratings) && result.ratings.some(rating =>
        rating.tags && rating.tags.some(tag => normalizeSearchText(tag.title) === tagValue)
      );
    }
  },

  title: {
    discoverGroup: 'local',
    matchLocal (result, filter, s) {
      // A value that normalizes to nothing leaves `includes('')` true, i.e. no
      // constraint — the whole library, not a blank screen (ChipFiltering).
      return titleMatchesValue(s, filter.value);
    }
  },

  director: {
    discoverGroup: 'local',
    matchLocal (result, filter, s) {
      const value = normalizeSearchText(filter.value);
      return s.crew.some(person => person.job === 'Director' && person.name.includes(value));
    }
  },

  producer: {
    discoverGroup: 'local',
    matchLocal (result, filter, s) {
      const value = normalizeSearchText(filter.value);
      return s.crew.some(person => person.jobLower.includes('producer') && person.name.includes(value));
    }
  },

  cast: {
    discoverGroup: 'local',
    matchLocal (result, filter, s) {
      const value = normalizeSearchText(filter.value);
      return s.cast.some(name => name.includes(value));
    }
  },

  // A curated view — Best Picture, Annual Best, This Month… (Phase 4: quick
  // links are chips now, not a parallel mode). A list is not a per-movie
  // predicate: it selects the BASE result set (it can aggregate, like the
  // best of each year, or add unrated placeholder entries, like unwatched
  // winners), which happens in unifiedFilteredResults before the chip loop
  // runs. So in the AND loop it is neutral, and TMDB is never asked about
  // it.
  list: {
    discoverGroup: 'local',
    matchLocal () {
      return true;
    }
  }
};

/** The registry entry for a chip, or null for a type nothing defines. */
export function kindFor (type) {
  return FILTER_KINDS[type] || null;
}
