// Client side of push notifications (Matt, 2026-08-27). Three jobs:
//
//   1. Can THIS device receive pushes at all, and is it allowed yet?
//      On iOS the Push API only exists inside a Home-Screen-installed app —
//      a Safari tab reports "unsupported" and the settings UI shows an
//      install hint instead of a broken toggle.
//   2. Subscribe/unsubscribe this device (must run inside a user tap —
//      requestPermission() outside a gesture silently fails on iOS).
//      Subscriptions persist under `{topKey}/push/subscriptions/{id}` via
//      store actions; the id is a hash of the endpoint so re-subscribing
//      the same device updates in place instead of accumulating.
//   3. Talk to the push Lambda (aws-lambda/push-notify.js) for the
//      client-initiated sends: the friend-log fan-out, friend requests, and
//      the settings screen's test notification. Same authenticated-post shape as
//      utils/aiRequest.js — a Firebase ID token is the gate, CORS is not.

import axios from 'axios';
import { getAuth } from 'firebase/auth';

export function pushApiConfigured () {
  return Boolean(process.env.VUE_APP_PUSH_API_URL && process.env.VUE_APP_VAPID_PUBLIC_KEY);
}

/** Where this device stands. `unsupported` on iOS means "not installed". */
export function pushSupport () {
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches ||
    window.navigator.standalone === true;
  const supported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  return {
    supported,
    standalone,
    // iOS exposes the APIs only once installed, so !supported on iOS IS the
    // install hint; on desktop Chrome etc. a tab is fine.
    needsInstall: isIOS && !standalone,
    permission: ('Notification' in window) ? Notification.permission : 'unsupported'
  };
}

// djb2 over the endpoint URL — stable, short, and collision-safe at the
// scale of one person's devices. Firebase keys can't contain URL characters,
// so a hash beats any attempt to sanitize the endpoint itself.
export function subscriptionId (endpoint) {
  let hash = 5381;
  for (let i = 0; i < endpoint.length; i++) {
    hash = ((hash << 5) + hash + endpoint.charCodeAt(i)) >>> 0;
  }
  return `sub-${hash.toString(36)}`;
}

function urlBase64ToUint8Array (base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

/** Plain-JSON record for one device's subscription, ready for Firebase. */
export function subscriptionRecord (subscription, now = Date.now()) {
  const json = subscription.toJSON();
  return {
    id: subscriptionId(json.endpoint),
    endpoint: json.endpoint,
    keys: json.keys,
    ua: navigator.userAgent,
    createdAt: now,
    lastSeenAt: now
  };
}

/**
 * Subscribe this device. MUST be called from a user tap. Returns the record
 * that was persisted, or throws with a human-readable message the settings
 * UI shows verbatim.
 */
export async function subscribeThisDevice (store) {
  const support = pushSupport();
  if (!support.supported) {
    throw new Error(support.needsInstall
      ? 'Add Cinema Roll to your Home Screen first — iOS only allows notifications for installed apps.'
      : 'This browser does not support push notifications.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Notifications are blocked for Cinema Roll in this browser\'s settings.');
  }

  // getRegistration, not .ready — .ready never resolves when no service
  // worker is registered at all (the dev server), which would hang the
  // settings button silently instead of explaining itself.
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    throw new Error('No service worker registered — push only works on the deployed app.');
  }
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(process.env.VUE_APP_VAPID_PUBLIC_KEY)
  });

  const record = subscriptionRecord(subscription);
  await store.dispatch('savePushSubscription', record);
  return record;
}

export async function unsubscribeThisDevice (store) {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager?.getSubscription();
  if (subscription) {
    const id = subscriptionId(subscription.endpoint);
    await subscription.unsubscribe().catch(() => {});
    await store.dispatch('removePushSubscription', id);
  }
}

/**
 * Self-heal on app open: if this device already granted permission and holds
 * a subscription, re-save it (refreshes lastSeenAt, and repairs the case
 * where the browser rotated the endpoint while the app was closed — the
 * subscription this device NOW holds is the only one that can reach it).
 * Never prompts; silently does nothing on devices that never opted in.
 */
export async function refreshSubscriptionIfGranted (store) {
  try {
    const support = pushSupport();
    if (!support.supported || support.permission !== 'granted') return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager?.getSubscription();
    if (!subscription) return;
    await store.dispatch('savePushSubscription', subscriptionRecord(subscription));
  } catch {
    // Best-effort by design — a failed refresh just means the next one runs
    // on the next open.
  }
}

async function postToPushApi (route, payload) {
  const user = getAuth().currentUser;
  if (!user) throw new Error('Not signed in.');
  const idToken = await user.getIdToken();
  return axios.post(`${process.env.VUE_APP_PUSH_API_URL}${route}`, payload, {
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` }
  });
}

/**
 * The Showtimes setup (2026-09-30): theaters near a zip, or near a
 * "City, ST" when CinemaClock has no page for the zip's own town.
 * Resolves { found, place, theaters: [{ key, name, address, distance,
 * chain, readable }], reason }.
 */
export async function findTheatersNear ({ zip, city }) {
  const { data } = await postToPushApi('/theaters/near', zip ? { zip } : { city });
  return data;
}

/** After the list is saved: build this account's board now, not next sweep. */
export async function refreshTheaterBoard () {
  const { data } = await postToPushApi('/theaters/refresh', {});
  return data;
}

/** Settings screen's "Send a test notification" button. */
export function sendTestNotification () {
  return postToPushApi('/push/test', {});
}

/**
 * Fire-and-forget fan-out after logging a NEW viewing (RateMovie.vue calls
 * this only for genuinely new logs, never edits or stickiness updates).
 * The Lambda decides who actually gets it (mutual friends who opted in);
 * this just announces. Never throws — a failed announcement must not make a
 * successful save look failed.
 */
export async function announceLoggedMovie ({ tmdbId, title, score }) {
  if (!pushApiConfigured()) return;
  try {
    await postToPushApi('/push/friend-logged', { tmdbId, title, score });
  } catch (e) {
    console.warn('Friend-log push announcement failed (non-fatal):', e?.message);
  }
}

/**
 * Fire-and-forget after sending a friend request (kind 'request') or
 * accepting one (kind 'accepted'): the other person gets a push. The Lambda
 * checks the friend graph before sending, so this only announces. Never
 * throws — the friendship itself is already saved.
 */
export async function announceFriendRequest ({ toKey, kind }) {
  if (!pushApiConfigured()) return;
  try {
    await postToPushApi('/push/friend-request', { toKey, kind });
  } catch (e) {
    console.warn('Friend-request push failed (non-fatal):', e?.message);
  }
}
