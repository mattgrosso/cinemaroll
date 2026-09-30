#!/usr/bin/env node
//
// Generates database.rules.json.
//
// Cinema Roll stores each user's library under a top-level key derived from
// their email address (see src/assets/javascript/databaseKey.js). The security
// rules have to perform that exact same transformation on `auth.token.email` to
// decide who may read a branch — and if the two ever disagree, users lose
// access to their own data.
//
// The rules language has no regex, only `String.replace(substring, replacement)`
// (which replaces every occurrence), so the transformation has to be written as
// a chain of calls. Generating that chain from the same character list the app
// uses is the only way to keep them provably in step.
//
// Usage:  node scripts/generate-database-rules.mjs
// Then:   npx firebase deploy --only database
//
// READ THE DEPLOY ORDER NOTE IN CLAUDE.md BEFORE DEPLOYING THESE RULES.

import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..');

// databaseKey.js is an ES module built for webpack, which a plain Node script
// can't import in this (non-`type: module`) package — so the character list
// lives in JSON that both sides read. Not a copy: the very same bytes.
const keyCharacters = JSON.parse(
  readFileSync(join(repoRoot, 'src/assets/javascript/databaseKeyCharacters.json'), 'utf8')
);
const UNSAFE_KEY_CHARACTERS = keyCharacters.characters;
const REPLACEMENT = keyCharacters.replacement;

// Quote a single character for the rules language, choosing whichever quote
// style doesn't collide with it.
const quote = (character) => (character === "'" ? `"'"` : `'${character}'`);

// `-` -> `-` is a provable no-op, so it's skipped to keep the expression shorter.
const sanitizedAuthEmail = UNSAFE_KEY_CHARACTERS
  .filter((character) => character !== REPLACEMENT)
  .reduce(
    (expression, character) => `${expression}.replace(${quote(character)}, '${REPLACEMENT}')`,
    'auth.token.email'
  );

// A signed-in user owns exactly the branch named after their own email.
const ownsBranch = `auth != null && auth.token.email != null && $topKey === ${sanitizedAuthEmail}`;

// The dev-mode sandbox (state.devModeTopKey) isn't derived from anyone's email,
// so it needs its own rule. Scoped to the owner, matching the existing `isMatt`
// check that already hardcodes this key in Home.vue.
const OWNER_KEY = 'mattgrosso-gmail-com';
const isOwner = `auth != null && auth.token.email != null && ${sanitizedAuthEmail} === '${OWNER_KEY}'`;

const rules = {
  rules: {
    // Deny by default. Everything below is an explicit, narrow grant.
    '.read': false,
    '.write': false,

    // The in-app bug report button is rendered globally — including on the
    // login screen, before anyone has signed in — so reports have to be
    // writable without a session. Write-only: the pile can't be read back out
    // by clients. Triage goes through the Admin SDK, which bypasses rules.
    bugReports: {
      '.read': false,
      '.write': true
    },

    // Social layer (2026-08-15): publish-don't-peek. Each user's app
    // PUBLISHES a curated public copy under social/; nobody ever reads
    // another user's private branch. Friendship = BOTH edges exist
    // (sender pre-commits theirs on request; acceptance creates the
    // other), and profiles are readable only to mutual friends —
    // enforced here, not by app etiquette.
    social: {
      // Name-only directory so friend requests can find people. Row
      // appears only when its owner opts into social at all.
      directory: {
        '.read': "auth != null",
        $userKey: {
          '.write': `auth != null && $userKey === ${sanitizedAuthEmail}`
        }
      },
      // Inbox: sender writes their own row into YOUR inbox; only you can
      // read your inbox; either party can remove the row (decline/cancel).
      requests: {
        $toKey: {
          '.read': `auth != null && $toKey === ${sanitizedAuthEmail}`,
          $fromKey: {
            '.write': `auth != null && ($fromKey === ${sanitizedAuthEmail} || $toKey === ${sanitizedAuthEmail})`
          }
        }
      },
      // Friend edges: each user writes only their own outgoing edges.
      // Readable when signed in (the handshake needs to see both sides).
      friends: {
        '.read': "auth != null",
        $userKey: {
          $friendKey: {
            '.write': `auth != null && $userKey === ${sanitizedAuthEmail}`
          }
        }
      },
      // Published profiles: owner-write; readable by the owner and by
      // MUTUAL friends only (both edges must exist).
      profiles: {
        $userKey: {
          '.write': `auth != null && $userKey === ${sanitizedAuthEmail}`,
          '.read': `auth != null && ($userKey === ${sanitizedAuthEmail} || (root.child('social/friends/' + $userKey).child(${sanitizedAuthEmail}).exists() && root.child('social/friends/' + ${sanitizedAuthEmail}).child($userKey).exists()))`
        }
      }
    },

    // Cross-app directory (2026-08-16). Publicly readable ON PURPOSE: it is
    // how someone using a different app finds you well enough to send a
    // request. It carries a handle, display name and inbox URL — never a
    // feed URL, because a feed URL is a capability. Opt-in per user; a row
    // exists only for someone who turned cross-app discovery on.
    clubDirectory: {
      '.read': true,
      $userKey: {
        '.write': `auth != null && $userKey === ${sanitizedAuthEmail}`,
        '.validate': "!newData.exists() || (newData.hasChildren(['handle', 'name', 'inboxUrl']) && newData.child('name').val().length < 120)"
      }
    },

    // Cross-app connect inbox (2026-08-16). Lets someone on ANOTHER app ask
    // to join your Film Club without having an account here.
    //
    // The path carries an invite code, so only someone you gave a link to
    // can address you — and requests are CREATE-ONLY for strangers
    // (`!data.exists()`), so a request can be dropped but nothing already
    // in your inbox can be altered or wiped. Reading the inbox is yours
    // alone. Rotate the code to cut off a leaked link.
    clubInbox: {
      $userKey: {
        '.read': `auth != null && $userKey === ${sanitizedAuthEmail}`,
        // Owner-level write so you can clear your whole inbox in one go;
        // strangers are still confined to the create-only rule below.
        '.write': `auth != null && $userKey === ${sanitizedAuthEmail}`,
        $inviteCode: {
          $requestId: {
            '.write': `!data.exists() || (auth != null && $userKey === ${sanitizedAuthEmail})`,
            '.validate': "newData.hasChildren(['name', 'app', 'feedUrl']) && newData.child('feedUrl').isString() && newData.child('feedUrl').val().length < 500 && newData.child('name').isString() && newData.child('name').val().length < 120"
          }
        }
      }
    },

    // Film Club Interchange feed (2026-08-16). Lets a friend on ANOTHER
    // app (Brian's Movie Log) subscribe to this user's library without a
    // Cinema Roll account. Same secret-path shape as mirrorFeed below:
    // readable only if you know both the account key and the secret, and
    // writable only by its owner.
    clubFeed: {
      $userKey: {
        '.read': false,
        '.write': `auth != null && $userKey === ${sanitizedAuthEmail}`,
        $secret: {
          '.read': true
        }
      }
    },

    // Magic Mirror feed (2026-08-16). The mirror is a device on Matt's LAN
    // with no Firebase session; it used to read the whole movieLog over
    // unauthenticated REST until this file's lockdown (correctly) ended
    // that. Instead of reopening the library, the app publishes a few KB of
    // derived display data here.
    //
    // READ IS PUBLIC ONLY AT THE SECRET LEVEL: you must know both the
    // account key AND the unguessable secret. The parent nodes stay
    // unreadable, so the secret can't be discovered by listing.
    mirrorFeed: {
      $userKey: {
        '.read': false,
        '.write': `auth != null && $userKey === ${sanitizedAuthEmail}`,
        $secret: {
          '.read': true
        }
      }
    },

    // Dev-mode sandbox. Owner only.
    'testing-database': {
      '.read': isOwner,
      '.write': isOwner
    },

    // One branch per user, named after their sanitized email address.
    // Letterboxd's public per-film stats (weighted rating, rating count,
    // fans), fetched by the newsletter Lambda's sweep (aws-lambda/letterboxd.js)
    // and shared by every account — a film's rating is the same for everyone.
    // Written only through the Admin SDK; readable by anyone signed in.
    letterboxdFilms: {
      '.read': 'auth != null',
      '.write': false
    },

    $topKey: {
      '.read': ownsBranch,
      '.write': ownsBranch,

      // Lets the library be fetched incrementally (orderByChild('updatedAt')
      // .startAt(lastSync)) instead of re-downloading all of it every launch.
      //
      // WITHOUT this index that query does not fail — Firebase downloads the
      // entire node and filters client-side, logging only a console warning.
      // The data would be correct and the saving would silently be zero, so
      // this index is what makes delta sync actually do anything.
      movieLog: {
        '.indexOn': ['updatedAt']
      },

      // /share/:userDBKey/:shareKey is deliberately a logged-out route
      // (requiresLogin: false in the router), so a share link has to be
      // readable by someone with no session at all. Grants read on ONE share
      // at a time — the parent rule still keeps the branch, and the list of
      // which shares exist, private. Reading requires knowing the share key.
      sharedDBSearches: {
        $shareKey: {
          '.read': true
        }
      }
    }
  }
};

const banner = '// GENERATED FILE — edit scripts/generate-database-rules.mjs and re-run it.\n';
writeFileSync(join(repoRoot, 'database.rules.json'), banner + JSON.stringify(rules, null, 2) + '\n');

console.log('Wrote database.rules.json');
console.log(`  ${UNSAFE_KEY_CHARACTERS.length} characters in the key derivation`);
console.log('  Deploy with: npx firebase deploy --only database');
