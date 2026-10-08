// House module for the Lambdas (2026-10-08): errors to Sentry without the SDK.
//
// Twenty-one Lambda errors in thirty days sat in CloudWatch where nobody
// looks. @sentry/aws-serverless would report them, at the price of
// OpenTelemetry in every bundle and a slower cold start, for functions that
// run once a minute. Sentry's envelope endpoint takes a plain POST, so this
// is the whole client. `createReporter({ dsn, functionName })` gives:
//
//   wrapHandler(handler)   reports a thrown error and RETHROWS it (Lambda's
//                          retry and its Errors metric are unchanged);
//                          reports console.error calls made during the
//                          invocation, once per message shape; warns a
//                          second and a half before the timeout.
//   captureException(err)  for a caught error worth a card anyway.
//   captureMessage(text)   level 'error' unless told otherwise.
//
// Query-string credentials (?auth=, ?api_key=, ...) are scrubbed from every
// string that leaves, the way utils/scrubUrl.js does in the browser. Nothing
// here can throw into the handler: a failed send is one console.warn.
//
// Byte-identical in every repo that has Lambdas. Change it in one, copy.
const crypto = require('crypto');

const SCRUB = /([?&](?:auth|api_key|key|token|access_token|id_token|secret)=)[^&\s"']+/gi;
const scrub = (text) => String(text ?? '').replace(SCRUB, '$1[Filtered]');

function parseDsn (dsn) {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(String(dsn || ''));
  return m ? { key: m[1], host: m[2], project: m[3] } : null;
}

// Sentry wants frames oldest-first; a Node stack lists them newest-first.
function framesFrom (stack) {
  const lines = String(stack || '').split('\n').slice(1);
  const frames = [];
  for (const line of lines) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2];
    frames.push({
      function: m[1] || '<anonymous>',
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules|node:internal|^internal\//.test(filename)
    });
  }
  return frames.reverse();
}

/** The particulars removed, so repeats of one message are one issue. */
function normalize (message) {
  return String(message ?? '')
    .replace(/https?:\/\/\S+/g, 'URL')
    .replace(/"[^"]*"|'[^']*'/g, '"…"')
    .replace(/\b[0-9a-f]{8,}\b/gi, 'ID')
    .replace(/\d+(\.\d+)?/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function describeArg (arg) {
  if (arg instanceof Error) return arg.message;
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

function createReporter ({ dsn, functionName, release, environment = 'lambda', tags = {}, fetchFn = globalThis.fetch, now = Date.now }) {
  const parsed = parseDsn(dsn);

  async function send (event) {
    if (!parsed || typeof fetchFn !== 'function') return false;
    const eventId = crypto.randomBytes(16).toString('hex');
    const envelope = [
      JSON.stringify({ event_id: eventId, sent_at: new Date(now()).toISOString(), dsn }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify({
        event_id: eventId,
        timestamp: now() / 1000,
        platform: 'node',
        environment,
        release,
        server_name: functionName,
        ...event,
        tags: { runtime: 'lambda', function: functionName, ...tags, ...(event.tags || {}) }
      })
    ].join('\n');
    try {
      const res = await fetchFn(`https://${parsed.host}/api/${parsed.project}/envelope/`, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-sentry-envelope',
          'x-sentry-auth': `Sentry sentry_version=7, sentry_key=${parsed.key}, sentry_client=house-lambda/1.0`
        },
        body: envelope,
        signal: AbortSignal.timeout(3000)
      });
      if (!res.ok) console.warn(`[sentry] not sent: ${res.status}`);
      return res.ok;
    } catch (error) {
      console.warn(`[sentry] not sent: ${error.message}`);
      return false;
    }
  }

  function captureException (error, { extra, handled = true, message } = {}) {
    const err = error instanceof Error ? error : new Error(describeArg(error));
    return send({
      level: 'error',
      message: message ? scrub(message) : undefined,
      exception: { values: [{ type: err.name || 'Error', value: scrub(err.message), stacktrace: { frames: framesFrom(err.stack) }, mechanism: { type: handled ? 'generic' : 'lambda', handled } }] },
      tags: { handled: handled ? 'yes' : 'no' },
      extra: extra ? scrubDeep(extra) : undefined
    });
  }

  function captureMessage (message, level = 'error', { extra, fingerprint } = {}) {
    const text = scrub(message);
    return send({
      level,
      message: text,
      logger: 'console',
      fingerprint: fingerprint || ['console', normalize(text)],
      tags: { handled: 'console' },
      extra: extra ? scrubDeep(extra) : undefined
    });
  }

  function wrapHandler (handler) {
    return async (event, context) => {
      const pending = [];
      const seen = new Set();
      const original = console.error;
      console.error = (...args) => {
        original.apply(console, args);
        const text = args.map(describeArg).join(' ');
        const key = normalize(text);
        if (seen.has(key)) return;
        seen.add(key);
        const error = args.find((a) => a instanceof Error);
        pending.push(error
          ? captureException(error, { message: text, extra: { arguments: args.filter((a) => a !== error).map(describeArg) } })
          : captureMessage(text));
      };
      let timer = null;
      const remaining = context?.getRemainingTimeInMillis?.();
      if (remaining > 3000) {
        timer = setTimeout(() => { pending.push(captureMessage(`${functionName} is about to time out`, 'warning', { fingerprint: ['lambda-timeout', functionName] })); }, remaining - 1500);
      }
      try {
        return await handler(event, context);
      } catch (error) {
        await captureException(error, { handled: false });
        throw error;
      } finally {
        if (timer) clearTimeout(timer);
        console.error = original;
        await Promise.allSettled(pending);
      }
    };
  }

  return { captureException, captureMessage, wrapHandler };
}

function scrubDeep (value) {
  if (typeof value === 'string') return scrub(value);
  if (Array.isArray(value)) return value.map(scrubDeep);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)]));
  return value;
}

module.exports = { createReporter, framesFrom, normalize, scrub, parseDsn };
