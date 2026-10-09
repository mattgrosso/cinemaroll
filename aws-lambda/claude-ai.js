const Anthropic = require('@anthropic-ai/sdk');
const crypto = require('crypto');
const { DynamoDBClient, UpdateItemCommand, GetItemCommand, PutItemCommand } = require('@aws-sdk/client-dynamodb');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const critics = require('./criticReviews');

const client = new Anthropic();

// MODEL CHOICE IS A COST DECISION. Every prompt here is just a title and a
// year, so none of this needs a frontier model. All three routes used to be on
// Opus ($5/$25 per M tokens), which at ~5k calls/day would be roughly
// $3,000/month.
//
//   keywords -> Haiku. Thematic labels; nothing to get factually wrong.
//   context / trivia -> Sonnet. These have to be TRUE, and cheap models
//     confabulate hardest on obscure factual recall. Trivia in particular is
//     unverifiable to the player, so a wrong "fact" just quietly becomes part
//     of the game. Still materially cheaper than Opus.
//
// If trivia quality holds up on Sonnet, dropping it to Haiku is a one-line
// further saving.
const MODELS = {
  keywords: 'claude-haiku-4-5-20251001',
  context: 'claude-sonnet-5',
  trivia: 'claude-sonnet-5',
  // The watchlist prompt picks and orders titles against a short taste
  // profile. It is a judgement call, not a factual recall problem - if it
  // suggests something you don't fancy, you can see that from the title and
  // scroll on. Haiku is the right tier for that, and this is the one route a
  // person can type into, so it is also the one whose cost could run away.
  watchlist: 'claude-haiku-4-5-20251001',
  // Critics' reviews: the model searches the web and judges which reviews are
  // worth reading. A judgement call over real search results, not recall, but
  // the judging is the feature, so Sonnet rather than Haiku. Each film is
  // looked up ONCE for everybody and stored (see getReviews), so this is
  // cents per film, not per view.
  reviews: 'claude-sonnet-5-5'
};

// This endpoint spends money on every call and its URL is baked into the
// public client bundle, so it cannot be open. CORS is NOT the gate — it only
// constrains browsers, and anything server-side ignores it — the Firebase ID
// token below is.
const ALLOWED_ORIGINS = [
  'https://www.cinemaroll.org',
  'https://cinemaroll.org',
  'http://localhost:8080'
];

const FIREBASE_PROJECT_ID = 'movie-log-8c4d5';
const FIREBASE_CERT_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

const corsHeaders = (origin) => ({
  'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json'
});

// Set per-invocation so the response echoes the caller's origin.
let activeOrigin = ALLOWED_ORIGINS[0];

const response = (statusCode, body) => ({
  statusCode,
  headers: corsHeaders(activeOrigin),
  body: JSON.stringify(body)
});

// --- Firebase ID token verification -----------------------------------------
// Done with node's built-in crypto rather than firebase-admin: it's ~40 lines,
// and it keeps the deployment zip small and free of a dependency that would
// need keeping up to date. Requires Node 18+ for global fetch (the function
// runs on nodejs22.x).

let certCache = { keys: null, expiresAt: 0 };

const fetchCerts = async () => {
  if (certCache.keys && Date.now() < certCache.expiresAt) {
    return certCache.keys;
  }

  const res = await fetch(FIREBASE_CERT_URL);
  if (!res.ok) throw new Error(`Could not fetch Firebase certs: ${res.status}`);
  const keys = await res.json();

  // Google tells us how long these are good for; honour it rather than
  // re-fetching on every cold container.
  const maxAge = Number((/max-age=(\d+)/.exec(res.headers.get('cache-control') || '') || [])[1] || 3600);
  certCache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
};

const fromBase64Url = (value) =>
  Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

const verifyIdToken = async (authorization) => {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header;
  let payload;
  try {
    header = JSON.parse(fromBase64Url(parts[0]).toString('utf8'));
    payload = JSON.parse(fromBase64Url(parts[1]).toString('utf8'));
  } catch {
    return null;
  }

  if (header.alg !== 'RS256' || !header.kid) return null;

  const certs = await fetchCerts();
  const cert = certs[header.kid];
  if (!cert) return null;

  const signatureValid = crypto.verify(
    'RSA-SHA256',
    Buffer.from(`${parts[0]}.${parts[1]}`),
    crypto.createPublicKey(cert),
    fromBase64Url(parts[2])
  );
  if (!signatureValid) return null;

  // Every one of these matters: without the audience and issuer checks a valid
  // token from ANY Firebase project would be accepted.
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp <= now) return null;
  if (payload.aud !== FIREBASE_PROJECT_ID) return null;
  if (payload.iss !== `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`) return null;
  if (!payload.sub) return null;
  // Anonymous sessions (the bug button signs in anonymously) are valid project
  // tokens anyone can mint with one curl; this endpoint spends money, so they
  // are refused (house rule since the 2026-08-29 anon-auth work).
  if (payload.firebase && payload.firebase.sign_in_provider === 'anonymous') return null;

  return payload;
};

// --- Rate limiting ----------------------------------------------------------
// Per-container and in-memory, so it is a speed bump rather than a guarantee:
// Lambda may run many containers concurrently and each keeps its own counter,
// and a cold start resets it. It still stops a single client hammering the
// endpoint in a loop, which is the realistic abuse case. For a hard ceiling,
// set a throttle on the API Gateway stage as well — that's the real backstop
// and it needs no code.
const RATE_LIMIT = { windowMs: 60_000, maxPerWindow: 20 };
const recentCalls = new Map();

const withinRateLimit = (uid) => {
  const now = Date.now();
  const calls = (recentCalls.get(uid) || []).filter((at) => now - at < RATE_LIMIT.windowMs);

  if (calls.length >= RATE_LIMIT.maxPerWindow) {
    recentCalls.set(uid, calls);
    return false;
  }

  calls.push(now);
  recentCalls.set(uid, calls);

  // Don't let the map grow without bound across a long-lived container.
  if (recentCalls.size > 500) {
    for (const [key, times] of recentCalls) {
      if (!times.some((at) => now - at < RATE_LIMIT.windowMs)) recentCalls.delete(key);
    }
  }

  return true;
};

// --- Durable quota (the watchlist prompt only) ------------------------------
//
// Matt: "I don't wanna just hand over my Claude prompt to just any number of
// users and have them abuse it. Is there some way that we can limit usage in a
// way that most users won't notice, but if somebody really went crazy, they
// would be held in check?"
//
// The in-memory limiter above cannot do that job. It is per-container, so a
// burst spread across concurrent Lambdas slips through it, and a cold start
// wipes it. Fine as a speed bump for the automatic routes; useless as a
// ceiling.
//
// This one is a real ceiling: an atomic counter in DynamoDB, incremented and
// checked in a single conditional write, so concurrency cannot beat it. It
// applies ONLY to /watchlist - the one route a human types into. The other
// three fire automatically while you browse (the file header notes ~5k calls a
// day), and a per-person daily cap on those would break ordinary use.
//
// Two counters, because they stop different things:
//   - PER USER, per day. Stops one person looping the endpoint.
//   - EVERYONE, per day. Stops a crowd, or a stolen token, from running up a
//     bill no single account would have reached.
//
// The numbers are chosen so nobody notices. A real session might use this five
// or ten times; hitting 60 means something has gone wrong, and the global cap
// is roughly a dozen enthusiastic people on the same day. At Haiku prices and
// a prompt this small, the global cap is worth a few cents.
const QUOTA_TABLE = process.env.USAGE_TABLE || 'cinemaroll-ai-usage';
const PER_USER_PER_DAY = 60;
const EVERYONE_PER_DAY = 800;

const ddb = new DynamoDBClient({});

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Adds one to a counter and reports whether it was already at its limit.
 *
 * The condition is what makes this safe under concurrency: DynamoDB evaluates
 * it and applies the increment as one atomic operation, so two simultaneous
 * calls cannot both see 59 and both proceed. A rejected write throws
 * ConditionalCheckFailed, which IS the "over limit" answer rather than an
 * error to handle.
 *
 * Fails OPEN. If DynamoDB is unreachable the request is allowed: a spending
 * cap that takes the feature down when the ledger is unavailable trades a
 * small, bounded cost risk for a visible outage, and that is the wrong way
 * round. The API Gateway throttle is the backstop underneath this.
 */
const countOne = async (key, limit) => {
  const midnightTomorrow = Math.floor(Date.now() / 1000) + 48 * 3600;
  try {
    await ddb.send(new UpdateItemCommand({
      TableName: QUOTA_TABLE,
      Key: { pk: { S: key } },
      UpdateExpression: 'ADD #n :one SET expiresAt = if_not_exists(expiresAt, :ttl)',
      ConditionExpression: 'attribute_not_exists(#n) OR #n < :limit',
      ExpressionAttributeNames: { '#n': 'count' },
      ExpressionAttributeValues: {
        ':one': { N: '1' },
        ':limit': { N: String(limit) },
        ':ttl': { N: String(midnightTomorrow) }
      }
    }));
    return true;
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return false;
    console.error('Quota check failed open:', error?.name, error?.message);
    return true;
  }
};

/** Returns null when allowed, or the reason it isn't. */
const checkWatchlistQuota = async (uid) => {
  const day = today();
  if (!(await countOne(`u#${uid}#${day}`, PER_USER_PER_DAY))) return 'user';
  if (!(await countOne(`all#${day}`, EVERYONE_PER_DAY))) return 'global';
  return null;
};

/**
 * The assistant's text out of a response.
 *
 * `message.content[0].text` was assumed everywhere, which broke /trivia with
 * "Cannot read properties of undefined (reading 'match')" — content is a list
 * of BLOCKS and the first one is not guaranteed to be a text block. Find the
 * text block instead of indexing blindly, and fail with something readable
 * when there genuinely isn't one.
 */
const textFrom = (message) => {
  const blocks = Array.isArray(message?.content) ? message.content : [];
  const textBlock = blocks.find((block) => block?.type === 'text' && typeof block.text === 'string');
  if (!textBlock) {
    const kinds = blocks.map((block) => block?.type).join(', ') || 'none';
    throw new Error(`No text block in response (blocks: ${kinds}, stop_reason: ${message?.stop_reason})`);
  }
  return textBlock.text;
};

const getContext = async ({ title, year }) => {
  if (!title) {
    return response(400, { error: 'Title is required' });
  }

  const message = await client.messages.create({
    model: MODELS.context,
    // Was 512, which visibly truncated the answer mid-sentence — Sonnet is
    // wordier than the Opus this used to run on.
    max_tokens: 1024,
    messages: [
      {
        role: 'user',
        content: `Give me some brief critical and historical context for the movie "${title}"${year ? ` (${year})` : ''}.
Cover how it was received at the time of release, its cultural or historical significance, and any notable influences or legacy. Are there any interesting production details?
Keep it to 3-4 sentences. Be direct and informative, not promotional.`
      }
    ]
  });

  return response(200, { context: textFrom(message) });
};

const getTrivia = async ({ title, year }) => {
  if (!title) {
    return response(400, { error: 'Title is required' });
  }

  const message = await client.messages.create({
    model: MODELS.trivia,
    // Was 768. Five facts of 1-2 sentences plus JSON overhead runs past that
    // on Sonnet, and a truncated response has no closing brace — which used
    // to crash the extraction below and surface as "couldn't load trivia".
    max_tokens: 2000,
    messages: [
      {
        role: 'user',
        content: `Give me 5 pieces of trivia about the movie "${title}"${year ? ` (${year})` : ''}, for a guessing game where a player is shown one fact at a time and tries to guess the movie.

Order them from HARDEST/most obscure (revealed first) to EASIEST/most identifying (revealed last) - the last one or two can be quite giveaway-ish, but the first few should require real movie knowledge and should NOT be dry facts like runtime, budget, or release date (the game already has separate access to those).

Rules:
- Do not mention the movie's title, or any alternate/working title, in any fact.
- Prefer genuinely interesting behind-the-scenes, production, casting, reception, or legacy trivia over generic plot description.
- Each fact should be 1-2 sentences, self-contained, and true - do not invent or guess at trivia you are not confident is accurate.
- It's fine for later, easier facts to name the director or lead actors if that's genuinely how the trivia goes, but earlier facts should avoid it when possible.

Return only a JSON object with a single key "facts" whose value is an array of exactly 5 strings, ordered hardest to easiest.`
      }
    ]
  });

  // Defensive on both counts: .match() returns null when the response was
  // truncated before its closing brace, and `null[0]` threw a TypeError that
  // the caller could only report as a generic failure. Say what actually
  // happened instead, and include stop_reason so a repeat is diagnosable
  // without CloudWatch access.
  const text = textFrom(message);
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error('Trivia response had no JSON object. stop_reason:', message.stop_reason, 'text:', text.slice(0, 400));
    return response(502, { error: 'AI returned no usable trivia', stopReason: message.stop_reason, facts: [] });
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (error) {
    console.error('Trivia JSON did not parse. stop_reason:', message.stop_reason, 'text:', text.slice(0, 400));
    return response(502, { error: 'AI returned malformed trivia', stopReason: message.stop_reason, facts: [] });
  }

  const facts = (Array.isArray(parsed.facts) ? parsed.facts : []).filter((fact) => typeof fact === 'string' && fact.trim()).slice(0, 5);

  return response(200, { facts });
};

const getKeywords = async ({ title, year }) => {
  if (!title) {
    return response(400, { error: 'Title is required' });
  }

  // A forced tool call, not JSON asked for in prose (Sentry, 2026-10-09).
  // The old prompt left the reply to be cut out with a regex at 256 tokens;
  // a long list ran out of room mid-array, the match or JSON.parse threw, and
  // the Rate page logged a failure. Same lesson as /watchlist's.
  const message = await client.messages.create({
    model: MODELS.keywords,
    max_tokens: 1024,
    tools: [{
      name: 'record_keywords',
      description: 'Return the keywords for the film.',
      input_schema: {
        type: 'object',
        properties: {
          keywords: {
            type: 'array',
            maxItems: 30,
            items: { type: 'string', description: 'One lowercase keyword or short phrase.' }
          }
        },
        required: ['keywords']
      }
    }],
    tool_choice: { type: 'tool', name: 'record_keywords' },
    messages: [
      {
        role: 'user',
        content: `Give me a list of keywords for the movie "${title}"${year ? ` (${year})` : ''}.
Include keywords for themes, genre, mood, and the location or locations where the movie takes place.`
      }
    ]
  });

  const call = (message.content || []).find((block) => block?.type === 'tool_use');
  if (!Array.isArray(call?.input?.keywords)) {
    console.error('keywords: no tool call', `stop_reason: ${message?.stop_reason}`);
    return response(200, { keywords: [] });
  }

  const keywords = call.input.keywords
    .filter((k) => typeof k === 'string' && k.trim())
    .map((k) => k.trim().toLowerCase());

  return response(200, { keywords });
};

/**
 * A watchlist built from a sentence.
 *
 * Bug report (2026-08-27): "It'll be cool if I could have a prompt somewhere
 * on the watchlist page where I could give it a prompt and it would give me
 * back a watchlist tailored to that prompt."
 *
 * The library is NOT sent. Cinema Roll has 1,386 rated movies in it, and a
 * list of every title would be roughly 14,000 tokens on every single call -
 * more than the rest of this endpoint's traffic put together, and paid again
 * for every rephrasing of the same request. What goes up instead is a short
 * taste profile the client already computes for its other lists (a few
 * hundred tokens), and what comes back is titles. The client resolves those
 * against TMDB and drops anything already rated, which is both cheaper and
 * more accurate than asking the model to remember a library it was shown.
 */
const getWatchlist = async ({ prompt, taste, count }) => {
  const wanted = Math.min(Math.max(Number(count) || 12, 4), 16);
  // Bounded before it reaches the model. A prompt is a sentence; anything
  // longer is either a mistake or somebody using this as a general-purpose
  // Claude endpoint, which is exactly what it must not become.
  const ask = String(prompt || '').trim().slice(0, 300);
  if (!ask) return response(400, { error: 'No prompt', movies: [] });

  const profile = String(taste || '').trim().slice(0, 1200);

  // A FORCED TOOL CALL, not a JSON-shaped prompt.
  //
  // This was first written asking for JSON in the system prompt and prefilling
  // the reply with `{"movies":` to force the shape. The model's suggestions
  // were good every time; the SPLICING was what broke. It sometimes continued
  // with `:[...` (re-emitting the colon, giving `{"movies"::[`) and sometimes
  // with `{"title"...` (omitting the array bracket) - both unparseable, and
  // both invisible until the reply was logged. Hand-reassembling a JSON
  // document from a prefix and a continuation is guesswork.
  //
  // A tool schema removes the guesswork: the API validates the arguments
  // against it, and `tool_choice` makes the model use it rather than replying
  // in prose. A vague request now yields films instead of a question, and
  // there is nothing left to parse.
  const message = await client.messages.create({
    model: MODELS.watchlist,
    max_tokens: 1500,
    system: `You suggest films for one person's watchlist. Always answer by
calling suggest_films - never with prose, and never by asking what they meant.

- best fit first
- real films with their correct release year; a wrong year sends the lookup to
  the wrong film
- range widely: different decades, countries and scales
- the request governs. The taste notes break ties; they are not a second
  request to satisfy.
- if the request is vague, a single word, or not really a request at all, pick
  well-regarded films that suit the taste notes and answer anyway.`,
    tools: [{
      name: 'suggest_films',
      description: 'Return the films that fit the request.',
      input_schema: {
        type: 'object',
        properties: {
          movies: {
            type: 'array',
            minItems: wanted,
            maxItems: wanted,
            items: {
              type: 'object',
              properties: {
                title: { type: 'string', description: 'The film\'s title.' },
                year: { type: 'integer', description: 'Release year.' },
                why: {
                  type: 'string',
                  description: 'One clause under 12 words on why it fits THIS request.'
                }
              },
              required: ['title', 'year', 'why']
            }
          }
        },
        required: ['movies']
      }
    }],
    tool_choice: { type: 'tool', name: 'suggest_films' },
    messages: [
      {
        role: 'user',
        content: profile
          ? `Request: ${ask}\n\nWhat they tend to like: ${profile}`
          : `Request: ${ask}`
      }
    ]
  });

  const call = (message.content || []).find((block) => block?.type === 'tool_use');
  if (!call?.input?.movies) {
    // Should not happen with tool_choice forcing the call, but a 200 with an
    // empty list is still the right answer: the screen has a good line for it
    // ("nothing came back - try asking differently"), and blaming the server
    // for an empty result would be a lie.
    console.error('watchlist: no tool call', JSON.stringify(message.content || []).slice(0, 300));
    return response(200, { movies: [] });
  }

  const movies = call.input.movies
    .filter((m) => m && typeof m.title === 'string')
    .slice(0, wanted)
    .map((m) => ({
      title: String(m.title).slice(0, 200),
      year: Number(m.year) || null,
      why: String(m.why || '').slice(0, 140)
    }));

  return response(200, { movies });
};


// --- Critics' reviews (/reviews) ---------------------------------------------
//
// Report (2026-10-06): "pull in like contemporary reviews of these movies, in
// particular from some of the sort of big names like ... Ebert or Pauline
// Kael ... a brief summary and then a link to the full article". What counts
// as worth showing is decided in criticReviews.js.
//
// ASYNCHRONOUS, like the newsletter rebuild, and for the same reason: an HTTP
// API integration gives up at 30 seconds, hard, and a search-then-judge call
// takes longer than that often enough to matter. So POST /reviews answers
// from the store when it can, and otherwise starts a job (an Event invoke of
// this same function) and answers `pending`; the client asks again every few
// seconds until the job has written its answer.
//
// The answer is stored PER FILM, shared by everyone: reviews of Vertigo are
// the same for every reader, so the second person to open it pays nothing.
// Only a lookup that starts a job spends any of the daily allowance.
const REVIEWS_TABLE = process.env.REVIEWS_TABLE || 'cinemaroll-film-reviews';
// A lookup is roughly 20 cents (four searches, and what they return read by
// Sonnet), so the global cap bounds a bad day at about $30.
const REVIEWS_PER_USER_PER_DAY = 25;
const REVIEWS_EVERYONE_PER_DAY = 150;
// A job that hasn't written anything after this long has died (the function
// timeout is 120s); the next request may start another.
const REVIEWS_JOB_STALE_MS = 3 * 60 * 1000;

const lambda = new LambdaClient({});

const reviewsKey = (tmdbId) => ({ pk: { S: `film#${tmdbId}` } });

const readStoredReviews = async (tmdbId) => {
  const { Item } = await ddb.send(new GetItemCommand({
    TableName: REVIEWS_TABLE,
    Key: reviewsKey(tmdbId),
    ConsistentRead: true
  }));
  if (!Item) return null;
  const expiresAt = Item.expiresAt ? Number(Item.expiresAt.N) : null;
  // DynamoDB's TTL sweep runs up to days late; an expired row is no row.
  if (expiresAt && expiresAt * 1000 < Date.now()) return null;
  let reviews = [];
  try { reviews = JSON.parse(Item.reviews?.S || '[]'); } catch { reviews = []; }
  return {
    status: Item.status?.S,
    startedAt: Number(Item.startedAt?.N || 0),
    reviews
  };
};

const writeStoredReviews = async (tmdbId, { status, reviews = [], lifetime = null, startedAt }) => {
  const item = {
    ...reviewsKey(tmdbId),
    status: { S: status },
    reviews: { S: JSON.stringify(reviews) },
    updatedAt: { N: String(Date.now()) }
  };
  if (startedAt) item.startedAt = { N: String(startedAt) };
  if (lifetime) item.expiresAt = { N: String(Math.floor(Date.now() / 1000) + lifetime) };
  await ddb.send(new PutItemCommand({ TableName: REVIEWS_TABLE, Item: item }));
};

/**
 * Claims the job for one film. Conditional, so two people opening the same
 * film at the same moment start one search between them, not two.
 */
const claimReviewsJob = async (tmdbId) => {
  const now = Date.now();
  try {
    await ddb.send(new PutItemCommand({
      TableName: REVIEWS_TABLE,
      Item: {
        ...reviewsKey(tmdbId),
        status: { S: 'pending' },
        startedAt: { N: String(now) },
        reviews: { S: '[]' },
        expiresAt: { N: String(Math.floor(now / 1000) + 3600) }
      },
      ConditionExpression: 'attribute_not_exists(pk) OR #s <> :pending OR startedAt < :stale',
      ExpressionAttributeNames: { '#s': 'status' },
      ExpressionAttributeValues: {
        ':pending': { S: 'pending' },
        ':stale': { N: String(now - REVIEWS_JOB_STALE_MS) }
      }
    }));
    return true;
  } catch (error) {
    if (error?.name === 'ConditionalCheckFailedException') return false;
    throw error;
  }
};

const checkReviewsQuota = async (uid) => {
  const day = today();
  if (!(await countOne(`rv#u#${uid}#${day}`, REVIEWS_PER_USER_PER_DAY))) return 'user';
  if (!(await countOne(`rv#all#${day}`, REVIEWS_EVERYONE_PER_DAY))) return 'global';
  return null;
};

// Only the id is taken from the request. The title, year and director the
// search runs on come from TMDB's record of that id (lookupFilm) - a client
// that sent one film's title with another's id would otherwise store the
// wrong reviews under the key everyone reads (it happened, 2026-10-06).
const tmdbIdFromBody = (body) => {
  const tmdbId = String(body?.tmdbId || '').trim();
  return /^\d{1,10}$/.test(tmdbId) ? tmdbId : null;
};

const TMDB_API = 'https://api.themoviedb.org/3';

/** TMDB's record of the film: { tmdbId, title, year, director }, or null for an unknown id. */
const lookupFilm = async (tmdbId) => {
  const key = process.env.TMDB_API_KEY;
  if (!key) throw new Error('TMDB_API_KEY is not set');
  const res = await fetch(`${TMDB_API}/movie/${tmdbId}?api_key=${key}&append_to_response=credits`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`TMDB ${res.status} for movie ${tmdbId}`);
  const film = critics.filmFromTmdb(await res.json());
  return film ? { tmdbId, ...film } : null;
};

const getReviews = async (body, uid, functionName) => {
  const tmdbId = tmdbIdFromBody(body);
  if (!tmdbId) {
    return response(400, { error: 'A film id is required', reviews: [] });
  }

  const stored = await readStoredReviews(tmdbId);
  if (stored?.status === 'ready') {
    return response(200, { status: 'ready', reviews: stored.reviews });
  }
  if (stored?.status === 'failed') {
    return response(200, { status: 'failed', reviews: [] });
  }
  if (stored?.status === 'pending' && Date.now() - stored.startedAt < REVIEWS_JOB_STALE_MS) {
    return response(200, { status: 'pending', reviews: [] });
  }

  // Only a lookup that is about to start a job pays for the TMDB read.
  const film = await lookupFilm(tmdbId);
  if (!film) {
    return response(404, { error: 'No film with that id', reviews: [] });
  }

  const blocked = await checkReviewsQuota(uid);
  if (blocked) {
    return response(429, {
      error: blocked === 'user'
        ? "That's all the review lookups for today - they reset tomorrow."
        : 'Review lookups are resting for the day. Try again tomorrow.',
      reviews: []
    });
  }

  if (await claimReviewsJob(film.tmdbId)) {
    await lambda.send(new InvokeCommand({
      FunctionName: functionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ reviewsJob: film }))
    }));
  }
  return response(200, { status: 'pending', reviews: [] });
};

/**
 * The job: search, judge, check, store. Runs in its own invocation (see
 * getReviews), so it has the function's full timeout rather than API
 * Gateway's 30 seconds.
 */
const findReviews = async (film) => {
  const messages = [{ role: 'user', content: critics.userPrompt(film) }];
  const tools = [
    {
      // The BASIC search tool, deliberately. The newer dynamic-filtering one
      // (web_search_20260209) reads about half the tokens, but it filters
      // results in code before the model sees them, and side by side on the
      // same films (2026-10-06) it picked fewer reviews — none at all for
      // Past Lives from 31 results — and took 20-90s against ~11s.
      type: 'web_search_20250305',
      name: 'web_search',
      max_uses: 4,
      blocked_domains: critics.BLOCKED_DOMAINS
    },
    critics.RECORD_TOOL
  ];

  const allBlocks = [];
  let message;
  // Server-side search can pause a long turn (`pause_turn`); hand it back
  // and it resumes where it stopped. Bounded so a loop can't run on.
  for (let round = 0; round < 3; round += 1) {
    message = await client.messages.create({
      model: MODELS.reviews,
      max_tokens: 8000,
      system: critics.SYSTEM_PROMPT,
      output_config: { effort: 'medium' },
      tools,
      messages
    }, { timeout: 100_000, maxRetries: 0 });
    allBlocks.push(...(message.content || []));
    if (message.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: message.content });
  }

  const call = allBlocks.find((block) => block?.type === 'tool_use' && block.name === 'record_reviews');
  const seen = critics.searchedUrls(allBlocks);
  const offered = Array.isArray(call?.input?.reviews) ? call.input.reviews : [];
  const reviews = critics.acceptReviews(offered, seen);
  console.log(`reviews ${film.tmdbId} "${film.title}": ${seen.size} results, ${offered.length} offered, ${reviews.length} kept, stop ${message?.stop_reason}`);
  return { reviews, offered, seen, usage: message?.usage, blocks: allBlocks };
};

/**
 * The job: search, judge, check, store. Runs in its own invocation (see
 * getReviews), so it has the function's full timeout rather than API
 * Gateway's 30 seconds.
 */
const runReviewsJob = async (film) => {
  try {
    const { reviews } = await findReviews(film);
    await writeStoredReviews(film.tmdbId, {
      status: 'ready',
      reviews,
      lifetime: critics.cacheLifetime({ filmYear: film.year, found: reviews.length > 0 })
    });
  } catch (error) {
    console.error(`reviews ${film.tmdbId} failed:`, error?.status, error?.message);
    await writeStoredReviews(film.tmdbId, {
      status: 'failed',
      lifetime: critics.cacheLifetime({ failed: true })
    });
  }
};

// For trying the prompt from a laptop without the HTTP and storage around it.
exports.findReviews = findReviews;

exports.handler = async (event, context) => {
  // A reviews job, started by getReviews with an Event invoke. Only callers
  // holding lambda:InvokeFunction can put a top-level key on the event; an
  // HTTP request's body arrives as a string under `body`.
  if (event && event.reviewsJob) {
    await runReviewsJob(event.reviewsJob);
    return { ok: true };
  }

  const headers = event.headers || {};
  activeOrigin = headers.origin || headers.Origin || ALLOWED_ORIGINS[0];

  const method = event.requestContext?.http?.method || event.httpMethod;

  if (method === 'OPTIONS') {
    return response(200, '');
  }

  if (method !== 'POST') {
    return response(405, { error: 'Method not allowed' });
  }

  // Signed-in callers only. Empty arrays are included so a client that loses
  // its session degrades to "no suggestions" instead of throwing.
  let user;
  try {
    user = await verifyIdToken(headers.authorization || headers.Authorization);
  } catch (error) {
    console.error('Token verification failed:', error);
    return response(503, { error: 'Could not verify credentials', keywords: [], facts: [] });
  }

  if (!user) {
    return response(401, { error: 'Sign-in required', keywords: [], facts: [] });
  }

  if (!withinRateLimit(user.sub)) {
    return response(429, { error: 'Too many requests, slow down', keywords: [], facts: [] });
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return response(400, { error: 'Invalid JSON body' });
  }

  const route = event.path || event.rawPath || '/keywords';

  try {
    if (route.endsWith('/keywords')) {
      return await getKeywords(body);
    }

    if (route.endsWith('/context')) {
      return await getContext(body);
    }

    if (route.endsWith('/trivia')) {
      return await getTrivia(body);
    }

    if (route.endsWith('/reviews')) {
      return await getReviews(body, user.sub, context?.functionName || 'cinemaroll-ai');
    }

    if (route.endsWith('/watchlist')) {
      // The only route with a durable cap - see checkWatchlistQuota for why
      // this one and not the others. Checked here rather than up with the
      // in-memory limiter so a call that never reaches this route never
      // spends any of somebody's daily allowance.
      const blocked = await checkWatchlistQuota(user.sub);
      if (blocked === 'user') {
        return response(429, {
          error: "That's all the suggestions for today - they reset tomorrow.",
          movies: []
        });
      }
      if (blocked === 'global') {
        return response(429, {
          error: 'Suggestions are resting for the day. Try again tomorrow.',
          movies: []
        });
      }
      return await getWatchlist(body);
    }

    return response(404, { error: 'Unknown route' });
  } catch (error) {
    console.error('Claude API error:', error);
    // The message and status are surfaced deliberately: this endpoint is
    // auth-gated, CloudWatch isn't readable from the dev environment, and a
    // bare "AI request failed" cost a full deploy cycle to diagnose.
    return response(500, {
      error: 'AI request failed',
      detail: String(error?.message || error).slice(0, 300),
      status: error?.status,
      keywords: [],
      facts: []
    });
  }
};

// Errors to Sentry (2026-10-08, house module sentryLambda.js): a thrown error
// is reported and rethrown, console.error calls are reported once per shape,
// and a timeout gets a warning just before it lands. Same project as the
// app, tagged runtime=lambda, so Bug Desk files it under this repo.
const { createReporter } = require('./sentryLambda.js');
exports.handler = createReporter({
  dsn: 'https://25a3dc0387f04fd5923f226394a41e7d@o4504483013525504.ingest.sentry.io/4504642713944064',
  functionName: 'cinemaroll-ai'
}).wrapHandler(exports.handler);
