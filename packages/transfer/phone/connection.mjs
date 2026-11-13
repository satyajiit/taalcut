// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Whether the Mac can be reached, from the outcomes of the page's status checks. One failed check is noise
// (Wi-Fi hiccups, a phone waking up); two in a row is a lost connection; half a minute of them, or the Mac
// answering that it isn't listening, means the Mac's phone screen is closed and the page waits for it.

export const LOST_AFTER = 2;
export const WAITING_AFTER_MS = 30_000;
export const POLL_MS = 2_000;
const MAX_PROBE_MS = 15_000;

export function initialConnection() {
  return Object.freeze({ status: 'online', failures: 0, since: 0 });
}

/**
 * The next connection state after a check. `outcome`: 'ok', 'network' (no answer), 'not-listening' (the Mac
 * answered 404: it is up, but its phone screen is closed) or anything else, which changes nothing.
 */
export function noteConnection(state, outcome, now) {
  if (outcome === 'ok') return initialConnection();
  if (outcome !== 'network' && outcome !== 'not-listening') return state;
  const failures = state.failures + 1;
  const since = state.failures > 0 ? state.since : now;
  if (outcome === 'not-listening') return Object.freeze({ status: 'waiting', failures, since });
  if (failures < LOST_AFTER) return Object.freeze({ status: 'online', failures, since });
  const status = now - since >= WAITING_AFTER_MS ? 'waiting' : 'lost';
  return Object.freeze({ status, failures, since });
}

/** How long to wait before the next check: every 2 s while online, then backing off to 15 s. */
export function nextCheckMs(state) {
  if (state.status === 'online') return POLL_MS;
  const steps = Math.max(0, state.failures - LOST_AFTER + 1);
  return Math.min(MAX_PROBE_MS, POLL_MS * 2 ** steps);
}

/** What a failed request says about the connection, from failureInfo's status. */
export function outcomeOf(status) {
  if (!status) return 'network';
  if (status === 404) return 'not-listening';
  if (status === 401) return 'expired';
  return 'other';
}
