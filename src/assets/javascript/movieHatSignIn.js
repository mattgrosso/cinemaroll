// What to tell somebody whose Movie Hat sign-in didn't work.
//
// Bug report 2026-10-01: a new user on an iPhone wrote just "Cannot sign into
// Movie Hat". The screen had said "Couldn't sign in to Movie Hat." for every
// failure alike — a blocked popup, no network, a Safari storage setting — so
// neither they nor anyone reading the report could tell which. Each reason
// that has something to do about it gets its own sentence; anything else
// still names its code, so the next report says what happened.

/** Firebase's own "you closed it" answers. A choice, not a failure. */
const DISMISSALS = ['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled'];

export function isSignInDismissal (error) {
  return DISMISSALS.includes(error?.code);
}

const MESSAGES = {
  'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups for Cinema Roll (on an iPhone: Settings, Safari, turn off Block Pop-ups) and try again.',
  'auth/network-request-failed': 'Couldn\'t reach Google to sign in. Check your connection and try again.',
  'auth/web-storage-unsupported': 'Your browser is blocking the storage Google sign-in needs. On an iPhone, turn off Private Browsing and "Block All Cookies" in Settings, Safari.',
  'auth/operation-not-supported-in-this-environment': 'This browser can\'t open the Google sign-in window. Try opening Cinema Roll in Safari or Chrome.',
  'auth/unauthorized-domain': 'Movie Hat doesn\'t accept sign-ins from this address yet. Matt has been told.',
  'auth/too-many-requests': 'Too many sign-in attempts in a row. Wait a few minutes and try again.',
  'auth/user-disabled': 'That Google account has been turned off for Movie Hat.'
};

export function movieHatSignInMessage (error) {
  const code = error?.code;
  if (code && MESSAGES[code]) return MESSAGES[code];
  return code
    ? `Couldn't sign in to Movie Hat (${code.replace(/^auth\//, '')}).`
    : 'Couldn\'t sign in to Movie Hat.';
}

/** The part of a failure worth carrying in a bug report: no stack, no tokens. */
export function signInFailureSummary (error, where) {
  return {
    where,
    code: error?.code || null,
    message: String(error?.message || error || '').slice(0, 200),
    at: new Date().toISOString()
  };
}
