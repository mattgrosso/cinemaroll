// One-tap install where the browser allows it (Matt, 2026-11-14: "Is there
// anything we can do to streamline the process of adding the home screen?").
// Chrome on Android (and desktop Chrome/Edge) fires `beforeinstallprompt`
// once it judges the app installable; holding on to that event lets our own
// button raise the system's install sheet. Safari on iPhone has no such
// event and no way in: there the tour's Share → Add to Home Screen steps are
// all there is.
//
// The event can fire before any component exists, so this listens from
// main.js at startup and keeps the event at module scope.
import { reactive } from 'vue';

export const installState = reactive({ available: false, installed: false });

let deferred = null;

export function startInstallPrompt (target = window) {
  target.addEventListener('beforeinstallprompt', (event) => {
    // Keep Chrome's own mini-bar from popping up on its own; we offer it.
    event.preventDefault();
    deferred = event;
    installState.available = true;
  });
  target.addEventListener('appinstalled', () => {
    deferred = null;
    installState.available = false;
    installState.installed = true;
  });
}

// Raises the system sheet. Resolves 'accepted', 'dismissed' or 'unavailable'.
// The event is single-use either way.
export async function promptInstall () {
  if (!deferred) return 'unavailable';
  const event = deferred;
  deferred = null;
  installState.available = false;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice?.outcome === 'accepted') installState.installed = true;
    return choice?.outcome || 'dismissed';
  } catch {
    return 'unavailable';
  }
}
