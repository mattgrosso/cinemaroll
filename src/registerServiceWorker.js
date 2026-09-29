/* eslint-disable no-console */

import { register } from 'register-service-worker';
import ErrorLogService from './services/ErrorLogService';
import store from './store/index';

if (process.env.NODE_ENV === 'production') {
  register(`${process.env.BASE_URL}service-worker.js`, {
    ready () {
      console.log('App is being served from cache by a service worker.');
    },
    registered () {
      console.log('Service worker has been registered.');
    },
    cached () {
      console.log('Content has been cached for offline use.');
    },
    updatefound () {
      console.log('New content is downloading.');
    },
    updated (registration) {
      // Bug report (Jul 2026): this used to call window.location.reload()
      // unconditionally - the moment a new version finished installing in
      // the background (which App.vue actively checks for from several
      // triggers), it force-reloaded the page out from under whatever the
      // user was doing, mid-task, with no warning. Most visibly broke the
      // box office backfill button (a long-running operation gives a
      // background update check plenty of time to land mid-run) but could
      // have hit anything - typing a rating, browsing, anything. Now just
      // flags it; UpdateAvailableBanner.vue shows a small prompt so the
      // user reloads on their own terms instead.
      //
      // Bug report (Matt, 2026-09-29): "I'm stuck in the new app refresh
      // loop." A worker that installs and then just sits in `waiting` fires
      // this hook on every launch, even when the page is already running
      // the live deploy. Flagging an update straight from here turned that
      // into a notice no reload could clear - and, being set, it also
      // switched off App.vue's bundle comparison, the one check that could
      // have said "you're already current". So a waiting worker is now only
      // a reason to compare: App.vue flags an update solely when the server
      // really serves a different bundle. Meanwhile, nudge the worker along.
      console.log('New content is available.');
      try { registration?.waiting?.postMessage?.({ type: 'SKIP_WAITING' }); } catch { /* best effort */ }
      store.commit('requestUpdateCheck');
    },
    offline () {
      console.log('No internet connection found. App is running in offline mode.');
    },
    error (error) {
      console.error('Error during service worker registration:', error);
      ErrorLogService.error('Error during service worker registration:', error);
    }
  });
}
