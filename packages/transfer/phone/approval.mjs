// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Pairing by approval (UX3). A page opened from the QR asks the computer to let this phone in (`/api/pair/ask`),
// shows the two-digit match code the computer shows beside Allow and Deny, and polls `/api/pair/wait` until a
// person answers. This module reads each answer and runs the asking and the polling; it touches no DOM
// (pairing.mjs paints the view it reports), so its decisions are tested on their own with fake timers.
import { labelKey } from './i18n.mjs';

/** How often to ask whether the computer answered, unless it says otherwise. */
export const APPROVAL_POLL_MS = 1000;
const POLL_RANGE = [250, 5000];
/** Polls in a row that get no answer before the page gives up: the computer withdraws a silent phone after 10 s. */
export const WAIT_MISSES = 3;
/** How long Ask again waits after a 429 that names no Retry-After. */
export const RATE_HOLD_MS = 5000;
const TICKET = /^[A-Za-z0-9_-]{16,200}$/;
const MATCH = /^\d{2}$/;

const SENTENCES = Object.freeze({
  denied: labelKey.approvalDenied,
  expired: labelKey.approvalExpired,
  busy: labelKey.approvalBusy,
  refused: labelKey.approvalRefused,
  closed: labelKey.pairErrorClosed,
  full: labelKey.pairErrorFull,
  rate: labelKey.pairErrorRate,
  network: labelKey.pairErrorNetwork,
});

/** The poll interval the computer asked for, kept between a quarter second and five seconds. */
export function pollDelay(ms) {
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return APPROVAL_POLL_MS;
  return Math.min(POLL_RANGE[1], Math.max(POLL_RANGE[0], Math.round(value)));
}

/** A Retry-After header in seconds, as milliseconds (`fallback` when it is missing or not a number). */
export function retryAfterMs(header, fallback = RATE_HOLD_MS) {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : fallback;
}

/** Why an ask failed, from its status (0: no answer at all). */
export function askReason(status) {
  if (status === 401) return 'refused';
  if (status === 403) return 'full';
  if (status === 404) return 'closed';
  if (status === 409) return 'busy';
  if (status === 429) return 'rate';
  return 'network';
}

/**
 * What an answer to `POST /api/pair/ask` means. `result` is the page's call(): `{ ok, value }` or
 * `{ ok: false, status, retryAfter }`. Returns `{ kind: 'waiting', ticket, code, pollMs }` or
 * `{ kind: 'failed', reason, holdMs }`.
 */
export function readAsk(result) {
  if (!result?.ok) {
    const reason = askReason(result?.status);
    return { kind: 'failed', reason, holdMs: reason === 'rate' ? retryAfterMs(result?.retryAfter) : 0 };
  }
  const value = result.value ?? {};
  const code = String(value.matchCode ?? '');
  if (typeof value.ticket !== 'string' || !TICKET.test(value.ticket) || !MATCH.test(code)) {
    return { kind: 'failed', reason: 'network', holdMs: 0 };
  }
  return { kind: 'waiting', ticket: value.ticket, code, pollMs: pollDelay(value.pollMs) };
}

/**
 * What an answer to `POST /api/pair/wait` means: `pending` (ask again later), `allowed` (with the credential),
 * `denied`, `expired` (also a ticket the computer no longer knows: a 404, after a lapse while the page was
 * hidden), `slow` (429: wait `delayMs`) or `miss` (no answer, or one that says nothing: try again).
 */
export function readWait(result) {
  if (!result?.ok) {
    if (result?.status === 404) return { kind: 'expired' };
    if (result?.status === 429)
      return { kind: 'slow', delayMs: retryAfterMs(result.retryAfter, APPROVAL_POLL_MS) };
    return { kind: 'miss' };
  }
  const value = result.value ?? {};
  if (value.state === 'pending') return { kind: 'pending' };
  if (value.state === 'denied') return { kind: 'denied' };
  if (value.state === 'allowed') {
    const { credential, deviceId } = value;
    if (typeof credential === 'string' && credential && typeof deviceId === 'string' && deviceId) {
      return { kind: 'allowed', credential, deviceId };
    }
  }
  // 'expired', or an answer the page can't use: this request is over, and asking again starts a new one.
  return { kind: 'expired' };
}

/** The sentence for a request that ended with `reason`. Not listening and no answer are the PIN's sentences. */
export function approvalErrorKey(reason) {
  return SENTENCES[reason] ?? labelKey.pairErrorNetwork;
}

const IDLE = Object.freeze({
  phase: 'idle',
  code: '',
  stale: false,
  reason: '',
  key: labelKey.approvalWaiting,
  again: false,
  held: false,
});

/**
 * Runs one approval request at a time. `host`: { call(path, options) (never throws), token(), deviceName,
 * visible(), setTimer(run, ms), clearTimer(id), onChange(view) }.
 *
 * The view: `phase` 'idle' | 'asking' | 'waiting' | 'allowed' | 'failed'; `code` the match code (kept, `stale`,
 * once its request is over, so the line under it doesn't jump); `reason` why it failed; `key` the line's
 * sentence; `again` whether Ask again is offered and `held` while a 429's Retry-After runs; on 'allowed',
 * `credential` and `deviceId`.
 */
export function createApprovalRun(host) {
  let view = IDLE;
  let ticket = '';
  let pollMs = APPROVAL_POLL_MS;
  let misses = 0;
  let timer = 0;
  let holdTimer = 0;
  // The round whose poll is on its way (0: none), so a poll never overlaps another of the same round.
  let polling = 0;
  // Each ask and each stop starts a new round; an answer that comes back for an older round is dropped.
  let round = 0;

  const set = (next) => {
    view = Object.freeze({ ...view, ...next });
    host.onChange(view);
  };
  const cancel = (spent, keepalive = false) => {
    if (spent) void host.call('/api/pair/cancel', { method: 'POST', body: { ticket: spent }, keepalive });
  };
  const clear = () => {
    if (timer) host.clearTimer(timer);
    if (holdTimer) host.clearTimer(holdTimer);
    timer = 0;
    holdTimer = 0;
  };
  const schedule = (ms) => {
    if (timer) host.clearTimer(timer);
    timer = host.setTimer(() => {
      timer = 0;
      void poll();
    }, ms);
  };

  function fail(reason, holdMs = 0) {
    ticket = '';
    const again = reason !== 'refused';
    set({ phase: 'failed', stale: true, reason, key: approvalErrorKey(reason), again, held: holdMs > 0 });
    if (holdMs <= 0) return;
    const mine = round;
    holdTimer = host.setTimer(() => {
      holdTimer = 0;
      if (mine === round) set({ held: false });
    }, holdMs);
  }

  /** Asks the computer (again). Ignored while a 429 holds Ask again. */
  async function ask() {
    if (view.held || view.phase === 'asking' || view.phase === 'allowed') return;
    clear();
    const before = ticket;
    ticket = '';
    cancel(before);
    round += 1;
    const mine = round;
    misses = 0;
    set({
      phase: 'asking',
      stale: true,
      reason: '',
      key: labelKey.approvalWaiting,
      again: false,
      held: false,
    });
    const body = { token: host.token(), device: { name: host.deviceName } };
    const answer = readAsk(await host.call('/api/pair/ask', { method: 'POST', body }));
    if (mine !== round) {
      // Stopped while asking: let go of the request the computer just opened.
      if (answer.kind === 'waiting') cancel(answer.ticket);
      return;
    }
    if (answer.kind === 'failed') {
      fail(answer.reason, answer.holdMs);
      return;
    }
    ticket = answer.ticket;
    pollMs = answer.pollMs;
    set({ phase: 'waiting', code: answer.code, stale: false });
    schedule(pollMs);
  }

  async function poll() {
    if (view.phase !== 'waiting' || polling === round) return;
    // Hidden: no polling. resume() asks at once when the page is seen again.
    if (!host.visible()) return;
    const mine = round;
    polling = mine;
    const answer = readWait(await host.call('/api/pair/wait', { method: 'POST', body: { ticket } }));
    if (polling === mine) polling = 0;
    if (mine !== round || view.phase !== 'waiting') return;
    if (answer.kind === 'pending') {
      misses = 0;
      schedule(pollMs);
    } else if (answer.kind === 'slow') {
      schedule(Math.max(pollMs, answer.delayMs));
    } else if (answer.kind === 'miss') {
      misses += 1;
      if (misses < WAIT_MISSES) {
        schedule(pollMs);
        return;
      }
      cancel(ticket);
      fail('network');
    } else if (answer.kind === 'allowed') {
      ticket = '';
      const { credential, deviceId } = answer;
      set({ phase: 'allowed', stale: false, key: labelKey.pairDone, again: false, credential, deviceId });
    } else {
      fail(answer.kind);
    }
  }

  /** The page is seen again: ask at once whether the computer answered (or let the request lapse). */
  function resume() {
    if (view.phase !== 'waiting' || polling === round) return;
    if (timer) host.clearTimer(timer);
    timer = 0;
    void poll();
  }

  /** Stops for good (the PIN instead, or paired): a request still waiting is withdrawn. */
  function stop() {
    round += 1;
    clear();
    cancel(ticket);
    ticket = '';
    view = IDLE;
    host.onChange(view);
  }

  /**
   * The page is going away: withdraw the request with a request that outlives the page, but keep the view, so a
   * page the browser brings back asks at once, hears the request is gone and offers Ask again.
   */
  function withdraw() {
    cancel(ticket, true);
  }

  return { ask, resume, stop, withdraw, view: () => view };
}
