// Where the newsletter's facts come from: TMDB for what became available and
// where it can be watched, OMDb for what critics scored it.
//
// Split out of newsletter.js so it can be imported WITHOUT web-push or the
// Anthropic SDK — scripts/newsletter-dry-run.mjs builds a real brief from a
// laptop with no VAPID keys and no model access, which is how the pipeline
// gets checked against live data before anything is deployed.
//
// `fetch` is the only dependency. Nothing here decides anything; every
// judgement lives in newsletterCompose.js.

const TMDB = 'https://api.themoviedb.org/3';

// --- The facts ---------------------------------------------------------------

const json = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url.replace(/api_key=[^&]+/, 'api_key=***')} failed: ${res.status}`);
  return res.json();
};

/**
 * Everything that reached streaming or rental in the window.
 *
 * `with_release_type=4|5` is digital and physical — the dates that mean "you
 * can watch this at home now", as opposed to a theatrical date months
 * earlier. Three pages is sixty candidates, which on a measured real week
 * (2026-09-06..19) was comfortably more than enough to find eleven worth
 * considering.
 */
const discoverReleases = async (key, startISO, endISO, pages = 3) => {
  const out = [];
  for (let page = 1; page <= pages; page += 1) {
    const data = await json(`${TMDB}/discover/movie?api_key=${key}&region=US&with_release_type=4|5`
      + `&release_date.gte=${startISO}&release_date.lte=${endISO}&sort_by=popularity.desc&page=${page}`);
    out.push(...(data.results || []));
    if (page >= (data.total_pages || 1)) break;
  }
  return out;
};

/**
 * Providers, genres, director and critic scores for one candidate.
 *
 * Every failure here is swallowed into an empty enrichment rather than thrown:
 * one film whose OMDb lookup 500s must not cost the whole issue, and
 * shortlistReleases already treats a missing score as unknown and a missing
 * provider as "not available", both of which are the right answers.
 */
const enrichCandidate = async (key, omdbKey, movie) => {
  try {
    const [providers, details] = await Promise.all([
      json(`${TMDB}/movie/${movie.id}/watch/providers?api_key=${key}`),
      json(`${TMDB}/movie/${movie.id}?api_key=${key}&append_to_response=credits`)
    ]);
    const director = (details.credits?.crew || []).find((c) => c.job === 'Director')?.name || null;
    let omdb = null;
    if (details.imdb_id && omdbKey) {
      omdb = await json(`https://www.omdbapi.com/?i=${details.imdb_id}&apikey=${omdbKey}`)
        .catch(() => null);
    }
    return {
      providers,
      omdb,
      director,
      imdbId: details.imdb_id || null,
      runtime: details.runtime || null,
      posterPath: details.poster_path || null,
      backdropPath: details.backdrop_path || null,
      releaseDate: details.release_date || null,
      genres: (details.genres || []).map((g) => g.name)
    };
  } catch (error) {
    console.error(`Enrichment failed for ${movie.id} (${movie.title}):`, error.message);
    return {};
  }
};

/**
 * Candidates for the anniversary piece: well-known films released on this
 * week's dates in years gone by.
 *
 * Pulled from TMDB by release-date window across each candidate year rather
 * than from the library, because the section is "a film worth writing about
 * this week", not "a film you own". A vote floor keeps it to films a reader
 * has plausibly heard of — a 50th anniversary of something nobody saw is not
 * a hook, it is a coincidence.
 */
const anniversaryPool = async (key, now) => {
  const today = new Date(now);
  const films = [];
  const ANNIVERSARIES = [10, 15, 20, 25, 30, 40, 50, 60, 70, 75, 80, 90, 100];
  for (const age of ANNIVERSARIES) {
    const year = today.getUTCFullYear() - age;
    const start = new Date(Date.UTC(year, today.getUTCMonth(), today.getUTCDate()));
    const end = new Date(start.getTime() + 6 * 86400000);
    const iso = (d) => d.toISOString().slice(0, 10);
    try {
      const data = await json(`${TMDB}/discover/movie?api_key=${key}&region=US`
        + `&primary_release_date.gte=${iso(start)}&primary_release_date.lte=${iso(end)}`
        + '&sort_by=vote_count.desc&vote_count.gte=500&page=1');
      films.push(...(data.results || []).slice(0, 6));
    } catch (error) {
      console.error(`Anniversary pool for ${year} failed:`, error.message);
    }
  }
  return films;
};

/**
 * Films in TMDB's weekly trending list that are NOT new.
 *
 * An old film back in circulation is having a moment for a reason we cannot
 * see from here — a re-release, a death, an awards run, a reference in
 * something new — and the effect is enough to justify a piece even when the
 * cause is invisible. The age filter is applied by featureCandidates, not
 * here; this just fetches the week's list.
 */
const trendingThisWeek = async (key) => {
  const data = await json(`${TMDB}/trending/movie/week?api_key=${key}&region=US`);
  return data.results || [];
};

/**
 * Poster and backdrop for one film, so the feature can carry a hat button
 * with the fields toHatMovie actually reads.
 */
const filmCard = async (key, id) => {
  const d = await json(`${TMDB}/movie/${id}?api_key=${key}`);
  return {
    id: d.id,
    title: d.title || '',
    poster_path: d.poster_path || null,
    backdrop_path: d.backdrop_path || null,
    release_date: d.release_date || '',
    overview: d.overview || '',
    vote_average: Number.isFinite(d.vote_average) ? d.vote_average : null
  };
};

module.exports = { json, discoverReleases, enrichCandidate, anniversaryPool, trendingThisWeek, filmCard };
