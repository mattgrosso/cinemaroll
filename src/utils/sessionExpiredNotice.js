// Carries "you were signed out because your session ended" across the
// redirect to /login, so the login screen can say so instead of looking like
// the app fell over (Sentry, 2026-10-11). sessionStorage: it's for this tab's
// next look at the login screen, and read once.
const KEY = 'cinemaRoll.sessionExpired';

export function markSessionExpired () {
  try {
    window.sessionStorage.setItem(KEY, '1');
  } catch {
    // Private mode can refuse storage; the notice is a nicety.
  }
}

export function takeSessionExpired () {
  try {
    const expired = window.sessionStorage.getItem(KEY) === '1';
    window.sessionStorage.removeItem(KEY);
    return expired;
  } catch {
    return false;
  }
}
