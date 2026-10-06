// Credentials out of URLs before anything leaves for Sentry.
//
// Firebase's REST API takes the sign-in token only as `?auth=`, TMDB its key
// only as `?api_key=`, so every traced fetch and every fetch breadcrumb
// carried them. Found 2026-10-06 in an "N+1 API Call" alert whose nine spans
// were Movie Hat reads, each URL ending in Matt's Firebase ID token. The
// tokens expire within the hour, but Sentry keeps events for 90 days, and
// a key is a key.
const SECRET_PARAMS = new Set(['auth', 'access_token', 'api_key', 'apikey', 'key', 'token', 'testtoken', 'secret', 'id_token']);

/** The same URL with every secret-looking query value replaced by [Filtered]. */
export function scrubUrl (url) {
  if (typeof url !== 'string' || !url.includes('?')) return url;
  const at = url.indexOf('?');
  const hashAt = url.indexOf('#', at);
  const query = url.slice(at + 1, hashAt < 0 ? undefined : hashAt);
  const rest = hashAt < 0 ? '' : url.slice(hashAt);
  const scrubbed = query.split('&').map((pair) => {
    const eq = pair.indexOf('=');
    if (eq < 0) return pair;
    const name = pair.slice(0, eq);
    return SECRET_PARAMS.has(decodeURIComponent(name).toLowerCase()) ? `${name}=[Filtered]` : pair;
  }).join('&');
  return `${url.slice(0, at)}?${scrubbed}${rest}`;
}

const URL_KEYS = ['url', 'http.url', 'server.address', 'description'];

/** Scrubs the URLs a Sentry span carries: its description and its data. */
export function scrubSpan (span) {
  if (!span) return span;
  if (typeof span.description === 'string') span.description = scrubUrl(span.description);
  if (span.data) for (const key of URL_KEYS) if (typeof span.data[key] === 'string') span.data[key] = scrubUrl(span.data[key]);
  return span;
}

/** Sentry `beforeBreadcrumb`: fetch/xhr breadcrumbs carry the URL in data.url. */
export function scrubBreadcrumb (crumb) {
  if (crumb?.data?.url) crumb.data.url = scrubUrl(crumb.data.url);
  if (typeof crumb?.message === 'string') crumb.message = scrubUrl(crumb.message);
  return crumb;
}

/** Sentry `beforeSend` / `beforeSendTransaction`: the request URL, breadcrumbs and spans. */
export function scrubEvent (event) {
  if (!event) return event;
  if (event.request?.url) event.request.url = scrubUrl(event.request.url);
  if (Array.isArray(event.breadcrumbs)) event.breadcrumbs.forEach(scrubBreadcrumb);
  if (Array.isArray(event.spans)) event.spans.forEach(scrubSpan);
  if (event.contexts?.trace) scrubSpan(event.contexts.trace);
  return event;
}
