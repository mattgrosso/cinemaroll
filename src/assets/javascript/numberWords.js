// Numbers spelled out, and numbers written as digits, are the same number.
//
// Report -P1_JRO10YcGNAXX0zzk (2026-09-15): "When I search for the movie 9 to
// 5, it doesn't come up even though I know I've rated it because if I just
// sort by recent watches I can see that it's there."
//
// The entry is stored as "Nine to Five" — TMDB's title for it when he added
// it, forty seconds before he filed the report. TMDB now calls the same film
// "9 to 5". Neither normalization nor the fuzzy fallback can bridge that:
// "9to5" and "ninetofive" have no characters in common. Nor is this one
// film's problem — a library picks up whichever spelling TMDB held on the day
// each entry was added, so "Ocean's Eleven" / "Ocean's 11" and "Apollo 13" /
// "Apollo Thirteen" are the same coin toss.
//
// So both sides fold number WORDS to DIGITS — the smaller, more regular
// direction — and the comparison happens over TOKENS rather than as a
// substring. The token part is load-bearing. Fold "seven" to "7" and ask
// whether the loose title contains it, and searching "seven" returns 1917,
// because "1917" contains a 7. Tokens can't do that: ["7"] is not a run
// inside ["1917"]. The price is that a numeral search has to name whole
// words — "fiv" won't reach "Five" through this path — which is fine,
// because ordinary substring matching already covers every case where the
// two sides spell the number the same way. This path only ever ADDS matches.

import { normalizeSearchText, looseSearchText } from './searchText.js';

const UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19
};

const TENS = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90
};

/**
 * Number words in a normalized, still-spaced string → digits.
 *
 * Whole tokens only, so "someone" keeps its "one" and "Se7en" is left alone.
 * A tens word followed by a unit reads as one number ("twenty one" → 21,
 * which is also where a hyphenated "Twenty-One" lands, dashes already being
 * spaces by this point).
 */
export function foldNumberWords (normalized) {
  if (!normalized) return '';

  const tokens = normalized.split(' ');
  const folded = [];

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    const next = tokens[index + 1];

    if (TENS[token] !== undefined && next !== undefined && UNITS[next] > 0 && UNITS[next] < 10) {
      folded.push(String(TENS[token] + UNITS[next]));
      index++;
      continue;
    }
    if (TENS[token] !== undefined) { folded.push(String(TENS[token])); continue; }
    if (UNITS[token] !== undefined) { folded.push(String(UNITS[token])); continue; }

    folded.push(token);
  }

  return folded.join(' ');
}

// Queries run through this once per movie per keystroke, same as
// normalizeSearchText — remember the last answer for the same reason.
let lastTokensInput = null;
let lastTokensOutput = [];

/**
 * A value as comparable number-folded tokens: separators stripped WITHIN each
 * token (so "Ocean's" and "Oceans" agree) but the boundaries between tokens
 * kept, which is the whole point.
 */
export function numeralTokens (value) {
  if (typeof value !== 'string' || !value) return [];
  if (value === lastTokensInput) return lastTokensOutput;

  const tokens = foldNumberWords(normalizeSearchText(value))
    .split(' ')
    .map((token) => looseSearchText(token))
    .filter(Boolean);

  lastTokensInput = value;
  lastTokensOutput = tokens;
  return tokens;
}

/**
 * Does `queryTokens` appear as a consecutive run inside `titleTokens`?
 *
 * Consecutive and whole: "9 to 5" names 9 to 5, and "5" alone still reaches
 * it, but "9 5" does not, and no query ever matches by landing inside a
 * longer number.
 */
export function numeralTokensMatch (titleTokens, queryTokens) {
  if (!queryTokens || !queryTokens.length) return false;
  if (!titleTokens || titleTokens.length < queryTokens.length) return false;

  const limit = titleTokens.length - queryTokens.length;
  for (let start = 0; start <= limit; start++) {
    let matched = true;
    for (let offset = 0; offset < queryTokens.length; offset++) {
      if (titleTokens[start + offset] !== queryTokens[offset]) { matched = false; break; }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * The one title test every search path should use: the ordinary loose
 * substring match, plus the number-word bridge.
 *
 * `s` is a `buildSearchFields` record (or anything carrying `titleLoose` and
 * `titleNumerals`). An empty value leaves the substring check's `includes('')`
 * true — no constraint, i.e. the whole library rather than a blank screen,
 * which ChipFiltering asserts.
 */
export function titleMatchesValue (s, value) {
  if (s?.titleLoose?.includes(looseSearchText(value))) return true;
  return numeralTokensMatch(s?.titleNumerals, numeralTokens(value));
}
