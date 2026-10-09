// Friend requests waiting for an answer — one rule for Home's card, the Film
// Club button's badge and the home-screen icon badge.
//
// Bug report (Matt, 2026-10-09): friends who had just joined never answered
// his requests. The card on Home only linked to Film Club, sat under the
// welcome text on a new account, and nothing outside the app counted a
// request at all. A request from someone already befriended is stale noise,
// and the QA tester is invisible to real people — the same filters the Film
// Club inbox applies.

import { isQaAccountKey } from './databaseKey.js';

export const FRIEND_REQUEST_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000;
const SNOOZE_STORAGE_KEY = 'cinemaRoll.friendRequestSnoozes';

export function pendingFriendRequests (requests, edges, me) {
  return Object.entries(requests || {})
    .filter(([key]) => !(edges?.[me]?.[key] && edges?.[key]?.[me]))
    .filter(([key]) => !isQaAccountKey(key))
    .map(([key, request]) => ({ key, name: request?.name || key }));
}

// "Not now" on Home's card hides one request from the card for a few days on
// this device. It doesn't decline: the request stays in the Film Club inbox
// (and on the badges), and the card brings it back when the snooze ends.
export function unsnoozedFriendRequests (pending, snoozes = {}, now = Date.now()) {
  return pending.filter(({ key }) => !(Number(snoozes?.[key]) > now));
}

export function readFriendRequestSnoozes () {
  try {
    return JSON.parse(localStorage.getItem(SNOOZE_STORAGE_KEY)) || {};
  } catch {
    return {};
  }
}

export function snoozeFriendRequest (key, now = Date.now()) {
  const snoozes = { ...readFriendRequestSnoozes(), [key]: now + FRIEND_REQUEST_SNOOZE_MS };
  try {
    localStorage.setItem(SNOOZE_STORAGE_KEY, JSON.stringify(snoozes));
  } catch {
    // Private mode or full storage: the card just stays for this session.
  }
  return snoozes;
}
