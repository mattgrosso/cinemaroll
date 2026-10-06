// Critics' reviews for the movie page — the pure half of the /reviews route.
//
// Report (2026-10-06): "would it be cool if we could quickly see access to
// those reviews [Ebert, Pauline Kael...], maybe with a brief summary and then
// a link to the full article?" And, approving the plan: "How can we judge
// which reviews are worth raising and which are not? It's cool to have
// contemporary reviews. It doesn't have to just be that, though."
//
// The answer, encoded below, is that a review earns a place by doing one of
// three JOBS, and within a job the better critic and the more readable piece
// win:
//
//   release  — "When it came out": what the film's first serious audience was
//              told. Up to two, so Ebert and Kael can both appear.
//   revisit  — "Looking back": a later reappraisal (Ebert's Great Movies, a
//              Criterion essay, an anniversary piece). This is often the
//              better read for an older film, and it is how a film's
//              reputation moved.
//   dissent  — "Against the grain": a respected critic who disagreed with the
//              consensus. Only when one genuinely exists.
//
// Never padded: one good review beats four thin ones, and none is a fine
// answer. The model searches and judges; this file decides what it is allowed
// to hand back — above all, that every link was in its search results, so a
// URL cannot be invented.
//
// CommonJS because it ships inside the Lambda; src/test imports it directly.

const ROLES = ['release', 'revisit', 'dissent'];
const MAX_PER_ROLE = { release: 2, revisit: 1, dissent: 1 };
const MAX_REVIEWS = 4;

// Who counts as a landmark voice. A PREFERENCE, not a fence: a film from 2024
// has no Kael review, and its best one may be by somebody not listed here.
const LANDMARK_CRITICS = [
  'Roger Ebert', 'Gene Siskel', 'Pauline Kael', 'Andrew Sarris', 'James Agee',
  'Manny Farber', 'Bosley Crowther', 'Vincent Canby', 'Janet Maslin',
  'Stanley Kauffmann', 'Dave Kehr', 'Jonathan Rosenbaum', 'J. Hoberman',
  'David Denby', 'Anthony Lane', 'Richard Brody', 'A.O. Scott',
  'Manohla Dargis', 'Stephanie Zacharek', 'Owen Gleiberman', 'Todd McCarthy',
  'Kenneth Turan', 'Peter Bradshaw', 'Mark Kermode', 'Philip French',
  'Dilys Powell', 'Wesley Morris', 'Justin Chang', 'Alison Willmore',
  'Molly Haskell', 'Amy Taubin', 'Kent Jones', 'Glenn Kenny'
];

// Where a review may come from. Real outlets only, which keeps the links to
// places a reader would trust. Kael's New Yorker archive is here but is
// mostly paywalled — expect her to appear less often than Ebert, whose every
// review is free on rogerebert.com.
//
// This is checked HERE, on the model's picks, not handed to web search as
// `allowed_domains`: the search refuses that list outright when it names a
// site that blocks Anthropic's crawler, and the New York Times, the New
// Yorker, the Guardian and the LA Times all do (found trying it, 2026-10-06).
// Searching openly and filtering the answer keeps them.
const TRUSTED_OUTLETS = [
  'rogerebert.com', 'newyorker.com', 'nytimes.com', 'theguardian.com',
  'chicagoreader.com', 'villagevoice.com', 'variety.com',
  'hollywoodreporter.com', 'criterion.com', 'bfi.org.uk', 'latimes.com',
  'washingtonpost.com', 'time.com', 'theatlantic.com', 'newrepublic.com',
  'nybooks.com', 'slantmagazine.com', 'rollingstone.com',
  'chicagotribune.com', 'avclub.com', 'vulture.com', 'filmcomment.com',
  'reverseshot.org', 'sensesofcinema.com', 'jonathanrosenbaum.net',
  'npr.org', 'indiewire.com', 'ew.com', 'empireonline.com', 'timeout.com',
  'lwlies.com', 'sfgate.com', 'bostonglobe.com', 'theringer.com',
  'mubi.com', 'salon.com', 'thedissolve.com', 'wsj.com'
];

// Never worth a search result: aggregators, databases and forums. Passed to
// web search as `blocked_domains`, which (unlike an allow list) it accepts.
const BLOCKED_DOMAINS = [
  'imdb.com', 'wikipedia.org', 'rottentomatoes.com', 'metacritic.com',
  'letterboxd.com', 'reddit.com', 'youtube.com', 'quora.com', 'fandom.com',
  'tvtropes.org', 'amazon.com', 'pinterest.com'
];

const hostOf = (raw) => {
  try {
    return new URL(String(raw)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return '';
  }
};

const isTrustedOutlet = (raw) => {
  const host = hostOf(raw);
  return TRUSTED_OUTLETS.some((domain) => host === domain || host.endsWith(`.${domain}`));
};

const SYSTEM_PROMPT = `You find the few published film reviews most worth reading for someone who has just watched a film. Search the web, then call record_reviews exactly once.

Each review you choose must do one of three jobs:
- "release": a review from the film's original release (roughly its first two years). Choose at most two.
- "revisit": a later reappraisal by a serious critic — Ebert's Great Movies essays, a Criterion essay, an anniversary piece, Sight and Sound. At most one.
- "dissent": a respected critic who went against the consensus — a pan of a beloved film, or a champion of a dismissed one. At most one, and only if you actually found one.

Reviews must come from these outlets: ${TRUSTED_OUTLETS.join(', ')}.

Within a job, prefer in this order: a landmark critic (${LANDMARK_CRITICS.join(', ')}); a full review or essay over a capsule; a page anyone can read over a paywalled one.

Rules:
- Only include a review you found in this turn's search results, with its URL copied exactly from those results. Never construct or guess a URL.
- The page must be the review itself, not a list, a news story, or an aggregator.
- Summaries are your own words, at most two sentences: what the critic thought and why. No quotations longer than a few words.
- Aim for two to four reviews, covering different jobs where the search allows. Different critics are better than one critic twice, though Ebert's original review and his later Great Movies essay are both fair picks.
- Never pad with a weak piece: a fan blog, a listicle or a plot summary is worse than leaving a job empty. If nothing good turns up, call record_reviews with an empty list.`;

const RECORD_TOOL = {
  name: 'record_reviews',
  description: 'Record the chosen reviews. Call exactly once, after searching.',
  input_schema: {
    type: 'object',
    properties: {
      reviews: {
        type: 'array',
        maxItems: MAX_REVIEWS,
        items: {
          type: 'object',
          properties: {
            role: { type: 'string', enum: ROLES },
            critic: { type: 'string', description: 'The critic\'s name alone, or "Staff review" if the piece is unsigned.' },
            outlet: { type: 'string', description: 'Where it was published.' },
            year: { type: 'integer', description: 'Year the review was published.' },
            verdict: {
              type: 'string',
              description: 'Two or three words: the star rating if the critic gave one ("4 stars"), else "Rave", "Positive", "Mixed" or "Pan".'
            },
            summary: { type: 'string', description: 'At most two sentences, your own words.' },
            url: { type: 'string', description: 'Exactly as it appeared in the search results.' },
            paywalled: { type: 'boolean' }
          },
          required: ['role', 'critic', 'outlet', 'year', 'verdict', 'summary', 'url', 'paywalled']
        }
      }
    },
    required: ['reviews']
  }
};

/**
 * The film the search is about, from TMDB's own record of the id — never
 * from the request. On 2026-10-06 a smoke test posted The Godfather Part
 * III's title with The Little Mermaid's id, and Godfather reviews were
 * stored under the Mermaid for everyone. The id is the key, so the id has
 * to be the source of the title, year and director too. Null when TMDB has
 * no usable film for it.
 */
const filmFromTmdb = (details) => {
  const title = String(details?.title || details?.original_title || '').trim();
  if (!details || !title) return null;
  const year = Number(String(details.release_date || '').slice(0, 4)) || null;
  const crew = Array.isArray(details.credits?.crew) ? details.credits.crew : [];
  const director = crew.filter((c) => c && c.job === 'Director' && c.name).map((c) => c.name).join(', ') || '';
  return { title: title.slice(0, 200), year, director: director.slice(0, 100) };
};

const userPrompt = ({ title, year, director }) => {
  const film = `"${String(title).slice(0, 200)}"${year ? ` (${year})` : ''}`;
  const by = director ? `, directed by ${String(director).slice(0, 100)}` : '';
  return `The film: ${film}${by}.`;
};

/**
 * One URL in a comparable form: no scheme, no www, no query or fragment, no
 * trailing slash. Search results and the model's copy of them differ in
 * exactly those ways, and a mismatch there must not cost a real review.
 */
const normalizeUrl = (raw) => {
  try {
    const url = new URL(String(raw));
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return null;
  }
};

/** Every URL the search returned, across all the response's result blocks. */
const searchedUrls = (contentBlocks) => {
  const seen = new Set();
  for (const block of contentBlocks || []) {
    if (block?.type !== 'web_search_tool_result') continue;
    // An error result's content is an object, not a list.
    if (!Array.isArray(block.content)) continue;
    for (const result of block.content) {
      const key = normalizeUrl(result?.url);
      if (key) seen.add(key);
    }
  }
  return seen;
};

const clip = (value, max) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

/**
 * What the model chose, cut down to what the page may show.
 *
 * Drops anything whose link was not in the search results (the guarantee
 * against invented URLs), anything not from a trusted outlet, anything without a critic or summary, duplicates
 * by link and by critic-and-job, and anything over the per-job limits. Then
 * orders them release (oldest first), revisit, dissent.
 */
const acceptReviews = (picks, seenUrls) => {
  const kept = [];
  const usedUrls = new Set();
  const perRole = { release: 0, revisit: 0, dissent: 0 };
  const usedCriticRole = new Set();

  for (const pick of Array.isArray(picks) ? picks : []) {
    if (!pick || !ROLES.includes(pick.role)) continue;
    const key = normalizeUrl(pick.url);
    if (!key || !seenUrls.has(key) || usedUrls.has(key)) continue;
    if (!isTrustedOutlet(pick.url)) continue;

    const critic = clip(pick.critic, 80);
    const summary = clip(pick.summary, 400);
    if (!critic || !summary) continue;

    const criticRole = `${critic.toLowerCase()}#${pick.role}`;
    if (usedCriticRole.has(criticRole)) continue;
    if (perRole[pick.role] >= MAX_PER_ROLE[pick.role]) continue;

    usedUrls.add(key);
    usedCriticRole.add(criticRole);
    perRole[pick.role] += 1;

    const year = Number(pick.year);
    kept.push({
      role: pick.role,
      critic,
      outlet: clip(pick.outlet, 80),
      year: Number.isInteger(year) && year > 1890 && year < 2200 ? year : null,
      verdict: clip(pick.verdict, 24),
      summary,
      url: String(pick.url).trim(),
      paywalled: pick.paywalled === true
    });
    if (kept.length >= MAX_REVIEWS) break;
  }

  return kept.sort((a, b) => {
    const byRole = ROLES.indexOf(a.role) - ROLES.indexOf(b.role);
    if (byRole) return byRole;
    return (a.year || 9999) - (b.year || 9999);
  });
};

// How long a stored answer is trusted, in seconds (null = keep). Reviews of
// an old film don't change, so those are kept; a new film is still being
// reviewed, and an empty answer may only mean the search had a bad day.
const DAY = 24 * 3600;
const cacheLifetime = ({ filmYear, found, failed, nowYear = new Date().getFullYear() }) => {
  if (failed) return 3600;
  if (!found) return 30 * DAY;
  const year = Number(filmYear);
  if (!year || nowYear - year < 2) return 30 * DAY;
  return null;
};

module.exports = {
  ROLES,
  MAX_REVIEWS,
  LANDMARK_CRITICS,
  TRUSTED_OUTLETS,
  BLOCKED_DOMAINS,
  isTrustedOutlet,
  SYSTEM_PROMPT,
  RECORD_TOOL,
  userPrompt,
  filmFromTmdb,
  normalizeUrl,
  searchedUrls,
  acceptReviews,
  cacheLifetime
};
