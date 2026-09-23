// One TMDB /search/person lookup per name, for the life of the page.
//
// The Favorite sections, the Trophy Case and Year in Review each carry their
// own copy of this fetch with their own per-instance cache. Deep Stats needs
// the same lookup (splitting a decade's cast into Actor and Actress takes a
// gender per name), and switching decades back and forth must not re-ask
// TMDB for people it has already been told about — so the cache lives at
// module scope, and an in-flight promise is shared rather than duplicated.
//
// A miss (no result, network down, rate limited) resolves to null and is
// cached too, so an unreachable API costs one failed request per name and
// never a retry storm.
import ErrorLogService from '../services/ErrorLogService.js';
import { fetchWithTimeout } from './networkHealth.js';

const cache = new Map();
const inFlight = new Map();

export async function lookupPerson (name) {
  if (!name) return null;
  if (cache.has(name)) return cache.get(name);
  if (inFlight.has(name)) return inFlight.get(name);

  const query = encodeURIComponent(name);
  const url = `https://api.themoviedb.org/3/search/person?api_key=${process.env.VUE_APP_TMDB_API_KEY}&query=${query}`;
  const lookup = (async () => {
    try {
      const response = await fetchWithTimeout(url);
      if (!response.ok) throw new Error(`TMDB search/person returned ${response.status}`);
      const data = await response.json();
      return data?.results?.length ? data.results[0] : null;
    } catch (error) {
      ErrorLogService.error('Error fetching TMDB person:', error);
      return null;
    }
  })().then((details) => {
    cache.set(name, details);
    inFlight.delete(name);
    return details;
  });

  inFlight.set(name, lookup);
  return lookup;
}

// Tests only: the module-level cache would otherwise leak between cases.
export function resetPersonLookupCache () {
  cache.clear();
  inFlight.clear();
}
