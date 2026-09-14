import axios from 'axios';
import { createStore } from "vuex"
import { initializeApp } from 'firebase/app';
import { getDatabase, ref, onValue, set, update, serverTimestamp, query, orderByChild, startAt, get } from "firebase/database";
import {
  getAuth,
  GoogleAuthProvider,
  OAuthProvider,
  signInWithPopup,
  signInWithCustomToken,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  signOut,
  onAuthStateChanged
} from "firebase/auth";
import * as Sentry from "@sentry/vue";
import { getRating } from "../assets/javascript/GetRating";
import router from '@/router';
import ErrorLogService from "../services/ErrorLogService.js";
import { saveSnapshot, loadSnapshot } from "../utils/offlineStore.js";
import { maxUpdatedAt, reconstructFromDelta, diffLibraries, describeStaleEntry, launchPlan } from "../assets/javascript/deltaSync.js";
import { enqueueWrite, listPendingWrites, removePendingWrite, updatePendingWrite } from "../utils/pendingWriteQueue.js";
import { setValueAtPath } from "../utils/statePath.js";
import { stampPlanForWrite, stampUpdatesForBatch } from "../assets/javascript/syncStamp.js";
import { emailToDatabaseKey, isQaAccountKey } from "../assets/javascript/databaseKey.js";
import { fetchAllHats, fetchMyHats, hatsForMember, fetchHat, fetchHatMovies, toHatMovie, alreadyInHat, addMovieToHat, pickFromHat, commitDraw, isMovieHatAccessError } from "../assets/javascript/movieHat.js";
import {
  connectMovieHat as signIntoMovieHat,
  connectMovieHatWithToken as signIntoMovieHatWithToken,
  disconnectMovieHat as signOutOfMovieHat,
  watchMovieHatAuth as observeMovieHatAuth
} from "../assets/javascript/movieHatAuth.js";
import { buildSocialProfile, socialSettingsWithDefaults, countNewFriendUpdates, clubFetchesNeeded } from "../assets/javascript/social.js";
import { buildMirrorFeed } from "../assets/javascript/mirrorFeed.js";
import { buildPushDigest } from "../assets/javascript/pushDigest.js";
import { pushPrefsWithDefaults } from "../assets/javascript/pushPrefs.js";
import { pendingUpdates, reconcilePending } from "../assets/javascript/recommendationStats.js";
import { toInterchange, profileFromFeed, buildInvite, parseInvite, buildConnectRequest, normalizeInboxRequests, buildDirectoryEntry, normalizeDirectory, findSubscription, dedupeExternalFriends, FEDERATED_APPS } from "../assets/javascript/interchange.js";

const sortByVoteCount = (a, b) => {
  if (a.vote_count < b.vote_count) {
    return 1;
  }
  if (a.vote_count > b.vote_count) {
    return -1;
  }

  return 0;
}

const mostRecentRating = (media) => {
  return getRating(media);
}

const sortByRating = (a, b) => {
  const sortValueA = mostRecentRating(a).calculatedTotal;
  const sortValueB = mostRecentRating(b).calculatedTotal;

  if (sortValueA < sortValueB) {
    return 1;
  }

  if (sortValueA > sortValueB) {
    return -1;
  }

  return 0;
}

const removeNaNAndUndefined = (obj) => {
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (typeof obj[key] === "object" && obj[key] !== null) {
        removeNaNAndUndefined(obj[key]);
      } else if (Number.isNaN(obj[key]) || obj[key] === undefined) {
        Sentry.captureMessage(`NaN or undefined value found in ${key}. The Object was ${JSON.stringify(obj)}`);
        delete obj[key];
      }
    }
  }
  return obj;
};

// Firebase RTDB's set() has no built-in timeout - while genuinely offline it
// resolves optimistically against the local cache (fine), but under a
// degraded/flaky connection (navigator.onLine still true, but the socket
// can't actually reach the server) it can stay pending INDEFINITELY, never
// resolving OR rejecting. Left unbounded, that hung promise would (a) block
// flushPendingWrites' one write forever and, worse, (b) keep
// isFlushingPendingWrites stuck true for the rest of the session, silently
// disabling every future flush attempt (a real data-loss bug - see the Jul
// 2026 bug report in CLAUDE.md's Offline Movie Rating section). Racing every
// write against a bounded timeout guarantees performDatabaseWrite always
// settles, so a stuck write becomes a recorded failure (retried on the next
// trigger) instead of a silent permanent stall.
const DATABASE_WRITE_TIMEOUT_MS = 15000;

// Used to build absolute feed/inbox URLs for people on other apps.
const DATABASE_URL = 'https://movie-log-8c4d5-default-rtdb.firebaseio.com';

const withTimeout = (promise, ms, errorMessage) => {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(errorMessage)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

// Shared write core behind both setDBValue (debounced, direct UI saves) and
// flushPendingWrites (queued offline/retry saves, which deliberately bypass
// that debounce - a queued entry is already a single, deliberately-deduped
// write, see pendingWriteQueue.js's enqueueWrite).
//
// Every write to a movieLog entry also records WHEN, and every deletion of one
// leaves a tombstone, so a future sync can ask for only what changed. The
// timestamp is assigned by Firebase's server, not this device's clock, so a
// device with a wrong clock can't hide a movie from itself. See syncStamp.js.
const performDatabaseWrite = async (context, dbEntry) => {
  try {
    const plan = stampPlanForWrite(dbEntry, serverTimestamp());
    const root = context.getters.databaseTopKey;

    const write = plan.kind === 'update'
      ? update(ref(db, root), removeNaNAndUndefined({ ...plan.updates }))
      : set(ref(db, `${root}/${plan.path}`), removeNaNAndUndefined(plan.value));

    await withTimeout(
      write,
      DATABASE_WRITE_TIMEOUT_MS,
      `Database write timed out after ${DATABASE_WRITE_TIMEOUT_MS}ms: ${dbEntry.path}`
    );
  } catch (error) {
    console.error('Error setting database value:', error);
    ErrorLogService.error('Error setting database value:', dbEntry.path, error);
    throw error;
  }
};

// Re-tops a freshly-arrived server snapshot with any local writes that are
// still in flight (committed locally, not yet server-confirmed), so a
// snapshot that legitimately predates one of them can't momentarily revert
// it in the UI. `rootKey` is which top-level branch this snapshot is
// ('settings' or 'movieLog'); only in-flight paths under that branch apply.
// See the trackInFlightWrite mutation for the bug this fixes.
const reapplyInFlightWrites = (state, rootKey, data) => {
  const paths = Object.keys(state.inFlightWrites || {});
  if (!paths.length) return data;

  let result = data;
  paths.forEach((path) => {
    const segments = path.split('/').filter(Boolean);
    if (segments[0] !== rootKey || segments.length < 2) return;
    result = setValueAtPath(result, segments.slice(1), state.inFlightWrites[path]);
  });
  return result;
};

// Firebase
const firebaseConfig = {
  apiKey: process.env.VUE_APP_GOOGLE_API_KEY,
  authDomain: "movie-log-8c4d5.firebaseapp.com",
  databaseURL: "https://movie-log-8c4d5-default-rtdb.firebaseio.com",
  projectId: "movie-log-8c4d5",
  storageBucket: "movie-log-8c4d5.appspot.com",
  messagingSenderId: "84563192115",
  appId: "1:84563192115:web:121c681b37d284dcc93646",
  measurementId: "G-4K1Y42HFSL"
};

initializeApp(firebaseConfig);

// getAuth() MUST be called before getDatabase(), and at module load rather than
// lazily inside an action. The Realtime Database SDK picks up its auth-token
// provider from whatever is already registered on the app when it initialises;
// if Auth has never been instantiated it simply sends unauthenticated requests.
// That is invisible today (the database rules are open) but becomes a hard
// failure the moment those rules require `auth != null`.
const auth = getAuth();

const db = getDatabase();

// Pending debounced profile publish (see scheduleSocialPublish).
let socialPublishTimer = null;

// Records that the profile was just published, so Home's every-six-hours
// backstop doesn't immediately repeat a ~100KB write. Every path that publishes
// off the debounce timer goes through here, or the backstop and the timer
// disagree about when the last write happened.
const stampSocialPublish = () => {
  try {
    localStorage.setItem('cinemaRoll.social.lastPublish', String(Date.now()));
  } catch {
    // Private mode / storage full: the publish itself still happened.
  }
};

// Offline fallback / warm-launch source: Firebase RTDB's web SDK has no disk
// persistence (unlike Firestore), so the onValue socket in initializeDB never
// fires without a live connection and dbLoaded would hang forever. The
// last-synced IndexedDB snapshot races it: whichever settles the UI first,
// the onValue callback (which always fires once connected, cache hit or
// miss) is the source of truth and overwrites/re-persists on arrival — the
// dbLoaded guard just stops a slower cache read from clobbering
// already-arrived live data. One read per launch, shared by that race AND
// the delta-sync shadow check, which needs the snapshot as it stood BEFORE
// this launch's live data re-persists it (an IndexedDB read transaction
// opened here sees the pre-overwrite value regardless of when it resolves).
//
// Started BEFORE initializeDB awaits the auth restore — the snapshot is this
// device's own copy and needs no token — so a warm launch paints the library
// as soon as the slower of the two settles, not the sum. Cached at module
// scope so the router guard re-dispatching initializeDB during that wait
// can't fan out into duplicate multi-megabyte reads.
let snapshotReadInFlight = null; // { key, promise }

function listenersLiveFor (context, key) {
  return context.state.dbListenersAttachedFor === key && !context.state.dbReadDenied;
}

function startSnapshotRead (context, key) {
  if (snapshotReadInFlight && snapshotReadInFlight.key === key && !listenersLiveFor(context, key)) {
    return snapshotReadInFlight.promise;
  }
  const promise = loadSnapshot(key, 'movieLog').catch(() => null);
  snapshotReadInFlight = { key, promise };

  promise.then(async (cached) => {
    // The account changed while this read was in flight: whoever started
    // the read for the new key applies that one instead.
    if (context.getters.databaseTopKey !== key) return null;
    if (cached && !context.state.dbLoaded) {
      context.commit('setMovieLog', cached);
    }
    // Re-top the snapshot with anything still durably queued — the
    // snapshot only mirrors the last SERVER state, so without this a
    // movie rated offline vanished from view on relaunch (bug
    // report). Also covers a snapshot-less first session: the queue
    // entry alone is enough to show the rating.
    if (!context.state.dbLoaded) {
      await context.dispatch('replayPendingWrites', 'movieLog');
    }
    if (!context.state.dbLoaded && (cached || Object.keys(context.state.movieLog).length)) {
      context.commit('setDbLoaded', true);
    }
    return null;
  }).catch(() => {});

  return promise;
}

// Firebase restores a persisted session asynchronously after page load. The
// router guard, meanwhile, decides you're logged in synchronously from
// localStorage — so without this, database listeners can be attached before the
// auth token exists. Anything that reads user data waits on this promise.
//
// Resolves with the restored user, or null if there is no live session.
let resolveAuthReady;
export const authReady = new Promise((resolve) => {
  resolveAuthReady = resolve;
});

onAuthStateChanged(auth, (user) => {
  // Only the FIRST callback settles the promise; later ones (sign-in, sign-out)
  // are ordinary state changes, and a promise can't be re-resolved anyway.
  resolveAuthReady(user);
});

export default createStore({
  state: {
    movieLog: {},
    settings: {},
    weights: [ // These values should all add up to 10 except that "stickiness" gets divided by 2 first
      { name: "love", weight: 2.8 },
      { name: "overall", weight: 2 },
      { name: "story", weight: 1.25 },
      { name: "direction", weight: 1.1 },
      { name: "imagery", weight: 0.9 },
      { name: "stickiness", weight: 1.9 },
      { name: "performance", weight: 0.7 },
      { name: "soundtrack", weight: 0.3 },
    ],
    academyAwardWinners: {},
    // The FULL raw Academy Awards dataset (every category, every year, wins
    // AND nominations — ~11k records from the same self-built film-awards-api
    // service `academyAwardWinners` above already uses, just the bare
    // `/awards` endpoint with no `category` filter, "let's just go ahead and
    // pull it down and store it locally so we can use it wherever we want").
    // Separate from `academyAwardWinners` (Best-Picture-only, TMDB-enriched
    // for the existing Home.vue "Best Picture" quick-link feature) rather
    // than replacing it — this is the raw, unenriched, ALL-category dataset
    // other features (e.g. the Connections game's awards category) can
    // synchronously filter/match against without a per-movie network call.
    allAcademyAwards: [],
    userEmail: null,
    // The name the sign-in provider knows you by ("Matt Grosso"), as opposed
    // to the address you signed in with. Bug report, 2026-08-20: "It would be
    // nice if we could use someone's real name when we mention them in film
    // club" — every Film Club mention used to fall back to the email's local
    // part ("mattgrosso"), because this was thrown away at login. Restored
    // from localStorage on boot so a mention isn't wrong for the moment
    // before Firebase settles. Only ever a DEFAULT: an explicitly-set
    // settings/social/displayName still wins (see socialSettingsWithDefaults).
    userRealName: window.localStorage.getItem('userRealName') || null,
    databaseTopKey: null,
    newEntrySearchResults: [],
    movieToRate: {},
    // Money sorts and captions expressed in BASE_YEAR dollars (inflation.js).
    // localStorage rather than the database: it's a way of LOOKING at the
    // library, like sort order, not a fact about it — and it should not cost
    // a write or wait on a sync to take effect.
    moneyInTodaysDollars: window.localStorage.getItem('moneyInTodaysDollars') === 'true',
    // { dbKey, index } while RateMovie is amending an existing viewing,
    // otherwise null — see setRatingToEdit.
    ratingToEdit: null,
    DBSearchValue: null,
    DBSortValue: null,
    DBSortOrder: null,
    showHeader: true,
    // The "Cinema Roll" title overlay on the header banner - separate from
    // showHeader (which hides the whole header) since a game with its own
    // custom banner graphic may want the banner visible but its own
    // branding baked into the image instead of the usual overlay.
    hideHeaderLogo: false,
    goHome: false,
    // A small summary of Home.vue's LIVE filter/result state, published by
    // Home itself so in-app bug reports can actually show what was on
    // screen (see bugReports.js). Purely diagnostic - nothing reads it for
    // behaviour, and it is never persisted.
    homePageLiveState: null,
    devModeTopKey: 'testing-database',
    // devModeTopKey: 'natalierosegrosso-gmail-com',
    // devModeTopKey: 'carrieseltzer-gmail-com',
    // devModeTopKey: 'hopper-seth-gmail-com',
    // devModeTopKey: 'brianpatrick1-gmail-com',
    // Read once at store creation, then kept in reactive state — see the
    // `devMode` getter below for why it can't just re-read localStorage.
    devMode: localStorage.getItem('devMode') === 'true',
    dbLoaded: false,
    // True when the live movieLog/settings listener was CANCELLED by the
    // server (permission denied under the locked-down rules — wrong account,
    // dead session, or dev-mode pointing at a database this account can't
    // read). Drives LibraryAccessBanner's "your movies aren't gone"
    // guidance; cleared the moment a listener successfully delivers data.
    dbReadDenied: false,
    // Which account key the live movieLog/settings listeners are attached
    // for — the explicit "attach exactly once" guard. This replaced a
    // does-state-have-data check that a game screen's play-counter write
    // could fool by landing in settings before initializeDB ran (bug: the
    // Insights awards pane vanished because the settings listener never
    // attached and personalAwards never loaded).
    dbListenersAttachedFor: null,
    // True once REAL settings have arrived (snapshot or live) — not just
    // local write scraps. Gates the game recorders' read-modify-writes.
    settingsLoaded: false,
    // Latest delta-sync shadow-mode comparison (phase 1) — see
    // runDeltaShadowCheck. Null until a launch has a baseline to compare.
    deltaShadowReport: null,
    // Social layer (2026-08-15). Live inbox + friend edges via listeners;
    // directory and friend profiles fetched on demand. Shapes and the
    // publish-don't-peek design live in src/assets/javascript/social.js.
    socialRequests: {},
    socialEdges: {},
    socialDirectory: {},
    socialFriendProfiles: {},
    // When fetchFriendProfiles last STARTED. Profiles are one-shot reads, so
    // this is the only measure of how old they are (see clubFetchesNeeded).
    socialProfilesFetchedAt: 0,
    // Hats this account belongs to, from the one-off Movie Hat lookup.
    availableMovieHats: [],
    // TMDB ids of everything currently WAITING in a linked hat, so a "send
    // to hat" button can hide itself for a movie that is already in one
    // ("it would be nice if the hat icon button only appeared on movies
    // that aren't already in one of my hats", 2026-08-17). Drawn movies are
    // deliberately not counted: they have left the hat and are fair game
    // to put back in.
    movieHatMovieIds: {},
    movieHatContentsAt: 0,
    // Per-hat cards for the watchlist's draw section.
    movieHatSummaries: [],
    // The Google address signed into Movie Hat's project, if any.
    movieHatEmail: null,
    // Why the linked hats couldn't be read, when they couldn't:
    // { reason: 'not-connected' | 'token-failed' | 'denied', email }.
    // Null when the last read worked. Movie Hat's rules refuse anonymous
    // reads outright, so without this the whole section just renders empty
    // or "couldn't load" and nothing anywhere says to sign back in.
    movieHatAccessError: null,
    // Friends on other apps (Movie Log), translated into the same profile
    // shape as native friends. Held in memory; the subscription itself
    // lives in settings/externalFriends.
    externalFriendProfiles: {},
    externalFriendErrors: {},
    // Connect requests from people on other apps (see clubInbox rules).
    clubInboxRequests: {},
    // Users of other apps, fetched from their public directories.
    federatedDirectory: [],
    federatedDirectoryLoading: false,
    socialAttachedFor: null,
    // Push notifications (see src/utils/push.js + pushPrefs.js). `pushPrefs`
    // is the stored `{topKey}/push/prefs` node (null until loaded);
    // `pushSubscribed` is whether ANY device holds a subscription — the gate
    // for bothering to publish the digest at all.
    pushPrefs: null,
    pushSubscribed: false,
    // When the user last opened the Film Club — drives the rainbow chip's
    // new-updates badge. Mirrored to localStorage so it survives reloads.
    filmClubLastSeen: Number(localStorage.getItem('cinemaRoll.filmClub.lastSeen') || 0),
    filteredResults: [],
    // Header banner: Home resolves bannerUrl on arrival based on bannerRequest
    // (set by MovieDetail/RateMovie/search links). See Header.vue + Home.resolveBanner.
    bannerUrl: null,
    bannerRequest: null, // { type: 'movie', movieId } | { type: 'fromResults' } | null
    // Home page navigation state preservation
    homePageScrollPosition: 0,
    homePageSearchChips: [],
    homePageSearchValue: '',
    homePageNumberOfResults: 25,
    homePageNavigationIntent: null, // 'close' | 'search' | null
    homePageSortValue: null, // preserve sort value for 'close' navigation
    homePageSortOrder: null, // preserve sort order for 'close' navigation
    homePagePromoteGroup: null, // group key to promote to top when navigating from a clicked value
    // Simple save debouncing
    lastSavePath: null,
    lastSaveTime: 0,
    // Offline rating support: isOnline drives which entry points/paths are
    // reachable (see AddRating.js, RateMovie.vue, Home.vue), and is flipped
    // by App.vue's 'online'/'offline' listeners. isFlushingPendingWrites
    // guards flushPendingWrites against overlapping passes when its several
    // triggers (see App.vue) fire close together. pendingReconciliations
    // mirrors the pendingWriteQueue's unreconciled placeholder entries, kept
    // in Vuex so Home.vue can reactively show a "needs a match" banner.
    isOnline: typeof navigator !== 'undefined' ? navigator.onLine : true,
    // { [dbPath]: value } for writes committed locally but not yet confirmed
    // by the server — see the trackInFlightWrite mutation for why.
    inFlightWrites: {},
    isFlushingPendingWrites: false,
    pendingReconciliations: [],
    // Flipped by registerServiceWorker.js's `updated` hook once a new
    // version has installed and activated in the background. Deliberately
    // does NOT auto-reload (see UpdateAvailableBanner.vue's own comment for
    // the bug report this fixed) - an unconditional window.location.reload()
    // there used to yank the page out from under whatever the user was
    // doing (e.g. mid-way through the box office backfill button).
    updateAvailable: false,
  },
  getters: {
    allMediaAsArray: (state) => {
      if (!state.dbLoaded) {
        return [];
      }

      return Object.keys(state.movieLog).map((key) => {
        const movie = state.movieLog[key];
        movie.dbKey = key;
        return movie;
      });
    },
    allMoviesAsArray: (state) => {
      return Object.keys(state.movieLog).map((key) => {
        return state.movieLog[key];
      })
    },
    allMediaSortedByRating: (state, getters) => {
      return getters.allMediaAsArray.sort(sortByRating);
    },
    allMediaRatingsArray: (state, getters) => {
      return getters.allMediaAsArray.map((media) => {
        return mostRecentRating(media).calculatedTotal;
      });
    },
    databaseTopKey (state, getters) {
      return getters.devMode ? state.devModeTopKey : state.databaseTopKey;
    },
    // Social is keyed by the REAL signed-in account, never the dev-mode
    // sandbox — the database rules only allow writes under the key that
    // matches the auth token's email.
    socialUserKey (state) {
      return state.databaseTopKey;
    },
    socialSettings (state) {
      // Sharing is ON by default — the friend handshake is the real consent
      // gate (rules make unfriended profiles unreadable). Explicit false in
      // settings.social is the opt-out. See socialSettingsWithDefaults.
      return socialSettingsWithDefaults(state.settings?.social, state.userEmail, state.userRealName);
    },
    // Friendship = BOTH edges exist. My friends are my outgoing edges that
    // the other side has reciprocated.
    //
    // QA accounts are dropped here, at the single point everything else reads
    // through — friends list, profiles, the club summary, the update badge,
    // and the profile fetch. The database edges stay mutual on BOTH sides,
    // because the rules require that to let the tester read a profile at all;
    // the one-way-ness is this filter (Matt, 2026-08-16: "make it so that the
    // testing account is friends with me, but that I just don't see them in
    // my friend's list... they can see me, but I can't see them").
    //
    // Note this filters by the FRIEND's key, so it hides the tester from a
    // real person without hiding real people from the tester.
    socialFriendKeys (state, getters) {
      const me = getters.socialUserKey;
      if (!me) return [];
      const myEdges = state.socialEdges?.[me] || {};
      return Object.keys(myEdges)
        .filter((key) => state.socialEdges?.[key]?.[me])
        .filter((key) => !isQaAccountKey(key));
    },
    // Requests I've sent that the other side hasn't accepted yet: my
    // outgoing edges with no reciprocal edge.
    // New friend ratings since the Film Club was last opened — only
    // mutual friends' profiles count (others aren't readable anyway).
    filmClubNewUpdateCount (state, getters) {
      const profiles = {};
      getters.socialFriendKeys.forEach((key) => {
        if (state.socialFriendProfiles?.[key]) profiles[key] = state.socialFriendProfiles[key];
      });
      return countNewFriendUpdates(profiles, state.filmClubLastSeen);
    },
    // One list for the whole club: native mutual friends and friends on
    // other apps, in the same shape, so nothing downstream needs to care
    // which app someone uses.
    crossAppDiscoveryEnabled (state) {
      return Boolean(state.settings?.crossAppDiscovery);
    },
    clubInboxRequests (state) {
      return normalizeInboxRequests(state.clubInboxRequests);
    },
    filmClubFriends (state, getters) {
      const native = getters.socialFriendKeys.map((key) => ({
        key,
        // Profile first, then the directory row, then — only if this person
        // has published neither — the database key. That middle step matters:
        // profiles are fetched lazily and are ~100KB each, so before they
        // land every friend was being MENTIONED BY DATABASE KEY, which is a
        // sanitized email address (bug report, 2026-08-20: "It would be nice
        // if we could use someone's real name when we mention them in film
        // club"). The directory row is already in memory and carries the same
        // name the profile will.
        name: state.socialFriendProfiles?.[key]?.name || state.socialDirectory?.[key]?.name || key,
        profile: state.socialFriendProfiles?.[key] || null,
        external: false
      }));
      // Deduped on the way out as well as on the way in, so a club that was
      // already doubled reads correctly straight away rather than waiting
      // for anyone to prune their settings.
      const external = Object.entries(dedupeExternalFriends(state.settings?.externalFriends)).map(([id, friend]) => ({
        key: id,
        name: state.externalFriendProfiles?.[id]?.name || friend?.name || 'A friend',
        profile: state.externalFriendProfiles?.[id] || null,
        external: true,
        source: state.externalFriendProfiles?.[id]?.source || 'external',
        error: state.externalFriendErrors?.[id] || null
      }));
      return [...native, ...external].sort((a, b) => a.name.localeCompare(b.name));
    },
    // Keyed profiles for everything that aggregates across the club
    // (summary, watchlist picks).
    filmClubProfiles (state, getters) {
      const out = {};
      getters.filmClubFriends.forEach((friend) => {
        if (friend.profile) out[friend.key] = friend.profile;
      });
      return out;
    },
    /** Hats this account has linked, as [{ title, dbKey }]. */
    linkedMovieHats (state) {
      const hats = state.settings?.movieHat?.hats;
      const list = Array.isArray(hats)
        ? hats.filter((hat) => hat && hat.title)
        // Firebase turns a sparse array back into an object map.
        : (hats && typeof hats === 'object'
          ? Object.values(hats).filter((hat) => hat && hat.title)
          : []);

      // Most recently used first: "the order of my hats should be based on
      // which hat [I] most recently added to, so they should get sorted by
      // how recently I used them" (2026-08-17). A hat never used yet keeps
      // its configured position behind the ones that have been.
      return [...list].sort((a, b) => (Number(b.lastUsedAt) || 0) - (Number(a.lastUsedAt) || 0));
    },
    socialPendingSentKeys (state, getters) {
      const me = getters.socialUserKey;
      if (!me) return [];
      const myEdges = state.socialEdges?.[me] || {};
      return Object.keys(myEdges).filter((key) => !state.socialEdges?.[key]?.[me]);
    },
    // Backed by state.devMode (set via the setDevMode mutation), not a direct
    // localStorage read. A Vuex getter is a Vue computed under the hood: with
    // no reactive dependency (a bare `localStorage.getItem(...)` read touches
    // no observed state), it only evaluates once and then caches that value
    // forever, so toggling localStorage directly — from another tab, devtools,
    // or a differently-reloaded page — would never be picked up without a
    // full app reload. Routing state.devMode through here keeps it reactive.
    devMode (state) {
      return state.devMode;
    },
    weight (state) {
      return (name) => {
        return state.weights.find((weight) => weight.name === name).weight;
      }
    },
  },
  mutations: {
    setMovieLog (state, value) {
      state.movieLog = Object.freeze(value);
    },
    setSettings (state, value) {
      state.settings = value;
    },
    setAcademyAwardWinners (state, value) {
      state.academyAwardWinners = value
    },
    setSocialRequests (state, value) {
      state.socialRequests = value || {};
    },
    setSocialEdges (state, value) {
      state.socialEdges = value || {};
    },
    setAvailableMovieHats (state, value) {
      state.availableMovieHats = value || [];
    },
    setMovieHatContents (state, { ids, at } = {}) {
      state.movieHatMovieIds = ids || {};
      state.movieHatContentsAt = at || 0;
    },
    // Sent successfully: hide those buttons now rather than after the next
    // refresh of the cache.
    noteMoviesInHat (state, ids) {
      (ids || []).forEach((id) => {
        if (id != null) state.movieHatMovieIds[id] = true;
      });
    },
    setMovieHatUser (state, user) {
      state.movieHatEmail = user?.email || null;
      // Connecting (or disconnecting) makes any previous refusal stale — the
      // next read is the only thing that can say whether it still applies.
      state.movieHatAccessError = null;
    },
    setMovieHatAccessError (state, value) {
      state.movieHatAccessError = value || null;
    },
    setMovieHatSummaries (state, value) {
      state.movieHatSummaries = value || [];
    },
    setSocialDirectory (state, value) {
      state.socialDirectory = value || {};
    },
    setFederatedDirectory (state, rows) {
      state.federatedDirectory = rows || [];
    },
    setFederatedDirectoryLoading (state, value) {
      state.federatedDirectoryLoading = Boolean(value);
    },
    setClubInboxRequests (state, value) {
      state.clubInboxRequests = value || {};
    },
    setExternalFriendProfile (state, { id, profile }) {
      const next = { ...state.externalFriendProfiles };
      if (profile) next[id] = profile; else delete next[id];
      state.externalFriendProfiles = next;
    },
    setExternalFriendError (state, { id, message }) {
      state.externalFriendErrors = { ...state.externalFriendErrors, [id]: message };
    },
    setSocialFriendProfile (state, { key, profile }) {
      state.socialFriendProfiles = { ...state.socialFriendProfiles, [key]: profile };
    },
    setSocialProfilesFetchedAt (state, value) {
      state.socialProfilesFetchedAt = value;
    },
    setSocialAttachedFor (state, value) {
      state.socialAttachedFor = value;
    },
    setPushPrefs (state, value) {
      state.pushPrefs = value;
    },
    setPushSubscribed (state, value) {
      state.pushSubscribed = Boolean(value);
    },
    markFilmClubSeen (state) {
      state.filmClubLastSeen = Date.now();
      localStorage.setItem('cinemaRoll.filmClub.lastSeen', String(state.filmClubLastSeen));
    },
    setAllAcademyAwards (state, value) {
      state.allAcademyAwards = value;
    },
    setUserEmail (state, value) {
      state.userEmail = value;
    },
    setUserRealName (state, value) {
      const name = (value || '').trim() || null;
      state.userRealName = name;
      if (name) {
        window.localStorage.setItem('userRealName', name);
      } else {
        window.localStorage.removeItem('userRealName');
      }
    },
    setDatabaseTopKey (state, value) {
      state.databaseTopKey = emailToDatabaseKey(value);
    },
    setNewEntrySearchResults (state, value) {
      const results = [...value];
      const sorted = results.sort(sortByVoteCount);

      state.newEntrySearchResults = sorted;
    },
    setMoneyInTodaysDollars (state, on) {
      state.moneyInTodaysDollars = Boolean(on);
      window.localStorage.setItem('moneyInTodaysDollars', String(state.moneyInTodaysDollars));
    },
    setMovieToRate (state, movie) {
      state.movieToRate = movie;
      // Clearing here, not at the call sites. Every route into RateMovie
      // commits this mutation, so a stale `ratingToEdit` left over from a
      // previous edit would turn the NEXT "Add New Rating" into an
      // overwrite of an old viewing — silent data loss. Making the reset
      // part of this mutation means no call site can forget it; the edit
      // path commits setRatingToEdit immediately after this one.
      state.ratingToEdit = null;
    },
    // { dbKey, index } — which existing rating RateMovie is amending, or
    // null for a brand-new one. Deliberately an index into the entry's own
    // `ratings` array (the same index deleteRating uses); `getAllRatings`
    // maps 1:1 over it, so what the accordion shows at row N is ratings[N].
    setRatingToEdit (state, target) {
      state.ratingToEdit = target;
    },
    // Applies a single movieLog write to local state immediately, regardless
    // of connectivity - the optimistic-commit half of offline rating support
    // (see AddRating.js). Without this, an offline write would only queue to
    // IndexedDB and wouldn't show up anywhere (grid, previous viewings, a
    // same-session re-edit) until the queue actually flushes. setMovieLog
    // freezes movieLog wholesale, so this rebuilds+refreezes a new object
    // rather than mutating the existing (frozen) one in place.
    setMovieLogEntry (state, { key, value }) {
      state.movieLog = Object.freeze({ ...state.movieLog, [key]: value });
    },
    // Batched counterpart to setMovieLogEntry - applies MANY entries in one
    // spread+freeze+reactivity-trigger instead of one per entry (bug fix,
    // Jul 2026: the box office backfill button called setMovieLogEntry once
    // per movie as each one completed - for a large library that's hundreds
    // of full movieLog copies + reactivity cascades in rapid succession,
    // severe enough to freeze/crash the tab on a real device. Batching
    // callers, e.g. backfillBoxOffice.js, cuts that down by the batch size).
    setMovieLogEntries (state, entries) {
      const updated = { ...state.movieLog };
      entries.forEach(({ key, value }) => { updated[key] = value; });
      state.movieLog = Object.freeze(updated);
    },
    // General-purpose counterpart to setMovieLogEntry/setMovieLogEntries for
    // any OTHER db path — settings/* (any depth: settings/lastTweak,
    // settings/personalAwards/2024, ...) and deeper movieLog/* paths that
    // aren't a plain full-entry replace. Added for the offline-support
    // extension to Stickiness/Tiebreak/Personal Awards (Jul 2026) — those
    // three write mostly to settings/*, which had NO local-optimistic-commit
    // mutation at all before this (unlike movieLog, which got one during the
    // original offline-rating work) - without it, an offline write to e.g.
    // settings/tieBreakTournament wouldn't show up anywhere until the queue
    // actually flushed. Reuses setMovieLogEntry's exact shape for the common
    // movieLog/<key> case (freeze + reactivity trigger) rather than routing
    // it through the generic recursive path, since that's already proven and
    // used by every existing movieLog writer.
    applyDbPathLocally (state, { path, value }) {
      const segments = (path || '').split('/').filter(Boolean);
      const [root, ...rest] = segments;
      if (!root || !rest.length) return;

      if (root === 'movieLog' && rest.length === 1) {
        state.movieLog = Object.freeze({ ...state.movieLog, [rest[0]]: value });
        return;
      }
      if (root === 'movieLog') {
        state.movieLog = Object.freeze(setValueAtPath(state.movieLog, rest, value));
        return;
      }
      if (root === 'settings') {
        state.settings = setValueAtPath(state.settings, rest, value);
      }
    },
    // Bug report (Jul 2026): "After I break a tie, I get the tie break
    // message again just for a second or two." A tiebreak fires several
    // writeDurably calls back to back (the tournament record, the movieLog
    // score adjustments, the settings/lastTweak quota stamp). Each one
    // commits locally first, but its Firebase set() was serialized BEHIND an
    // IndexedDB enqueue - so the first write reached the server while a
    // later one (lastTweak) hadn't been issued yet. The server's onValue
    // then fired with a snapshot that legitimately predated lastTweak, and
    // setSettings replaces settings WHOLESALE - clobbering the local commit
    // and flipping the quota check back to "due", which re-showed the
    // notice until the lastTweak write finally landed.
    //
    // These two mutations track a write from the moment it's committed
    // locally until the server confirms it, so an incoming snapshot can be
    // re-topped with anything still in flight (see reapplyInFlightWrites)
    // instead of momentarily reverting it.
    trackInFlightWrite (state, { path, value }) {
      state.inFlightWrites = { ...state.inFlightWrites, [path]: value };
    },
    untrackInFlightWrite (state, path) {
      const next = { ...state.inFlightWrites };
      delete next[path];
      state.inFlightWrites = next;
    },
    setIsOnline (state, value) {
      state.isOnline = value;
    },
    setIsFlushingPendingWrites (state, value) {
      state.isFlushingPendingWrites = value;
    },
    setPendingReconciliations (state, value) {
      state.pendingReconciliations = value;
    },
    setUpdateAvailable (state, value) {
      state.updateAvailable = value;
    },
    setDBSearchValue (state, value) {
      state.DBSearchValue = value;
    },
    setDBSortValue (state, value) {
      state.DBSortValue = value;
    },
    setDBSortOrder (state, value) {
      state.DBSortOrder = value;
    },
    setShowHeader (state, value) {
      state.showHeader = value;
    },
    setHideHeaderLogo (state, value) {
      state.hideHeaderLogo = value;
    },
    setGoHome (state, value) {
      state.goHome = value;
    },
    setHomePageLiveState (state, value) {
      state.homePageLiveState = value;
    },
    setDbLoaded (state, value) {
      state.dbLoaded = value;
    },
    setDbReadDenied (state, value) {
      state.dbReadDenied = value;
    },
    setDbListenersAttachedFor (state, value) {
      state.dbListenersAttachedFor = value;
    },
    setSettingsLoaded (state, value) {
      state.settingsLoaded = value;
    },
    setDeltaShadowReport (state, value) {
      state.deltaShadowReport = value;
    },
    // Persists to localStorage here too, so this is the one place that needs
    // to know devMode is backed by localStorage at all — callers just commit.
    setDevMode (state, value) {
      state.devMode = value;
      localStorage.setItem('devMode', value);
    },
    setFilteredResults (state, value) {
      state.filteredResults = value;
    },
    setBannerUrl (state, value) {
      state.bannerUrl = value;
    },
    setBannerRequest (state, value) {
      state.bannerRequest = value;
    },
    updateLastSave (state, { path, time }) {
      state.lastSavePath = path;
      state.lastSaveTime = time;
    },
    // Home page navigation state mutations
    setHomePageScrollPosition (state, value) {
      state.homePageScrollPosition = value;
    },
    setHomePageSearchChips (state, value) {
      state.homePageSearchChips = value;
    },
    setHomePageSearchValue (state, value) {
      state.homePageSearchValue = value;
    },
    setHomePageNumberOfResults (state, value) {
      state.homePageNumberOfResults = value;
    },
    setHomePageNavigationIntent (state, value) {
      state.homePageNavigationIntent = value;
    },
    setHomePageSortValue (state, value) {
      state.homePageSortValue = value;
    },
    setHomePageSortOrder (state, value) {
      state.homePageSortOrder = value;
    },
    setHomePagePromoteGroup (state, value) {
      state.homePagePromoteGroup = value;
    }
  },
  actions: {
    // Shared tail of EVERY sign-in method (Google, Apple, email/password).
    // A user's whole library is keyed by their email address, so this is the
    // one place that derives the key, persists it, and boots the database —
    // no provider gets to do that its own way.
    completeLogin (context, user) {
      const email = user?.email;

      if (!email) {
        // Every provider we enable returns an email (Apple's "Hide My Email"
        // returns a stable per-app relay address, which works fine as a key).
        // If one somehow doesn't, failing loudly is much safer than dropping
        // the user into an empty, wrongly-keyed database.
        ErrorLogService.error('Sign-in succeeded but returned no email address', user);
        throw new Error("Signed in, but no email address came back. Cinema Roll keys your library by email, so it can't continue.");
      }

      context.commit('setUserEmail', email);
      // Google and Apple both hand back the account holder's own name; it is
      // what Film Club should call them (bug report, 2026-08-20). Apple only
      // returns it on the very FIRST authorization, so a null here must not
      // wipe a name captured earlier — hence the guard.
      if (user?.displayName) context.commit('setUserRealName', user.displayName);
      // NOTE: this used to `dispatch` — but setDatabaseTopKey is a MUTATION,
      // never an action, so that dispatch was a silent no-op and state.databaseTopKey
      // stayed null through login. It only worked because the router guard
      // re-read the key from localStorage on the very next navigation and
      // committed it there. Committing directly makes the flow correct rather
      // than accidentally correct.
      context.commit('setDatabaseTopKey', email);
      window.localStorage.setItem('databaseTopKey', emailToDatabaseKey(email));
      // Kept alongside the key so the "Signed in as ..." line survives a
      // reload. state.databaseTopKey is sanitized and can't be turned back
      // into an address, so the raw email has to be stored separately.
      window.localStorage.setItem('userEmail', email);
      context.dispatch('initializeDB');
      router.push('/');
    },
    async login (context) {
      // Kept under its original name so existing callers keep working.
      return context.dispatch('loginWithGoogle');
    },
    async loginWithGoogle (context) {
      const result = await signInWithPopup(getAuth(), new GoogleAuthProvider());
      context.dispatch('completeLogin', result.user);
    },
    async loginWithApple (context) {
      // Apple is an OAuth provider rather than a first-class one in the
      // Firebase SDK. The email scope is required — without it Apple returns
      // no address at all and completeLogin would (correctly) refuse.
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');

      const result = await signInWithPopup(getAuth(), provider);
      context.dispatch('completeLogin', result.user);
    },
    // Automated-testing sign-in: scripts/mint-test-token.mjs mints a
    // short-lived Admin-SDK custom token for the dedicated tester account,
    // and /#/login?testToken=... hands it here. Safe by construction: a
    // custom token only signs in the account it was minted for, minting
    // requires the admin key, and the database rules scope any account to
    // its own email-derived branch — so this can never reach real data.
    async loginWithTestToken (context, token) {
      const result = await signInWithCustomToken(getAuth(), token);
      context.dispatch('completeLogin', result.user);
    },
    async loginWithEmail (context, { email, password }) {
      const result = await signInWithEmailAndPassword(getAuth(), email, password);
      context.dispatch('completeLogin', result.user);
    },
    async signUpWithEmail (context, { email, password }) {
      const result = await createUserWithEmailAndPassword(getAuth(), email, password);

      // Fire and forget, and deliberately not enforced anywhere yet — a library
      // is keyed by email address, so being able to prove you own that address
      // matters. Firebase's "one account per email" setting is what actually
      // stops someone registering an address that's already in use; this is the
      // groundwork for tightening that later without blocking sign-ups now.
      sendEmailVerification(result.user).catch((error) => {
        ErrorLogService.error('Could not send verification email', error);
      });

      context.dispatch('completeLogin', result.user);
    },
    async sendPasswordReset (context, email) {
      await sendPasswordResetEmail(getAuth(), email);
    },
    async logout (context) {
      await signOut(getAuth());
      window.localStorage.removeItem('databaseTopKey');
      window.localStorage.removeItem('userEmail');
      context.commit('setUserEmail', null);
      // The mutation clears the stored copy too — signing out must not leave
      // the previous account's name behind for whoever signs in next.
      context.commit('setUserRealName', null);
      context.commit('setDatabaseTopKey', null);
      await context.dispatch('resetLocalDB');
      router.push('/login');
    },
    // The router decides you're signed in synchronously from localStorage,
    // which is the only thing that ever gated access while the database rules
    // were open. Once they aren't, a stale key (session expired, password
    // changed, signed out on another device) would show an empty library with
    // no explanation. This reconciles the two once Firebase has had its say.
    async verifyRestoredSession (context) {
      const storedKey = window.localStorage.getItem('databaseTopKey');
      if (!storedKey) {
        return;
      }

      const user = await authReady;
      if (user) {
        // Keep the in-memory identity honest even if localStorage is stale —
        // the restored session is the authority on who you actually are.
        if (user.email && user.email !== context.state.userEmail) {
          context.commit('setUserEmail', user.email);
          window.localStorage.setItem('userEmail', user.email);
        }
        // Anyone already signed in when this shipped never went through
        // completeLogin again, so this is where their real name is picked up.
        if (user.displayName && user.displayName !== context.state.userRealName) {
          context.commit('setUserRealName', user.displayName);
        }
        return;
      }

      // Only act when we can actually tell a revoked session apart from a
      // flaky one. Firebase restores sessions from local persistence without
      // a network, so this is belt-and-braces rather than strictly required.
      if (!context.state.isOnline) {
        return;
      }

      ErrorLogService.error('Stored login found but no Firebase session — signing out', { storedKey });
      await context.dispatch('logout');
    },
    async resetLocalDB (context) {
      context.commit('setMovieLog', {});
      context.commit('setSettings', {});
      context.commit('setAcademyAwardWinners', {});
      // allAcademyAwards deliberately NOT reset here — unlike movieLog/
      // settings/academyAwardWinners (all scoped to whichever account this
      // is switching to/from), the full awards dataset isn't user-specific
      // at all, so there's no reason to discard and re-fetch ~11k records
      // just because the active account changed.

      await context.dispatch('initializeDB');
    },
    async initializeDB (context) {
      if (!context.getters.databaseTopKey) {
        return;
      }

      // Wait for Firebase to restore (or rule out) a persisted session before
      // attaching any listener, so reads always carry an auth token. Harmless
      // while the database rules are open; load-bearing once they aren't.
      //
      // Deliberately NOT gated on the result: the offline path below has to
      // keep working from the IndexedDB snapshot even when there's no live
      // session to restore, and the router owns the "you're signed out, go to
      // /login" decision (see verifyRestoredSession).
      // Start the local snapshot read NOW, in parallel with the auth restore,
      // instead of after it. Bug report (Matt, 2026-09-05): tapping a push
      // notification "shows me Cinema Roll and then immediately flashes to
      // the loading screen and then shows it again." iOS reloads a Home
      // Screen web app when a notification navigates it (the declarative
      // payload's `navigate` URL is mandatory), so the reload itself is the
      // OS's; what's ours is how long the reloaded page sits on the spinner.
      // It used to be auth restore + IndexedDB read back to back, for a
      // read that never needed a token — it's this device's own copy.
      // Now they overlap, and the spinner is delayed on Home so a warm
      // launch never shows it at all.
      const earlyKey = context.getters.databaseTopKey;
      let priorSnapshotPromise = listenersLiveFor(context, earlyKey) ? null : startSnapshotRead(context, earlyKey);

      await authReady;

      const topKey = context.getters.databaseTopKey;

      // Attach the live listeners exactly once per account key. The old
      // guard asked "does state already have data?" — which broke the day
      // game screens started committing a play-counter into settings at
      // mount: that scrap of local data read as "already loaded," the
      // settings listener never attached, and the whole session ran
      // without personalAwards (the vanished Insights pane). An explicit
      // flag can't be fooled by local writes. dbReadDenied still forces a
      // re-attach after sign-in, since a cancelled listener never refires.
      const listenersLive = listenersLiveFor(context, topKey);
      if (!listenersLive) {
        context.commit('setDbListenersAttachedFor', topKey);
        // The snapshot read started above, before auth settled. Only if the
        // account changed while auth was restoring (a dev-mode flip mid-boot)
        // does it need starting over for the right key.
        if (!priorSnapshotPromise || earlyKey !== topKey) {
          priorSnapshotPromise = startSnapshotRead(context, topKey);
        }
        let shadowCheckStarted = false;

        // Shared by both load modes: a cancelled listener means permission
        // denied under the locked-down rules — a dead/wrong session, or dev
        // mode pointing at a database this account can't read. The library
        // isn't empty, this device just can't see it — surface that
        // (LibraryAccessBanner) instead of leaving a silent empty grid.
        const onMovieLogCancelled = (error) => {
          console.error('movieLog listener cancelled:', error);
          ErrorLogService.error('movieLog listener cancelled:', error);
          context.commit('setDbReadDenied', true);
          // Whatever the snapshot fallback managed to show is all there is;
          // stop any loading state so the banner + cached view take over.
          context.commit('setDbLoaded', true);
        };

        // Delta sync phase 2/3 (2026-08-17): which listener attaches decides
        // what this launch downloads. launchPlan picks delta only when the
        // lastSync baseline AND a non-empty snapshot both exist and a full
        // resync isn't due; anything else — first run, lost snapshot, stale
        // baseline, any error below — lands on the full listener, which is
        // also where the shadow comparison keeps running (and recording
        // readings) at resync cadence.
        const attachFullListener = () => onValue(ref(db, `${topKey}/movieLog`), (snapshot) => {
          const data = snapshot.val();

          if (data) {
            // Delta sync SHADOW check (phase 1): reconstruct the library
            // from prior-snapshot + delta query and diff it against this
            // full download, acting on neither. Once per session, and
            // dispatched BEFORE saveSnapshot below re-persists the fresh
            // data (the prior-snapshot read transaction is already open, so
            // ordering here is belt-and-braces, not load-bearing).
            if (!shadowCheckStarted) {
              shadowCheckStarted = true;
              context.dispatch('runDeltaShadowCheck', { fresh: data, priorSnapshotPromise, topKey });
            }
            // Same in-flight re-top as the settings listener below — a
            // tiebreak's score adjustments are movieLog writes, and a
            // snapshot predating them would otherwise briefly restore the
            // pre-tiebreak scores (re-showing the tie).
            context.commit('setMovieLog', reapplyInFlightWrites(context.state, 'movieLog', data));
            saveSnapshot(topKey, 'movieLog', data);
            // And the durable-queue re-top: on a reconnecting launch this
            // first server snapshot predates the background flush, so
            // without this the offline-made rating blinked out of the
            // library until the flush's own refire brought it back.
            context.dispatch('replayPendingWrites', 'movieLog');
          }
          context.commit('setDbReadDenied', false);
          context.commit('setDbLoaded', true);
        }, onMovieLogCancelled);

        // The delta path: a startAt(lastSync) query listener. Every write
        // stamps updatedAt with serverTimestamp(), which is always >= the
        // baseline, so the one query delivers BOTH the catch-up set at
        // attach AND every live change for the rest of the session — the
        // full listener's job at a fraction of the download. Deletions
        // can't appear in a "what changed" query, so the (tiny) tombstone
        // node is listened to alongside and applied by
        // reconstructFromDelta's newer-stamp-wins rule.
        const attachDeltaListener = (meta, priorSnapshot) => {
          let latestDelta = null; // null = query hasn't fired; {} = fired, nothing changed
          let latestTombstones = {};

          const applyReconstruction = () => {
            if (latestDelta === null) return;
            const reconstructed = reconstructFromDelta(priorSnapshot, latestDelta, latestTombstones);
            // Same in-flight + durable-queue re-tops as the full listener:
            // the snapshot half of the reconstruction predates this
            // session's writes by definition.
            context.commit('setMovieLog', reapplyInFlightWrites(context.state, 'movieLog', reconstructed));
            saveSnapshot(topKey, 'movieLog', reconstructed);
            // Snapshot and lastSync advance TOGETHER in this same pass —
            // the invariant that makes next launch's startAt(lastSync)
            // sound. (A local serverTimestamp echo can briefly overstate
            // lastSync by clock skew; the periodic full resync bounds it.)
            const newLastSync = maxUpdatedAt(reconstructed);
            if (newLastSync != null && newLastSync !== meta.lastSync) {
              saveSnapshot(topKey, 'deltaSyncMeta', { ...meta, lastSync: newLastSync, savedAt: Date.now() });
            }
            context.dispatch('replayPendingWrites', 'movieLog');
            context.commit('setDbReadDenied', false);
            context.commit('setDbLoaded', true);
          };

          onValue(ref(db, `${topKey}/movieLogDeletions`), (snap) => {
            latestTombstones = snap.val() || {};
            applyReconstruction();
          }, (error) => {
            // Tombstones are advisory; a denied read here (same rules gate
            // as movieLog, so this shouldn't happen alone) costs deletions
            // propagating until the next full resync, not the library.
            console.warn('movieLogDeletions listener cancelled:', error);
          });

          onValue(query(ref(db, `${topKey}/movieLog`), orderByChild('updatedAt'), startAt(meta.lastSync)), (snap) => {
            latestDelta = snap.val() || {};
            applyReconstruction();
          }, onMovieLogCancelled);
        };

        (async () => {
          try {
            const meta = await loadSnapshot(topKey, 'deltaSyncMeta').catch(() => null);
            // Only a launch that MIGHT go delta waits on the (big) snapshot
            // read; with no baseline the full listener attaches without
            // gating network on IndexedDB.
            if (meta?.lastSync != null) {
              const priorSnapshot = await priorSnapshotPromise;
              const plan = launchPlan(meta, priorSnapshot);
              if (plan.mode === 'delta') {
                attachDeltaListener(meta, priorSnapshot);
                return;
              }
              console.info(`[delta-sync] full download this launch: ${plan.reason}`);
            }
          } catch (error) {
            console.warn('[delta-sync] falling back to full download:', error);
          }
          attachFullListener();
        })();

        loadSnapshot(topKey, 'settings').then(async (cached) => {
          // settingsLoaded (not key-counting) decides whether the snapshot
          // may apply: local write scraps can predate it. The snapshot
          // replaces them wholesale, and the queue replay below restores
          // them on top — they were durably enqueued by the same writes
          // that created them.
          if (cached && !context.state.settingsLoaded) {
            context.commit('setSettings', cached);
            context.commit('setSettingsLoaded', true);
            await context.dispatch('replayPendingWrites', 'settings');
          }
          return null;
        }).catch(() => {});

        onValue(ref(db, `${topKey}/settings`), (snapshot) => {
          const data = snapshot.val();

          if (data) {
            // Snapshot the raw server data offline, but show the version
            // re-topped with still-unconfirmed local writes (see
            // reapplyInFlightWrites) so a just-made change can't flicker back.
            context.commit('setSettings', reapplyInFlightWrites(context.state, 'settings', data));
            context.commit('setSettingsLoaded', true);
            saveSnapshot(topKey, 'settings', data);
            context.dispatch('replayPendingWrites', 'settings');
          }
        }, (error) => {
          // Same denial signal as the movieLog listener above (the rules
          // gate both identically); committing the flag twice is harmless.
          console.error('settings listener cancelled:', error);
          context.commit('setDbReadDenied', true);
        });
      }
      const academyAwardWinnersHasData = Boolean(Object.keys(context.state.academyAwardWinners).length);
      if (!academyAwardWinnersHasData) {
        // This block enriches ~98 Best Picture winners with a TMDB call EACH,
        // sequentially. It used to be guarded only on in-memory state, so every
        // cold launch re-ran all 98 requests — the single largest source of API
        // traffic in the app. The list changes once a year, so it caches like
        // movieLog/settings do, keyed 'global' because it isn't user-specific.
        const cached = await loadSnapshot('global', 'academyAwardWinners');
        if (cached && Object.keys(cached).length) {
          context.commit('setAcademyAwardWinners', cached);
        }
      }

      if (!Object.keys(context.state.academyAwardWinners).length) {
        try {
          const response = await axios.get(`https://web-production-b8145.up.railway.app/awards?category=Best%20Picture`);
          const data = response.data.map((item) => {
            return {
              ...item,
              isWinner: ['TRUE', '1', true].includes(item.isWinner)
            }
          }).filter((item) => item.isWinner);

          const bestPictureWinners = [];

          for (const movieEntry of data) {
            try {
              const movieResponse = await axios.get(`https://api.themoviedb.org/3/movie/${movieEntry.tmdb}?api_key=${process.env.VUE_APP_TMDB_API_KEY}`);
              bestPictureWinners.push({
                ...movieResponse.data,
                academyAwardsYear: movieEntry.year
              });
            } catch (error) {
              console.error(error);
              ErrorLogService.error('Error fetching movie data for Academy Award winner:', movieEntry, error);
            }
          }

          const winners = { bestPicture: bestPictureWinners };
          context.commit('setAcademyAwardWinners', winners);
          // Only cache a complete-looking result; a partial fetch shouldn't be
          // baked in as the answer for the next month.
          if (bestPictureWinners.length) {
            saveSnapshot('global', 'academyAwardWinners', winners);
          }
        } catch (error) {
          console.error('Failed to get awards data:', error);
          ErrorLogService.error('Failed to get awards data:', error);
        }
      }
      // Full, all-category, all-year Academy Awards dataset — "there aren't
      // that many Academy Awards, it'd be like one JSON thing we could pull
      // down... store it locally so we can use it wherever we want to."
      // ~11k raw records (wins AND nominations, every category since the
      // 1st ceremony), same self-built film-awards-api service as above,
      // just the bare /awards endpoint with no category filter — confirmed
      // live (curl) to return the complete dataset, ~5.5MB. NOT TMDB-enriched
      // per record (unlike academyAwardWinners' Best Picture list) — that
      // would mean a per-record TMDB fetch across ~11k rows, defeating the
      // "not that big" simplicity this is explicitly meant to have.
      // Consumers needing more than the raw tmdb id (e.g. a poster) already
      // have the movie's own local entry to fall back to when it's in the
      // library, or can look it up live for the rare case it isn't.
      const allAcademyAwardsHasData = context.state.allAcademyAwards.length > 0;
      if (!allAcademyAwardsHasData) {
        // ~5.25MB. This previously kicked off the cache read and the network
        // fetch TOGETHER, so the snapshot only ever won a race to first paint
        // — the download happened on every launch anyway. Awaiting the cache
        // first means a device that already has it downloads nothing.
        const cached = await loadSnapshot('global', 'allAcademyAwards');
        if (cached && cached.length) {
          context.commit('setAllAcademyAwards', cached);
        }
      }

      if (context.state.allAcademyAwards.length === 0) {
        try {
          const response = await axios.get('https://web-production-b8145.up.railway.app/awards');
          const data = (response.data || []).map((record) => ({
            ...record,
            isWinner: ['TRUE', '1', true].includes(record.isWinner),
            isActing: ['TRUE', '1', true].includes(record.isActing)
          }));
          context.commit('setAllAcademyAwards', data);
          if (data.length) {
            saveSnapshot('global', 'allAcademyAwards', data);
          }
        } catch (error) {
          console.error('Failed to get the full Academy Awards dataset:', error);
          ErrorLogService.error('Failed to get the full Academy Awards dataset:', error);
        }
      }

      // offline-killed session: flush if already online (no-ops otherwise),
      // and always refresh the reconciliation banner state regardless of
      // connectivity.
      context.dispatch('flushPendingWrites');
      context.dispatch('refreshPendingReconciliations');
    },
    // todo: should I delete this? Nothing is calling it but it seems like something I kind of need...
    async initiateNewDatabase (context) {
      if (!context.getters.databaseTopKey) {
        return;
      }

      const newDB = {
        movieLog: {},
        settings: {
          tags: {
            "viewing-tags": { title: "default viewing tag" },
          }
        }
      }

      set(ref(db, `${context.getters.databaseTopKey}`), newDB);

      context.dispatch('initializeDB');
    },
    async setDBValue (context, dbEntry) {
      const now = Date.now();
      const timeSinceLastSave = now - context.state.lastSaveTime;
      const isSamePath = context.state.lastSavePath === dbEntry.path;

      // Simple debounce: skip if saving same path within 1 second
      if (isSamePath && timeSinceLastSave < 1000) {
        return;
      }

      await performDatabaseWrite(context, dbEntry);
    },
    // The phase-2 escape hatch ("Refresh library from server", Settings →
    // Maintenance): wipe the delta baseline and reload, so the next launch
    // is a guaranteed full download (launchPlan: 'no-meta') that rebuilds
    // snapshot + lastSync from scratch. For the invisible failure mode —
    // "this movie looks stale/missing and I don't trust it".
    async forceFullLibraryRefresh (context) {
      const topKey = context.getters.databaseTopKey;
      try {
        if (topKey) await saveSnapshot(topKey, 'deltaSyncMeta', null);
      } catch (error) {
        console.warn('forceFullLibraryRefresh: could not clear baseline:', error);
      }
      window.location.reload();
    },
    // Delta sync shadow comparison. In phase 1 it ran on every launch; since
    // phase 2/3 (2026-08-17) it runs on every FULL launch (first run, lost
    // snapshot, periodic resync, forced refresh) — the launches that still
    // have both sides to compare. Divergence is the thing this exists to
    // catch — it logs loudly (console
    // + ErrorLogService, visible in the in-app error log) and stashes a
    // report in state; agreement logs quietly. Never throws: any failure
    // here (offline probe, missing meta, first run) just means "no
    // comparison this launch."
    async runDeltaShadowCheck (context, { fresh, priorSnapshotPromise, topKey }) {
      try {
        const meta = await loadSnapshot(topKey, 'deltaSyncMeta');
        const priorSnapshot = await priorSnapshotPromise;
        const newLastSync = maxUpdatedAt(fresh);

        if (meta?.lastSync != null && priorSnapshot) {
          // startAt is inclusive, so the boundary entry is re-fetched —
          // harmless (the merge replaces it with an identical copy) and
          // safer than +1 arithmetic against equal-stamp writes.
          const [deltaSnap, tombstoneSnap] = await Promise.all([
            get(query(ref(db, `${topKey}/movieLog`), orderByChild('updatedAt'), startAt(meta.lastSync))),
            get(ref(db, `${topKey}/movieLogDeletions`))
          ]);
          const deltaEntries = deltaSnap.val() || {};
          const reconstructed = reconstructFromDelta(priorSnapshot, deltaEntries, tombstoneSnap.val() || {});
          const report = {
            ...diffLibraries(fresh, reconstructed),
            deltaEntryCount: Object.keys(deltaEntries).length,
            lastSyncUsed: meta.lastSync,
            checkedAt: Date.now()
          };
          if (report.stale.length) {
            // Self-explaining divergences: stamps on both sides, whether the
            // delta query actually returned the key, and which fields differ.
            report.staleDetail = report.stale.map((dbKey) =>
              describeStaleEntry(fresh[dbKey], reconstructed[dbKey], deltaEntries, dbKey));
          }
          context.commit('setDeltaShadowReport', report);

          if (report.identical) {
            console.info(`[delta-shadow] identical: ${report.compared} entries reconstructed from snapshot + ${report.deltaEntryCount} delta entries`);
            ErrorLogService.info?.(`[delta-shadow] identical (${report.compared} entries, ${report.deltaEntryCount} via delta)`);
          } else {
            console.warn('[delta-shadow] DIVERGENCE:', report);
            ErrorLogService.error('[delta-shadow] delta reconstruction diverged from full download:', report);
          }

          // Shadow mode existed to answer "is delta reconstruction safe to
          // switch on", and the answer was only ever visible in localStorage
          // error logs on the device that ran the check — so the decision
          // depended on somebody reading their own phone. Each reading is
          // recorded in the account now, so the question can be settled from
          // the data (scripts/delta-shadow-report.mjs).
          context.dispatch('recordDeltaShadowReading', report);
        }

        // Either way, this launch's full download is the new baseline, and
        // counts as the periodic full resync (launchPlan's lastFullSyncAt).
        if (newLastSync != null) {
          await saveSnapshot(topKey, 'deltaSyncMeta', { lastSync: newLastSync, savedAt: Date.now(), lastFullSyncAt: Date.now() });
        }
      } catch (error) {
        // Shadow mode must never affect the real load path.
        console.warn('[delta-shadow] check skipped:', error);
      }
    },
    /**
     * A compact record of one shadow check, kept in the account so the
     * phase-2 decision can be made from readings rather than recollection.
     *
     * Diagnostic and re-derivable, so it uses the plain write path rather
     * than the durable queue — losing one costs nothing.
     */
    async recordDeltaShadowReading (context, report) {
      const topKey = context.getters.databaseTopKey;
      if (!topKey || !report) return;

      try {
        const reading = {
          at: report.checkedAt || Date.now(),
          identical: Boolean(report.identical),
          compared: report.compared ?? null,
          deltaEntries: report.deltaEntryCount ?? null,
          // Counts only: the keys themselves say nothing useful later, and
          // this should stay small.
          missing: report.missing?.length || 0,
          stale: report.stale?.length || 0,
          extra: report.extra?.length || 0
        };

        const readings = context.state.settings?.deltaShadowReadings || {};
        const keys = Object.keys(readings).sort();
        const updates = { [`settings/deltaShadowReadings/${reading.at}`]: reading };

        // A rolling window: enough to see a trend, not enough to grow.
        keys.slice(0, Math.max(0, keys.length - 29)).forEach((old) => {
          updates[`settings/deltaShadowReadings/${old}`] = null;
        });

        await context.dispatch('updateDatabaseEntriesNow', updates);
      } catch (error) {
        // Diagnostics must never affect the load path.
        console.warn('[delta-shadow] could not record the reading:', error);
      }
    },
    // Re-applies every still-queued durable write for `root` ('movieLog' or
    // 'settings') to LOCAL state, oldest first. Bug report: a movie rated
    // offline "seemed to appear... but when I closed the app and reopened
    // it, the rating was gone." The IndexedDB snapshot only ever mirrors the
    // last SERVER state (saveSnapshot fires from the live listener alone),
    // so an offline relaunch — or the first server snapshot after
    // reconnecting, arriving before the flush completes — showed the library
    // WITHOUT anything rated since the last sync, even though its durable
    // queue entry was sitting right there. Replaying the queue on top closes
    // that: local state = last known server state + everything still
    // pending. Safe to re-run any time: a queue entry is removed once the
    // server confirms it, so replaying can only re-assert values the server
    // hasn't caught up to yet (a written-but-unreconciled placeholder stays
    // queued, but its queued value matches what was written — idempotent).
    async replayPendingWrites (context, root) {
      const pending = await listPendingWrites();
      pending
        .filter((entry) => entry?.dbEntry?.path && entry.dbEntry.path.split('/')[0] === root)
        .forEach((entry) => context.commit('applyDbPathLocally', entry.dbEntry));
    },
    // Recomputes state.pendingReconciliations from the pendingWriteQueue -
    // cheap, purely local (IndexedDB) read, safe to call regardless of
    // connectivity so Home.vue's "needs a match" banner reflects reality
    // even before the next successful flush.
    async refreshPendingReconciliations (context) {
      const pending = await listPendingWrites();
      context.commit('setPendingReconciliations', pending.filter((entry) => entry.type === 'placeholder' && entry.status !== 'reconciled'));
    },
    // Processes the durable offline-write queue (see pendingWriteQueue.js) in
    // order once online: attempts each entry's write, removes 'write' entries
    // on success, marks 'placeholder' entries written (kept for
    // reconciliation), and records attempts/lastError on failure without
    // aborting the rest of the pass. Triggered from App.vue's 'online' event
    // + its other iOS-reliability triggers/interval, and once from
    // initializeDB on a cold start that's already online.
    async flushPendingWrites (context) {
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      if (context.state.isFlushingPendingWrites) return;
      if (!context.getters.databaseTopKey) return;

      context.commit('setIsFlushingPendingWrites', true);
      try {
        const pending = await listPendingWrites();

        for (const entry of pending) {
          if (!entry.dbEntry) continue;
          // A 'placeholder' entry stays queued (for reconciliation tracking)
          // even after its write already succeeded once - written:true means
          // there's nothing left to (re-)attempt here, only actual
          // reconciliation (ReconcilePlaceholder.vue) removes it. Without
          // this, an unreconciled placeholder would get redundantly
          // re-written to Firebase on every single background sweep for as
          // long as it sits unreconciled.
          if (entry.type === 'placeholder' && entry.written) continue;

          try {
            await performDatabaseWrite(context, entry.dbEntry);
            if (entry.type === 'write') {
              await removePendingWrite(entry.id);
            } else {
              await updatePendingWrite(entry.id, { written: true });
            }
          } catch (error) {
            await updatePendingWrite(entry.id, { attempts: (entry.attempts || 0) + 1, lastError: String(error) });
          }
        }

        await context.dispatch('refreshPendingReconciliations');
      } finally {
        context.commit('setIsFlushingPendingWrites', false);
      }
    },
    // Bug fix (Jul 2026), superseding an earlier fix that turned out to be
    // insufficient: AddRating.js originally routed EVERY save (online or
    // not) through the offline queue + a shared, guarded flush action. A
    // live incident showed the actual bug this created - a movie rated
    // normally, while online, vanished, because navigating home right after
    // triggers another background flush pass (via initializeDB), and
    // whichever pass's isFlushingPendingWrites guard "won" the race could
    // silently skip the brand-new entry with nothing left to retry it
    // before the app was closed. An interim fix (a dedicated, guard-free
    // flushSingleEntry action) closed that specific race but kept the same
    // fundamental shape: every online save STILL depended on a queue write
    // succeeding and a follow-up action running correctly.
    //
    // This action is the actual fix: a raw, direct write with NO queue
    // involvement at all - no dependency on IndexedDB succeeding, no shared
    // state, nothing another concurrent call could interfere with. When
    // online (the common case), AddRating.js/ReconcilePlaceholder.vue now
    // await THIS directly and only fall back to the durable queue if it
    // throws (a genuine failure/timeout) or the device is offline to begin
    // with - restoring the same "the write is confirmed before we tell the
    // user it succeeded" guarantee the app had before the offline-rating
    // feature existed, for the case that actually broke.
    async writeDatabaseEntryNow (context, dbEntry) {
      await performDatabaseWrite(context, dbEntry);
      // A brand-new rating comes through HERE, not writeDurably — AddRating
      // owns its own durability machinery — so the staleness fix has to hook
      // both. Double-firing is fine: scheduleSocialPublish is debounced.
      if (typeof dbEntry?.path === 'string' && dbEntry.path.startsWith('movieLog')) {
        context.dispatch('scheduleSocialPublish');
      }
    },
    // General-purpose "offline-safe write" for the features that don't need
    // AddRating.js's placeholder/reconciliation machinery, just its core
    // durability guarantee (bug report, Jul 2026: "updates to the stickiness
    // rating and the tiebreaker values and any [Personal Awards] changes...
    // should be able to be done offline and then push to the database when
    // I'm back online"). Same overall shape as AddRating.js's write path -
    // optimistic local commit, THEN durably enqueue BEFORE attempting -
    // generalized via applyDbPathLocally so it isn't limited to movieLog/*
    // paths the way setMovieLogEntry is.
    //
    // Deliberately does NOT re-throw on a failed online attempt (unlike
    // AddRating.js's non-placeholder path) - none of these three callers had
    // dedicated per-write error UI before this, and their existing
    // try/catch+console.error/ErrorLogService handling is the right level of
    // visibility to preserve. The durable queue entry is the real safety net
    // either way; a failed attempt just means the background flush
    // (App.vue's triggers / initializeDB) retries it, same as offline.
    async writeDurably (context, dbEntry) {
      context.commit('applyDbPathLocally', dbEntry);
      context.commit('trackInFlightWrite', dbEntry);
      // Any change to the library makes the published profile stale. Hooked
      // here rather than in a screen because a rating can be saved from
      // several places, and Home may not even be mounted.
      if (typeof dbEntry?.path === 'string' && dbEntry.path.startsWith('movieLog')) {
        context.dispatch('scheduleSocialPublish');
      }

      // Bug report ("I get the tie break message again just for a second or
      // two"): this used to `await enqueueWrite(...)` BEFORE issuing the
      // network write, which meant every Firebase set() sat behind an
      // IndexedDB open + full-queue scan + put. With several writeDurably
      // calls back to back (a tiebreak fires 3+), an early one could reach
      // the server and bounce back an onValue snapshot while a later one
      // hadn't even been sent yet. Kicking both off together keeps the same
      // durability (the IndexedDB record still lands regardless of what
      // happens to the network write) without the network write inheriting
      // IndexedDB's latency. trackInFlightWrite above covers the remaining
      // in-flight window.
      const queuedPromise = enqueueWrite({ type: 'write', dbEntry });

      try {
        // Offline: nothing to attempt, just make sure it's durably queued.
        if (!context.state.isOnline) {
          await queuedPromise;
          return;
        }

        await context.dispatch('writeDatabaseEntryNow', dbEntry);
        const queuedRecord = await queuedPromise;
        if (queuedRecord) await removePendingWrite(queuedRecord.id);
      } catch (error) {
        // Already durably queued regardless of this failure.
        await queuedPromise.catch(() => null);
        console.error('writeDurably: direct write failed, will retry via the background queue:', dbEntry.path, error);
      } finally {
        // Always untrack, including the offline path — otherwise
        // inFlightWrites would grow unboundedly across an offline session.
        // The local value still stands on its own (applyDbPathLocally
        // committed it) and the durable queue owns getting it to the server.
        context.commit('untrackInFlightWrite', dbEntry.path);
      }
    },
    // Atomic multi-path write via Firebase's update() (not set()) - `updates`
    // is a flat object whose keys are full paths relative to the account
    // root, e.g. { 'movieLog/key1/movie/budget': 100, 'movieLog/key2/movie/revenue': 200 }.
    // Lets a caller patch many different movies' individual fields in ONE
    // network round trip / ONE onValue listener refire, instead of one write
    // per field per movie - the remote-write half of the same batching fix
    // setMovieLogEntries is the local half of (see its own comment). Used
    // for bulk background patches (e.g. backfillBoxOffice.js) where
    // minimizing the NUMBER of separate writes matters far more than the
    // single-entry durability guarantees a user-authored rating needs.
    async updateDatabaseEntriesNow (context, updates) {
      // Same change tracking as performDatabaseWrite, but a batch can touch
      // many movies at once so each one gets its own updatedAt. See
      // stampUpdatesForBatch for the overlapping-path trap it avoids.
      const cleanedUpdates = removeNaNAndUndefined(stampUpdatesForBatch(updates, serverTimestamp()));
      await withTimeout(
        update(ref(db, context.getters.databaseTopKey), cleanedUpdates),
        DATABASE_WRITE_TIMEOUT_MS,
        `Database batch update timed out after ${DATABASE_WRITE_TIMEOUT_MS}ms`
      );
    },
    // ------------------------------------------------------------------
    // Film Club Interchange. Publishing lets a friend on another app
    // subscribe to this library; subscribing pulls THEIR feed and turns it
    // into the same profile shape Film Club renders, so a Movie Log friend
    // is indistinguishable from a Cinema Roll one. See interchange.js.
    async ensureClubFeedKey (context) {
      const existing = context.state.settings?.clubFeedKey;
      if (typeof existing === 'string' && existing.length >= 16) return existing;
      const bytes = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      const key = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      await context.dispatch('writeDurably', { path: 'settings/clubFeedKey', value: key });
      return key;
    },
    async publishClubFeed (context) {
      const me = context.state.databaseTopKey;
      const secret = context.state.settings?.clubFeedKey;
      if (!me || !secret || !context.state.dbLoaded) return;
      const entries = context.getters.allMediaAsArray;
      if (!entries.length) return;
      const feed = toInterchange(entries, getRating, {
        name: context.getters.socialSettings.displayName || 'A Cinema Roll user'
      });
      await set(ref(db, `clubFeed/${me}/${secret}`), feed);
    },
    // Cross-app discovery is its own opt-in: this row is PUBLICLY readable,
    // which is more exposure than the in-app directory (auth required), so
    // it is never published without an explicit choice.
    async setCrossAppDiscovery (context, enabled) {
      await context.dispatch('writeDurably', { path: 'settings/crossAppDiscovery', value: Boolean(enabled) });
      if (enabled) {
        await context.dispatch('publishDirectoryEntry');
      } else {
        const me = context.state.databaseTopKey;
        if (me) await set(ref(db, `clubDirectory/${me}`), null);
      }
    },
    async publishDirectoryEntry (context) {
      const me = context.state.databaseTopKey;
      if (!me || isQaAccountKey(me) || !context.state.settings?.crossAppDiscovery) return;
      const invite = await context.dispatch('createClubInvite');
      if (!invite) return;
      const entry = buildDirectoryEntry({
        handle: context.state.settings?.clubHandle || me,
        name: context.getters.socialSettings.displayName,
        inboxUrl: invite.inboxUrl
      });
      if (entry) await set(ref(db, `clubDirectory/${me}`), entry);
    },
    // Everyone discoverable on the apps we federate with.
    async fetchFederatedDirectory (context) {
      context.commit('setFederatedDirectoryLoading', true);
      try {
        const lists = await Promise.all(FEDERATED_APPS.map(async (app) => {
          try {
            const response = await fetch(app.directoryUrl, { cache: 'no-store' });
            if (!response.ok) throw new Error(`directory responded ${response.status}`);
            return normalizeDirectory(await response.json(), { app: app.id });
          } catch (error) {
            console.warn(`[film-club] ${app.name} directory unavailable:`, error.message);
            return [];
          }
        }));
        context.commit('setFederatedDirectory', lists.flat());
      } finally {
        context.commit('setFederatedDirectoryLoading', false);
      }
    },
    // Add someone straight from the directory — no links, no pasting.
    async requestFriendFromDirectory (context, entry) {
      if (!entry?.inboxUrl) return { ok: false, error: 'That person has no inbox.' };
      const invite = await context.dispatch('createClubInvite');
      if (!invite) return { ok: false, error: 'Could not create your own feed.' };
      try {
        const response = await fetch(entry.inboxUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildConnectRequest({
            name: invite.name,
            feedUrl: invite.feedUrl,
            replyInboxUrl: invite.inboxUrl
          }))
        });
        if (!response.ok) throw new Error(`inbox responded ${response.status}`);
        // Remember we asked, so the directory can hide them.
        await context.dispatch('writeDurably', {
          path: `settings/clubRequestsSent/${entry.handle}`,
          value: { name: entry.name, app: entry.app, inboxUrl: entry.inboxUrl, at: Date.now() }
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: `Could not reach them: ${error.message}` };
      }
    },
    async ensureClubInviteCode (context) {
      const existing = context.state.settings?.clubInviteCode;
      if (typeof existing === 'string' && existing.length >= 8) return existing;
      const bytes = new Uint8Array(8);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      const code = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      await context.dispatch('writeDurably', { path: 'settings/clubInviteCode', value: code });
      return code;
    },
    // Everything someone on another app needs: subscribe to me here, ask to
    // be added there. Creates the feed and invite code on first use.
    async createClubInvite (context) {
      const accountKey = context.state.databaseTopKey;
      if (!accountKey) return null;
      await context.dispatch('ensureClubFeedKey');
      await context.dispatch('publishClubFeed');
      const inviteCode = await context.dispatch('ensureClubInviteCode');
      return buildInvite({
        accountKey,
        inviteCode,
        feedUrl: `${DATABASE_URL}/clubFeed/${accountKey}/${context.state.settings?.clubFeedKey}.json`,
        name: context.getters.socialSettings.displayName,
        databaseUrl: DATABASE_URL
      });
    },
    watchClubInbox (context) {
      const me = context.state.databaseTopKey;
      const code = context.state.settings?.clubInviteCode;
      if (!me || !code) return;
      onValue(ref(db, `clubInbox/${me}/${code}`), (snapshot) => {
        context.commit('setClubInboxRequests', snapshot.val());
      }, (error) => console.warn('[film-club] inbox listener:', error.message));
    },
    // Accepting subscribes to them and, when they told us where to reply,
    // posts our own feed back so they can subscribe to us without a second
    // round of copy-and-paste.
    async acceptClubRequest (context, request) {
      if (!request?.feedUrl) return;
      await context.dispatch('addExternalFriend', { name: request.name, feedUrl: request.feedUrl });
      if (request.replyInboxUrl) {
        const invite = await context.dispatch('createClubInvite');
        if (invite) {
          try {
            await fetch(request.replyInboxUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(buildConnectRequest({
                name: invite.name,
                feedUrl: invite.feedUrl,
                replyInboxUrl: invite.inboxUrl
              }))
            });
          } catch (error) {
            console.warn('[film-club] could not reply to invite:', error.message);
          }
        }
      }
      await context.dispatch('dismissClubRequest', request.id);
    },
    async dismissClubRequest (context, requestId) {
      const me = context.state.databaseTopKey;
      const code = context.state.settings?.clubInviteCode;
      if (!me || !code || !requestId) return;
      await set(ref(db, `clubInbox/${me}/${code}/${requestId}`), null);
    },
    // Ask someone on another app to add us, using the invite they sent.
    async sendClubRequest (context, rawInvite) {
      const invite = parseInvite(rawInvite);
      if (!invite) return { ok: false, error: 'That invite could not be read.' };

      await context.dispatch('addExternalFriend', { name: invite.name, feedUrl: invite.feedUrl });

      if (!invite.inboxUrl) {
        return { ok: true, replied: false, note: 'Subscribed. They will need your link to see you.' };
      }
      const mine = await context.dispatch('createClubInvite');
      try {
        await fetch(invite.inboxUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(buildConnectRequest({
            name: mine.name,
            feedUrl: mine.feedUrl,
            replyInboxUrl: mine.inboxUrl
          }))
        });
        return { ok: true, replied: true };
      } catch (error) {
        return { ok: true, replied: false, note: `Subscribed, but the request didn't send: ${error.message}` };
      }
    },
    async addExternalFriend (context, { name, feedUrl }) {
      const clean = String(feedUrl || '').trim();
      if (!clean || !/^https?:\/\//i.test(clean)) return null;

      // Already in the club? Accepting a connect request and accepting an
      // invite both land here, and each used to mint a fresh id — which is
      // how one friend's feed ended up subscribed twice and every one of
      // his movies appeared twice (report -P-H-twP5kUjwuEanKMm). Re-adding
      // now just refreshes the friend you already have.
      const existingId = findSubscription(context.state.settings?.externalFriends, clean);
      if (existingId) {
        await context.dispatch('syncExternalFriends');
        return existingId;
      }

      const id = `ext-${Date.now().toString(36)}`;
      await context.dispatch('writeDurably', {
        path: `settings/externalFriends/${id}`,
        value: { name: String(name || '').trim() || 'A friend', feedUrl: clean, addedAt: Date.now() }
      });
      await context.dispatch('syncExternalFriends');
      return id;
    },
    async removeExternalFriend (context, id) {
      if (!id) return;
      await context.dispatch('writeDurably', { path: `settings/externalFriends/${id}`, value: null });
      context.commit('setExternalFriendProfile', { id, profile: null });
    },
    // Load whatever club data is still missing — safe to dispatch from
    // anything that renders club data, any number of times. The mount-time
    // fetches (Home, Film Club, Watchlist) read settings/externalFriends and
    // the friend edges, and on a cold start neither has necessarily arrived
    // yet, so a session could run to its end with every pill blank (report
    // -P0EQt6w7iKdJziMXHTi: three Movie Log friends had rated the movie and
    // none showed). FriendsWhoSaw watches club membership and dispatches
    // this as it lands; clubFetchesNeeded (social.js) keeps the re-runs from
    // re-fetching anything already here.
    //
    // `maxAgeMs` (2026-09-06): a surface that is about to SHOW a friend's
    // rating passes how old a copy it will tolerate. Without it only a
    // missing profile is fetched, and an app open since morning shows the
    // morning's snapshot — which is how a friend-log push steered Matt's
    // running app to the film and the pills had nothing to say.
    ensureClubData (context, { maxAgeMs = Infinity } = {}) {
      context.dispatch('attachSocialListeners');
      const needed = clubFetchesNeeded({
        friendKeys: context.getters.socialFriendKeys,
        nativeProfiles: context.state.socialFriendProfiles,
        externalFriends: context.state.settings?.externalFriends,
        externalProfiles: context.state.externalFriendProfiles,
        fetchedAt: context.state.socialProfilesFetchedAt,
        maxAgeMs
      });
      if (needed.native) context.dispatch('fetchFriendProfiles');
      if (needed.external) context.dispatch('syncExternalFriends');
    },
    // Fetch each subscribed feed and translate it. Failures are per-friend
    // and non-fatal — one unreachable feed must not blank the club.
    async syncExternalFriends (context) {
      const friends = context.state.settings?.externalFriends || {};
      if (Object.keys(friends).length) context.commit('setSocialProfilesFetchedAt', Date.now());
      await Promise.all(Object.entries(friends).map(async ([id, friend]) => {
        if (!friend?.feedUrl) return;
        try {
          const response = await fetch(friend.feedUrl, { cache: 'no-store' });
          if (!response.ok) throw new Error(`feed responded ${response.status}`);
          const profile = profileFromFeed(await response.json(), { fallbackName: friend.name });
          if (!profile) throw new Error('unrecognised feed format');
          context.commit('setExternalFriendProfile', { id, profile });
        } catch (error) {
          console.warn('[film-club] could not sync external friend', friend.name, error.message);
          context.commit('setExternalFriendError', { id, message: error.message });
        }
      }));
    },

    // ------------------------------------------------------------------
    // Watchlist learning: which recommendation sources actually earn
    // watches. Suggestions are recorded once; when a recorded movie later
    // appears in the library, its source gets the credit. See
    // recommendationStats.js.
    async recordWatchlistSuggestions (context, shownBySource) {
      const pending = context.state.settings?.watchlistLearning?.pending || {};
      const updates = pendingUpdates(pending, shownBySource);
      const entries = Object.entries(updates);
      if (!entries.length) return;

      await Promise.all(entries.map(([tmdbId, record]) =>
        context.dispatch('writeDurably', {
          path: `settings/watchlistLearning/pending/${tmdbId}`,
          value: record
        })
      ));
      // Count what was offered, so a source's hit RATE has a denominator.
      const counts = {};
      entries.forEach(([, record]) => { counts[record.source] = (counts[record.source] || 0) + 1; });
      await Promise.all(Object.entries(counts).map(([source, added]) => {
        const current = Number(context.state.settings?.watchlistLearning?.sources?.[source]?.suggested) || 0;
        return context.dispatch('writeDurably', {
          path: `settings/watchlistLearning/sources/${source}/suggested`,
          value: current + added
        });
      }));
    },
    // Credit sources whose suggestions have since been rated, and forget
    // suggestions that went stale. Safe to run on every watchlist visit.
    async reconcileWatchlistLearning (context, ratedTmdbIds) {
      const learning = context.state.settings?.watchlistLearning;
      if (!learning?.pending) return;
      const { hits, resolved, expired } = reconcilePending(learning.pending, ratedTmdbIds);

      await Promise.all(Object.entries(hits).map(([source, count]) => {
        const current = Number(learning.sources?.[source]?.hits) || 0;
        return context.dispatch('writeDurably', {
          path: `settings/watchlistLearning/sources/${source}/hits`,
          value: current + count
        });
      }));
      await Promise.all([...resolved, ...expired].map((tmdbId) =>
        context.dispatch('writeDurably', {
          path: `settings/watchlistLearning/pending/${tmdbId}`,
          value: null
        })
      ));
    },

    // ------------------------------------------------------------------
    // Magic Mirror feed. The mirror used to read the whole movieLog over
    // unauthenticated REST; the 2026-08-14 lockdown ended that. Rather than
    // reopening the library, publish a few KB of exactly what it renders to
    // mirrorFeed/<userKey>/<secret>, which the rules make world-readable at
    // the secret level only. No credentials live on the mirror.
    // The secret must never live in Cinema Roll's public bundle, so it is
    // generated per-user at runtime and stored with the user's settings.
    async ensureMirrorFeedKey (context) {
      const existing = context.state.settings?.mirrorFeedKey;
      if (typeof existing === 'string' && existing.length >= 16) return existing;
      const bytes = new Uint8Array(16);
      (window.crypto || window.msCrypto).getRandomValues(bytes);
      const key = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
      await context.dispatch('writeDurably', { path: 'settings/mirrorFeedKey', value: key });
      return key;
    },
    async publishMirrorFeed (context) {
      const me = context.state.databaseTopKey;
      const secret = context.state.settings?.mirrorFeedKey;
      if (!me || !secret || !context.state.dbLoaded) return;
      const entries = context.getters.allMediaAsArray;
      if (!entries.length) return;
      const feed = buildMirrorFeed(entries, getRating);
      await set(ref(db, `mirrorFeed/${me}/${secret}`), feed);
    },

    // ------------------------------------------------------------------
    // Social layer. All writes land OUTSIDE the user's private branch, under
    // social/ — see src/assets/javascript/social.js and the database rules.
    attachSocialListeners (context) {
      const me = context.getters.socialUserKey;
      if (!me || context.state.socialAttachedFor === me) return;
      context.commit('setSocialAttachedFor', me);
      onValue(ref(db, `social/requests/${me}`), (snapshot) => {
        context.commit('setSocialRequests', snapshot.val());
      }, (error) => console.error('social requests listener cancelled:', error));
      onValue(ref(db, 'social/friends'), (snapshot) => {
        context.commit('setSocialEdges', snapshot.val());
        // Profiles feed the Film Club badge on Home, so they load wherever
        // the listeners attach — not just on the Film Club screen.
        context.dispatch('fetchFriendProfiles');
      }, (error) => console.error('social friends listener cancelled:', error));
    },
    // Publish (or refresh) my public profile + directory row. Safe to call
    // liberally — it no-ops unless social is enabled and the library is in.
    async publishSocialProfile (context) {
      const me = context.getters.socialUserKey;
      const social = context.getters.socialSettings;
      if (!me || isQaAccountKey(me) || !social.enabled || !context.state.settingsLoaded) return;
      const entries = context.getters.allMediaAsArray;
      if (!entries.length) return;
      const profile = buildSocialProfile(entries, getRating, {
        name: social.displayName || 'A Cinema Roll user',
        shareRatings: Boolean(social.shareRatings),
        shareCriteria: Boolean(social.shareRatings && social.shareCriteria)
      });
      await Promise.all([
        set(ref(db, `social/profiles/${me}`), profile),
        set(ref(db, `social/directory/${me}`), { name: profile.name })
      ]);
    },
    // ---- Movie Hat ----------------------------------------------------
    //
    // Movie Hat is a separate app with its own database and stays that way
    // (Matt, 2026-08-16). These actions are the only place Cinema Roll
    // touches it, and they all go through assets/javascript/movieHat.js.

    /**
     * The one-off setup step: read every hat and keep the ones this account
     * is a member of. Deliberately not run on load — it reads the whole
     * database, which is megabytes.
     */
    async findMovieHats (context) {
      // Prefer the Movie Hat account when connected: the hats are keyed by
      // whichever Google address owns them, which needn't be the address you
      // use for Cinema Roll.
      const email = context.state.movieHatEmail || context.state.userEmail;
      if (!email) return [];

      // The index first — the only route that survives the lockdown. The
      // whole-database scan is the fallback for as long as it works, so
      // linking hats keeps working before the index is backfilled.
      let mine = await fetchMyHats(email);

      if (!mine.length) {
        try {
          mine = hatsForMember(await fetchAllHats(), email);
        } catch {
          // Refused: the database is closed and the index is the only way.
          mine = [];
        }
      }

      context.commit('setAvailableMovieHats', mine);
      return mine;
    },

    /**
     * The one popup — or a minted token, which is the only way an automated
     * browser can get a Movie Hat session at all now the rules are on.
     */
    async connectMovieHat (context, token = null) {
      const user = token ? await signIntoMovieHatWithToken(token) : await signIntoMovieHat();
      context.commit('setMovieHatUser', user);
      // Whichever account just signed in is the one whose hats to look for.
      if (user?.email) await context.dispatch('findMovieHats');
      return user;
    },

    async disconnectMovieHat (context) {
      await signOutOfMovieHat();
      context.commit('setMovieHatUser', null);
      context.commit('setAvailableMovieHats', []);
    },

    /** Keeps the store in step with the Movie Hat session across reloads. */
    watchMovieHatAuth (context) {
      observeMovieHatAuth((user) => context.commit('setMovieHatUser', user));
    },

    async linkMovieHats (context, hats) {
      await context.dispatch('writeDurably', {
        path: 'settings/movieHat/hats',
        value: (hats || []).map(({ title, dbKey }) => ({ title, dbKey }))
      });
    },

    /**
     * Send one or many movies to a hat. Returns what happened per movie so
     * the screen can say "3 added, 1 was already in there" — Matt asked for
     * exactly that rather than Cinema Roll tracking hat contents itself.
     */
    // `note` is plain-language provenance shown on the hat movie — "not sure
    // you've noticed but there's a way to put a note on any movie you [pull]
    // out of the hat so we have to make sure that's possible from Cinema Roll
    // as well" (2026-08-17). It says WHY the movie went in; `addedBy` already
    // says who put it there.
    async addToMovieHat (context, { title, dbKey = null, entries = [], note = null }) {
      const hat = await fetchHat(title, dbKey);
      if (!hat) throw new Error(`Couldn't find a hat called "${title}"`);

      const addedBy = context.getters.socialSettings?.displayName || context.state.userEmail || 'Cinema Roll';
      const added = [];
      const skipped = [];
      // Tracks within this batch too, so the same movie twice in one list
      // doesn't get added twice.
      const seen = [...hat.movies];

      for (const entry of entries) {
        const payload = toHatMovie(entry, { addedBy, note });
        if (!payload) continue;

        if (alreadyInHat(seen, payload.id)) {
          skipped.push(payload);
          continue;
        }

        await addMovieToHat(hat.title, hat.dbKey, payload);
        seen.push(payload);
        added.push(payload);
      }

      // Stamp it so linkedMovieHats can order by recent use. Derived state,
      // not user-authored, so setDBValue is the right write here.
      //
      // The storage key comes from the RAW settings, never from the getter's
      // index: the getter is now sorted by recency, so its positions stop
      // matching the stored ones the moment any hat is used. Firebase also
      // hands a sparse array back as an object map, so the key can be either.
      if (added.length) {
        const stored = context.state.settings?.movieHat?.hats;
        const key = Array.isArray(stored)
          ? stored.findIndex((linked) => linked?.title === hat.title)
          : Object.keys(stored || {}).find((k) => stored[k]?.title === hat.title);

        if (key !== undefined && key !== -1 && key !== null) {
          context.dispatch('setDBValue', {
            path: `settings/movieHat/hats/${key}/lastUsedAt`,
            value: Date.now()
          });
        }
      }

      return { added, skipped, hat: hat.title };
    },

    /**
     * Which movies are already waiting in a linked hat.
     *
     * One request per linked hat, cached for `maxAgeMs` — a hat's contents
     * change rarely and every read is billed egress on Movie Hat's
     * database, so this deliberately does NOT refetch per screen. A hat
     * that fails to load simply contributes nothing: the button then shows
     * when it might not need to, and sending still reports "already in
     * there", which is the safe way round.
     */
    async ensureMovieHatContents (context, { maxAgeMs = 10 * 60 * 1000, force = false } = {}) {
      const hats = context.getters.linkedMovieHats;

      if (!hats.length) {
        context.commit('setMovieHatContents', { ids: {}, at: Date.now() });
        return;
      }

      const age = Date.now() - (context.state.movieHatContentsAt || 0);
      if (!force && context.state.movieHatContentsAt && age < maxAgeMs) return;

      const ids = {};
      let accessError = null;
      await Promise.all(hats.map(async (hat) => {
        try {
          // Only the movies: this used to call fetchHat, which downloads the
          // whole hat — history included — for six hats every ten minutes,
          // to read nothing but the ids.
          const movies = await fetchHatMovies(hat.title, hat.dbKey);
          movies.forEach((movie) => {
            if (movie?.id != null) ids[movie.id] = true;
          });
        } catch (error) {
          // One refusal explains all of them (they share a session), so the
          // first is kept rather than the last-to-land of six racing reads.
          if (isMovieHatAccessError(error)) {
            accessError = accessError || { reason: error.reason, email: error.email };
          }
          console.warn('[movie-hat] could not read hat contents', hat.title, error.message);
        }
      }));

      context.commit('setMovieHatAccessError', accessError);
      context.commit('setMovieHatContents', { ids, at: Date.now() });
    },

    /**
     * A card's worth of each linked hat: how many are waiting and what came
     * out last. One request per hat, so it is called when the section
     * renders rather than on every page load.
     */
    async loadMovieHatSummaries (context) {
      const hats = context.getters.linkedMovieHats;
      let accessError = null;
      const summaries = await Promise.all(hats.map(async (hat) => {
        try {
          const loaded = await fetchHat(hat.title, hat.dbKey);
          if (!loaded) return { ...hat, error: true };

          // History is stored oldest-first; the newest draw is the one with
          // the latest dateDrawn rather than simply the last key.
          const lastDrawn = [...loaded.history]
            .sort((a, b) => (b?.dateDrawn || 0) - (a?.dateDrawn || 0))[0] || null;

          // The whole history, not just the newest: "I'd rather just see the
          // whole history from that hat because that's all available"
          // (2026-08-17). Newest first, since that's the reading order.
          const history = [...loaded.history]
            .filter(Boolean)
            .sort((a, b) => (b?.dateDrawn || 0) - (a?.dateDrawn || 0));

          return {
            title: loaded.title,
            dbKey: loaded.dbKey,
            waiting: loaded.movies.length,
            lastDrawn,
            history
          };
        } catch (error) {
          if (isMovieHatAccessError(error)) {
            accessError = accessError || { reason: error.reason, email: error.email };
          }
          return { ...hat, error: true };
        }
      }));

      context.commit('setMovieHatAccessError', accessError);
      context.commit('setMovieHatSummaries', summaries);
      return summaries;
    },

    /**
     * Draw, for real: the movie leaves the hat and lands in its history,
     * exactly as it would in Movie Hat itself. Deliberately does NOT lead
     * into rating — "that's dumb. I'll have to watch the movie first."
     */
    async drawFromMovieHat (context, { title, dbKey = null }) {
      const hat = await fetchHat(title, dbKey);
      if (!hat) throw new Error(`Couldn't find a hat called "${title}"`);
      if (!hat.movies.length) return { movie: null, hat: hat.title, remaining: 0 };

      const movie = pickFromHat(hat.movies);
      await commitDraw(hat.title, hat.dbKey, movie);

      return { movie, hat: hat.title, remaining: hat.movies.length - 1 };
    },

    // Republish shortly after the library changes.
    //
    // The only trigger used to be a watcher on Home that published at most
    // once every SIX HOURS, so a friend could rate something and have it not
    // reach anyone until that window rolled over — which is exactly what Matt
    // saw (2026-08-16): "I happen to know that Natalie watched a movie today
    // and rated it, and yet the most recent movie I see is from yesterday."
    //
    // The delay is a coalescing window, not a throttle: rating a batch of ten
    // movies should publish the whole profile once, not ten times, and the
    // profile is a full document (every rated title) rather than a delta.
    // Readers already re-fetch on every visit, so once it is published it is
    // seen immediately.
    // A setTimeout does NOT survive an installed PWA being backgrounded, and
    // that is the normal way this app is left — so the coalescing window above
    // was also a window in which the publish could be lost outright. Seth rated
    // Tenet at 5:21:10pm on 2026-08-30 and closed the app; the push reached
    // Matt's phone immediately, his profile snapshot was never rewritten, and
    // the Film Club (which reads only that snapshot) had no such film for the
    // six hours until Home's backstop came round. A notification for something
    // the club cannot show is worse than a slightly later notification.
    //
    // Two callers, deliberately different:
    //   - publishSocialProfileNow: "this must be visible now" (a new viewing
    //     whose push has already gone out). Always publishes.
    //   - flushSocialPublish: "we're about to be suspended" (pagehide /
    //     visibilitychange). Publishes only if something is actually pending,
    //     so backgrounding the app doesn't write the profile on every tab
    //     switch.
    scheduleSocialPublish (context, { delay = 20000 } = {}) {
      if (!context.getters.socialSettings?.enabled) return;
      if (socialPublishTimer) clearTimeout(socialPublishTimer);
      socialPublishTimer = setTimeout(() => {
        socialPublishTimer = null;
        context.dispatch('publishSocialProfile');
        stampSocialPublish();
      }, delay);
    },
    publishSocialProfileNow (context) {
      if (socialPublishTimer) clearTimeout(socialPublishTimer);
      socialPublishTimer = null;
      // Same guard scheduleSocialPublish uses. Without it a call made while
      // sharing is off would stamp a publish that publishSocialProfile then
      // refuses to make, and the stamp is what Home's backstop trusts.
      if (!context.getters.socialSettings?.enabled) return Promise.resolve();
      stampSocialPublish();
      return context.dispatch('publishSocialProfile');
    },
    flushSocialPublish (context) {
      if (!socialPublishTimer) return Promise.resolve();
      return context.dispatch('publishSocialProfileNow');
    },
    async unpublishSocialProfile (context) {
      const me = context.getters.socialUserKey;
      if (!me) return;
      await Promise.all([
        set(ref(db, `social/profiles/${me}`), null),
        set(ref(db, `social/directory/${me}`), null)
      ]);
    },
    async fetchSocialDirectory (context) {
      const snapshot = await get(ref(db, 'social/directory'));
      context.commit('setSocialDirectory', snapshot.val());
    },
    // ---- Push notifications ------------------------------------------
    //
    // Everything lives under `{topKey}/push/` — the owner's own subtree, so
    // the existing per-account rules already cover it (no rules change, no
    // supervised rules deploy). The Lambda reads it with admin credentials.
    async loadPushState (context) {
      const root = context.getters.databaseTopKey;
      if (!root) return;
      const [prefsSnap, subsSnap] = await Promise.all([
        get(ref(db, `${root}/push/prefs`)),
        get(ref(db, `${root}/push/subscriptions`))
      ]);
      context.commit('setPushPrefs', prefsSnap.val());
      context.commit('setPushSubscribed', subsSnap.exists());
    },
    async savePushSubscription (context, record) {
      const root = context.getters.databaseTopKey;
      if (!root || !record?.id) return;
      // update(), not set(): the self-heal refresh on every app open must
      // not clobber createdAt on an existing row.
      const { createdAt, ...refreshable } = record;
      const existing = await get(ref(db, `${root}/push/subscriptions/${record.id}`));
      await update(ref(db, `${root}/push/subscriptions/${record.id}`),
        existing.exists() ? refreshable : record);
      context.commit('setPushSubscribed', true);
      // First subscription also plants full default prefs so the settings
      // UI and the Lambda read the same explicit values.
      if (!context.state.pushPrefs) {
        await context.dispatch('savePushPrefs', pushPrefsWithDefaults(null));
      }
      context.dispatch('publishPushDigest');
    },
    async removePushSubscription (context, id) {
      const root = context.getters.databaseTopKey;
      if (!root || !id) return;
      await set(ref(db, `${root}/push/subscriptions/${id}`), null);
      const remaining = await get(ref(db, `${root}/push/subscriptions`));
      context.commit('setPushSubscribed', remaining.exists());
    },
    async savePushPrefs (context, partial) {
      const root = context.getters.databaseTopKey;
      if (!root) return;
      const merged = { ...pushPrefsWithDefaults(context.state.pushPrefs), ...partial };
      await update(ref(db, `${root}/push/prefs`), merged);
      context.commit('setPushPrefs', merged);
    },
    // Publish the digest the scheduled Lambda reads (see pushDigest.js for
    // the client-computes/server-sends rule). Safe to call liberally: no-ops
    // without a subscribed device or before the library has loaded.
    async publishPushDigest (context) {
      const root = context.getters.databaseTopKey;
      if (!root || !context.state.pushSubscribed) return;
      if (!context.state.dbLoaded || !context.state.settingsLoaded) return;
      const digest = buildPushDigest({
        entries: context.getters.allMediaAsArray,
        settings: context.state.settings || {},
        getRating
      });
      try {
        await set(ref(db, `${root}/push/digest`), digest);
      } catch (error) {
        console.error('Failed to publish push digest:', error);
      }
    },
    async sendFriendRequest (context, toKey) {
      const me = context.getters.socialUserKey;
      if (!me || !toKey || toKey === me) return;
      // Pre-commit my half of the friendship; theirs is created when they
      // accept. One dangling edge grants nothing.
      await set(ref(db, `social/friends/${me}/${toKey}`), true);
      await set(ref(db, `social/requests/${toKey}/${me}`), {
        name: context.getters.socialSettings.displayName || 'A Cinema Roll user',
        at: Date.now()
      });
    },
    async cancelFriendRequest (context, toKey) {
      const me = context.getters.socialUserKey;
      if (!me || !toKey) return;
      await Promise.all([
        set(ref(db, `social/friends/${me}/${toKey}`), null),
        set(ref(db, `social/requests/${toKey}/${me}`), null)
      ]);
    },
    async acceptFriendRequest (context, fromKey) {
      const me = context.getters.socialUserKey;
      if (!me || !fromKey) return;
      await set(ref(db, `social/friends/${me}/${fromKey}`), true);
      await set(ref(db, `social/requests/${me}/${fromKey}`), null);
      context.dispatch('fetchFriendProfiles');
    },
    async declineFriendRequest (context, fromKey) {
      const me = context.getters.socialUserKey;
      if (!me || !fromKey) return;
      await set(ref(db, `social/requests/${me}/${fromKey}`), null);
    },
    async removeFriend (context, friendKey) {
      const me = context.getters.socialUserKey;
      if (!me || !friendKey) return;
      await set(ref(db, `social/friends/${me}/${friendKey}`), null);
    },
    async fetchFriendProfiles (context) {
      const keys = context.getters.socialFriendKeys;
      // Stamped at the START so a second caller in the same moment (the
      // edges listener and a detail page's own ensure, on a cold start) sees
      // a fresh fetch rather than a stale one.
      if (keys.length) context.commit('setSocialProfilesFetchedAt', Date.now());
      await Promise.all(keys.map(async (key) => {
        try {
          const snapshot = await get(ref(db, `social/profiles/${key}`));
          context.commit('setSocialFriendProfile', { key, profile: snapshot.val() });
        } catch (error) {
          // A friend who hasn't published yet (or a permission race right
          // after acceptance) is expected — leave their profile absent.
          console.warn('could not fetch friend profile', key, error?.code || error);
        }
      }));
    },
  },
  modules: {
  }
})
