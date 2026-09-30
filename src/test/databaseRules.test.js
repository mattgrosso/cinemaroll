import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  emailToDatabaseKey,
  UNSAFE_KEY_CHARACTERS,
  KEY_REPLACEMENT_CHARACTER
} from '../assets/javascript/databaseKey.js';

// The security rules decide who may read a branch by transforming
// `auth.token.email` the same way the app transforms it into a database key.
// If those two transformations ever disagree, users lose access to their own
// library — so this suite reads the GENERATED rules file and proves the chain
// it contains produces byte-identical output to emailToDatabaseKey.
const rulesPath = join(process.cwd(), 'database.rules.json');
const rulesText = readFileSync(rulesPath, 'utf8');
// The file is JSON-with-comments (which Firebase accepts); strip the banner.
const rules = JSON.parse(rulesText.replace(/^\/\/.*$/gm, '')).rules;

const ownerRule = rules.$topKey['.read'];

const REPLACE_CALL = /\.replace\((?:'([^']*)'|"([^"]*)")\s*,\s*'([^']*)'\)/g;

/**
 * Apply the rules-language replace chain to an email, in JS.
 *
 * Note `replaceAll`, not `replace`: the Firebase rules language's
 * `String.replace(a, b)` substitutes EVERY occurrence, whereas JS's
 * single-string `replace` only does the first. Using `replace` here would let
 * this test pass against rules that are actually wrong.
 */
function applyRuleChain (email, rule) {
  return [...rule.matchAll(REPLACE_CALL)].reduce(
    (value, match) => value.replaceAll(match[1] ?? match[2], match[3]),
    email
  );
}

describe('database.rules.json', () => {
  it('is committed in its generated form (re-run scripts/generate-database-rules.mjs)', () => {
    expect(rulesText.startsWith('// GENERATED FILE')).toBe(true);
  });

  it('denies read and write by default', () => {
    expect(rules['.read']).toBe(false);
    expect(rules['.write']).toBe(false);
  });

  describe('the email-to-key chain matches the app exactly', () => {
    const emails = [
      'mattgrosso@gmail.com',
      'someone@example.com',
      'matt+movies@gmail.com',
      'first.last@sub.domain.co.uk',
      "o'brien@example.com",
      'a_b-c@example.com',
      'weird!$%&*=?^`{|}~@example.com',
      'relay@privaterelay.appleid.com',
      'MixedCase@Example.COM'
    ];

    it.each(emails)('%s', (email) => {
      expect(applyRuleChain(email, ownerRule)).toBe(emailToDatabaseKey(email));
    });

    it('covers every character the app replaces, and nothing else', () => {
      const chained = [...ownerRule.matchAll(REPLACE_CALL)].map((match) => match[1] ?? match[2]);

      // `-` is deliberately omitted: replacing it with itself is a no-op.
      const expected = UNSAFE_KEY_CHARACTERS.filter((character) => character !== KEY_REPLACEMENT_CHARACTER);

      expect([...chained].sort()).toEqual([...expected].sort());
    });
  });

  describe('grants', () => {
    it('lets a signed-in user reach only their own branch', () => {
      expect(ownerRule).toContain('auth != null');
      expect(ownerRule).toContain('$topKey ===');
      expect(rules.$topKey['.write']).toContain('$topKey ===');
    });

    it('keeps share links readable without a session, one share at a time', () => {
      // /share/:userDBKey/:shareKey is explicitly requiresLogin: false.
      expect(rules.$topKey.sharedDBSearches.$shareKey['.read']).toBe(true);
      // But not the list of which shares exist.
      expect(rules.$topKey.sharedDBSearches['.read']).toBeUndefined();
    });

    it('accepts bug reports from anyone but lets nobody read the pile back', () => {
      // The report button renders on the login screen too, before any session.
      expect(rules.bugReports['.write']).toBe(true);
      expect(rules.bugReports['.read']).toBe(false);
    });

    // 2026-09-30: an end-of-day friend (my edge to them is 'day') may not
    // read my live profile — it would say what I watched this afternoon —
    // only the end-of-day copy the push Lambda builds.
    it('keeps an end-of-day friend out of the live profile, and lets them read the copy', () => {
      const live = rules.social.profiles.$userKey['.read'];
      expect(live).toContain(".val() !== 'day'");
      const copy = rules.social.dayProfiles.$userKey;
      expect(copy['.read']).not.toContain("'day'");
      expect(copy['.read']).toContain("root.child('social/friends/' + $userKey)");
      // The owner can delete their copy but never write one: it must come
      // from the sweep's filter, not from a client.
      expect(copy['.write']).toContain('!newData.exists()');
    });

    it('scopes the dev-mode sandbox to its owner', () => {
      expect(rules['testing-database']['.read']).toContain('mattgrosso-gmail-com');
      expect(rules['testing-database']['.write']).toContain('mattgrosso-gmail-com');
    });
  });
});
