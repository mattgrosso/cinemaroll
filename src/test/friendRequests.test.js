import { describe, it, expect, beforeEach } from 'vitest';
import {
  pendingFriendRequests, unsnoozedFriendRequests, snoozeFriendRequest, readFriendRequestSnoozes,
  FRIEND_REQUEST_SNOOZE_MS
} from '../assets/javascript/friendRequests.js';
import { QA_ACCOUNT_KEYS } from '../assets/javascript/databaseKey.js';

const ME = 'me-gmail-com';

describe('pendingFriendRequests', () => {
  it('lists requests by name, falling back to the key', () => {
    expect(pendingFriendRequests({ a: { name: 'Ann' }, b: {} }, {}, ME))
      .toEqual([{ key: 'a', name: 'Ann' }, { key: 'b', name: 'b' }]);
  });

  it('drops someone already befriended and the QA tester', () => {
    const edges = { [ME]: { a: true }, a: { [ME]: true } };
    expect(pendingFriendRequests({ a: { name: 'Ann' }, [QA_ACCOUNT_KEYS[0]]: { name: 'QA' } }, edges, ME)).toEqual([]);
  });

  it('copes with nothing loaded yet', () => {
    expect(pendingFriendRequests(null, null, null)).toEqual([]);
  });
});

describe('snoozing a request on the card', () => {
  beforeEach(() => localStorage.clear());

  it('hides it until the snooze ends, then brings it back', () => {
    const now = 1_800_000_000_000;
    const snoozes = snoozeFriendRequest('a', now);
    const pending = [{ key: 'a', name: 'Ann' }, { key: 'b', name: 'Bo' }];

    expect(readFriendRequestSnoozes()).toEqual(snoozes);
    expect(unsnoozedFriendRequests(pending, snoozes, now + 1000)).toEqual([{ key: 'b', name: 'Bo' }]);
    expect(unsnoozedFriendRequests(pending, snoozes, now + FRIEND_REQUEST_SNOOZE_MS + 1)).toEqual(pending);
  });
});
