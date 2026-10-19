// Names the cause of a burst of requests, so a Sentry "N+1 API Call" alert
// says what it was without anyone opening its spans (2026-10-19).
//
// Sentry decides what is an N+1 on its own servers; nothing here can stop the
// alert. What the app can do is tag the transaction it sends: the largest
// group of same-shaped requests, named when it is one of the known bursts
// (.claude/rules/data-writes.md), or `unknown` with its pattern when it isn't.
// A known label at its usual rate is expected; `unknown` means look.

// Below this many same-shaped requests in one transaction nothing is tagged.
// Sentry's detector wants a run of several; five keeps ordinary pairs quiet.
export const BURST_MIN_COUNT = 5;

const KNOWN_BURSTS = [
  { label: 'movie-hat-read', test: (host) => host.startsWith('movie-hat-') },
  { label: 'tmdb-person-lookups', test: (host, path) => host === 'api.themoviedb.org' && /\/search\/person$/.test(path) },
  { label: 'tmdb-company-lookups', test: (host, path) => host === 'api.themoviedb.org' && /\/search\/company$/.test(path) },
  { label: 'tmdb-keyword-lookups', test: (host, path) => host === 'api.themoviedb.org' && /\/search\/keyword$/.test(path) },
  { label: 'tmdb-movie-search', test: (host, path) => host === 'api.themoviedb.org' && /\/search\/movie$/.test(path) }
];

/** The URL a fetch/xhr span requested, or null for any other span. */
function spanUrl (span) {
  if (!span || !String(span.op || '').startsWith('http')) return null;
  const fromData = span.data?.url || span.data?.['http.url'];
  if (typeof fromData === 'string') return fromData;
  const match = typeof span.description === 'string' && span.description.match(/(https?:\/\/\S+)/);
  return match ? match[1] : null;
}

// A path segment that names one thing among many: an id, a key, a title.
// One digit alone is a version (TMDB's `/3/`), not an id.
function isVariable (segment) {
  return /\d{2,}/.test(segment) || segment.includes('%') || segment.length > 24;
}

/**
 * The request's shape: host and path, query dropped, ids starred. Movie Hat
 * paths carry hat titles and keys, so everything under the first segment is
 * starred except the `movies.json` leaf.
 */
export function requestPattern (url) {
  let parsed;
  try { parsed = new URL(url); } catch { return null; }
  const host = parsed.hostname;
  const segments = parsed.pathname.split('/').filter(Boolean);
  const shaped = host.startsWith('movie-hat-')
    ? segments.map((s, i) => (i === 0 || s === 'movies.json' ? s : '*'))
    : segments.map((s) => (isVariable(s) ? '*' : s));
  return { host, path: `/${shaped.join('/')}` };
}

/** The label for a request pattern: a known burst's name, or `unknown`. */
export function burstCause ({ host, path }) {
  return KNOWN_BURSTS.find((known) => known.test(host, path))?.label || 'unknown';
}

/** The largest group of same-shaped requests in a transaction, if it is a burst. */
export function findBurst (event) {
  const groups = new Map();
  for (const span of event?.spans || []) {
    const url = spanUrl(span);
    const shape = url && requestPattern(url);
    if (!shape) continue;
    const key = `${shape.host}${shape.path}`;
    const group = groups.get(key) || { ...shape, count: 0 };
    group.count += 1;
    groups.set(key, group);
  }
  let largest = null;
  for (const group of groups.values()) if (!largest || group.count > largest.count) largest = group;
  if (!largest || largest.count < BURST_MIN_COUNT) return null;
  return { cause: burstCause(largest), pattern: `${largest.host}${largest.path}`.slice(0, 200), count: largest.count };
}

/** Sentry `beforeSendTransaction` step: tags the event with its burst, if any. */
export function labelBurst (event) {
  const burst = findBurst(event);
  if (!burst) return event;
  event.tags = { ...event.tags, burst_cause: burst.cause, burst_count: String(burst.count), burst_pattern: burst.pattern };
  return event;
}
