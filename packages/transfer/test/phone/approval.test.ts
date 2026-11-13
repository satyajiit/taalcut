// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The phone page's approval (UX3): what each answer of the computer means, and the run that asks, polls while
// the page is seen, stops on an answer, withdraws its request when the PIN takes over and holds Ask again for a
// 429's Retry-After. The run touches no DOM; a fake call() plays the computer and fake timers keep the time.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  APPROVAL_POLL_MS,
  approvalErrorKey,
  askReason,
  createApprovalRun,
  pollDelay,
  RATE_HOLD_MS,
  readAsk,
  readWait,
  retryAfterMs,
  WAIT_MISSES,
  // @ts-expect-error phone modules ship as plain JavaScript for the browser.
} from '../../phone/approval.mjs';
// @ts-expect-error phone modules ship as plain JavaScript for the browser.
import { labelKey } from '../../phone/logic.mjs';

type Result = { ok: true; value: unknown } | { ok: false; status: number; retryAfter?: string | null };
type View = {
  phase: string;
  code: string;
  stale: boolean;
  reason: string;
  key: string;
  again: boolean;
  held: boolean;
  credential?: string;
  deviceId?: string;
};
type Sent = { path: string; body: Record<string, unknown>; keepalive?: boolean; at: number };

const TICKET = 'tK3yZ0aB1cD2eF3gH4iJ5kL6mN7oP8qR9sT0uV1wX2y';
const ok = (value: unknown): Result => ({ ok: true, value });
const fail = (status: number, retryAfter: string | null = null): Result => ({
  ok: false,
  status,
  retryAfter,
});
const accepted = (code = '47', ticket = TICKET) =>
  ok({ ticket, matchCode: code, address: '192.168.1.20', expiresInMs: 60_000, pollMs: 1000 });
const pending = ok({ state: 'pending', expiresInMs: 50_000 });
const allowed = ok({ state: 'allowed', deviceId: 'phone-1', credential: 'credential-1', limits: {} });

/** A computer that answers asks and polls from scripts (the last answer repeats), and a page that can hide. */
function harness({ asks = [accepted()], waits = [pending] }: { asks?: Result[]; waits?: Result[] } = {}) {
  const sent: Sent[] = [];
  const views: View[] = [];
  const script = { asks: [...asks], waits: [...waits] };
  let seen = true;
  const next = (list: Result[]) => (list.length > 1 ? list.shift() : list[0]) as Result;
  const run = createApprovalRun({
    deviceName: 'iPhone',
    token: () => 'qr-token-0123456789',
    visible: () => seen,
    setTimer: (callback: () => void, ms: number) => setTimeout(callback, ms),
    clearTimer: (id: ReturnType<typeof setTimeout>) => clearTimeout(id),
    onChange: (view: View) => views.push(view),
    call: async (path: string, options: { body: Record<string, unknown>; keepalive?: boolean }) => {
      sent.push({ path, body: options.body, keepalive: options.keepalive, at: Date.now() });
      if (path === '/api/pair/ask') return next(script.asks);
      if (path === '/api/pair/wait') return next(script.waits);
      return ok(null);
    },
  });
  return {
    run,
    sent,
    script,
    view: (): View => run.view(),
    phases: () => views.map((view) => view.phase),
    to: (path: string) => sent.filter((entry) => entry.path === path),
    hide: () => {
      seen = false;
    },
    show: () => {
      seen = true;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('reading the answers', () => {
  it('takes an ask that opened a request: the ticket, the two digits and the poll interval within bounds', () => {
    expect(readAsk(accepted('07'))).toEqual({ kind: 'waiting', ticket: TICKET, code: '07', pollMs: 1000 });
    expect(pollDelay(undefined)).toBe(APPROVAL_POLL_MS);
    expect([pollDelay(10), pollDelay(60_000), pollDelay(1500)]).toEqual([250, 5000, 1500]);
    for (const value of [{ ticket: 'short', matchCode: '47' }, { ticket: TICKET, matchCode: '470' }, null]) {
      expect(readAsk(ok(value))).toEqual({ kind: 'failed', reason: 'network', holdMs: 0 });
    }
  });

  it('names why an ask failed, and holds Ask again only for a 429, as long as Retry-After says', () => {
    const reasons = [401, 403, 404, 409, 429, 0, 500].map((status) => askReason(status));
    expect(reasons).toEqual(['refused', 'full', 'closed', 'busy', 'rate', 'network', 'network']);
    expect(readAsk(fail(429, '2'))).toEqual({ kind: 'failed', reason: 'rate', holdMs: 2000 });
    expect(readAsk(fail(429))).toEqual({ kind: 'failed', reason: 'rate', holdMs: RATE_HOLD_MS });
    expect(readAsk(fail(409))).toEqual({ kind: 'failed', reason: 'busy', holdMs: 0 });
    expect(retryAfterMs('soon')).toBe(RATE_HOLD_MS);
  });

  it('reads a poll: still pending, allowed with its credential, denied, lapsed, slow down, or no answer', () => {
    expect(readWait(pending)).toEqual({ kind: 'pending' });
    expect(readWait(allowed)).toEqual({ kind: 'allowed', credential: 'credential-1', deviceId: 'phone-1' });
    expect(readWait(ok({ state: 'denied' }))).toEqual({ kind: 'denied' });
    expect(readWait(ok({ state: 'expired' }))).toEqual({ kind: 'expired' });
    // Allowed without a credential can't pair; the request is over all the same.
    expect(readWait(ok({ state: 'allowed', deviceId: 'phone-1' }))).toEqual({ kind: 'expired' });
    expect(readWait(fail(404))).toEqual({ kind: 'expired' });
    expect(readWait(fail(429, '3'))).toEqual({ kind: 'slow', delayMs: 3000 });
    expect(readWait(fail(0))).toEqual({ kind: 'miss' });
    expect(readWait(fail(500))).toEqual({ kind: 'miss' });
  });

  it('gives each ending its sentence; not listening and no answer are the PIN form’s', () => {
    expect(approvalErrorKey('denied')).toBe(labelKey.approvalDenied);
    expect(approvalErrorKey('expired')).toBe(labelKey.approvalExpired);
    expect(approvalErrorKey('busy')).toBe(labelKey.approvalBusy);
    expect(approvalErrorKey('refused')).toBe(labelKey.approvalRefused);
    expect(approvalErrorKey('closed')).toBe(labelKey.pairErrorClosed);
    expect(approvalErrorKey('full')).toBe(labelKey.pairErrorFull);
    expect(approvalErrorKey('rate')).toBe(labelKey.pairErrorRate);
    expect(approvalErrorKey('network')).toBe(labelKey.pairErrorNetwork);
    expect(approvalErrorKey('anything')).toBe(labelKey.pairErrorNetwork);
  });
});

describe('asking and polling', () => {
  it('asks at once with the token and the phone’s name, shows the code, polls every pollMs, stops when allowed', async () => {
    const h = harness({ waits: [pending, pending, allowed] });
    await h.run.ask();
    expect(h.to('/api/pair/ask')[0]?.body).toEqual({
      token: 'qr-token-0123456789',
      device: { name: 'iPhone' },
    });
    expect(h.view()).toMatchObject({
      phase: 'waiting',
      code: '47',
      stale: false,
      key: labelKey.approvalWaiting,
    });
    expect(h.to('/api/pair/wait')).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(3000);
    const polls = h.to('/api/pair/wait');
    expect(polls.map((poll) => poll.at)).toEqual([1000, 2000, 3000]);
    expect(polls[0]?.body).toEqual({ ticket: TICKET });
    expect(h.view()).toMatchObject({
      phase: 'allowed',
      credential: 'credential-1',
      deviceId: 'phone-1',
      key: labelKey.pairDone,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.to('/api/pair/wait'), 'no polls after the answer').toHaveLength(3);
    expect(h.to('/api/pair/cancel'), 'an answered ticket is spent, not withdrawn').toHaveLength(0);
    expect(h.phases()).toEqual(['asking', 'waiting', 'allowed']);
  });

  it('says no with Ask again, keeping the code dimmed; Ask again opens a new request that can be allowed', async () => {
    const h = harness({ asks: [accepted('47'), accepted('81')], waits: [ok({ state: 'denied' })] });
    await h.run.ask();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.view()).toMatchObject({
      phase: 'failed',
      reason: 'denied',
      key: labelKey.approvalDenied,
      again: true,
      code: '47',
      stale: true,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.to('/api/pair/wait')).toHaveLength(1);
    h.script.waits = [allowed];
    const asking = h.run.ask();
    expect(h.view()).toMatchObject({ phase: 'asking', code: '47', stale: true, again: false });
    await asking;
    expect(h.view()).toMatchObject({ phase: 'waiting', code: '81', stale: false });
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.view().phase).toBe('allowed');
    expect(h.to('/api/pair/cancel')).toHaveLength(0);
  });

  it('ends on a lapsed request with Ask again', async () => {
    const h = harness({ waits: [pending, ok({ state: 'expired' })] });
    await h.run.ask();
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.view()).toMatchObject({
      phase: 'failed',
      reason: 'expired',
      key: labelKey.approvalExpired,
      again: true,
    });
  });

  it('waits while the page is hidden, asks at once when it is seen again, and takes a 404 as a lapsed request', async () => {
    const h = harness();
    await h.run.ask();
    await vi.advanceTimersByTimeAsync(1000);
    h.hide();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.to('/api/pair/wait'), 'no polls while hidden').toHaveLength(1);
    h.script.waits = [fail(404)];
    h.show();
    h.run.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.to('/api/pair/wait')).toHaveLength(2);
    expect(h.to('/api/pair/wait')[1]?.at).toBe(31_000);
    expect(h.view()).toMatchObject({ phase: 'failed', reason: 'expired', again: true });
  });

  it('carries on through a missed poll or two, and gives up (withdrawing the request) after WAIT_MISSES', async () => {
    const h = harness({ waits: [fail(0), fail(503), pending, fail(0), fail(0), fail(0)] });
    await h.run.ask();
    await vi.advanceTimersByTimeAsync(3000);
    expect(h.view().phase).toBe('waiting');
    await vi.advanceTimersByTimeAsync(WAIT_MISSES * 1000);
    expect(h.view()).toMatchObject({
      phase: 'failed',
      reason: 'network',
      key: labelKey.pairErrorNetwork,
      again: true,
    });
    expect(h.to('/api/pair/cancel').map((entry) => entry.body)).toEqual([{ ticket: TICKET }]);
  });

  it('slows down when a poll is told 429, for as long as Retry-After says', async () => {
    const h = harness({ waits: [fail(429, '4'), pending] });
    await h.run.ask();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(3999);
    expect(h.to('/api/pair/wait')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.to('/api/pair/wait').map((poll) => poll.at)).toEqual([1000, 5000]);
    expect(h.view().phase).toBe('waiting');
  });
});

describe('when the ask itself fails', () => {
  it('holds Ask again for a 429’s Retry-After, and ignores asking until then', async () => {
    const h = harness({ asks: [fail(429, '3'), accepted()] });
    await h.run.ask();
    expect(h.view()).toMatchObject({
      phase: 'failed',
      reason: 'rate',
      key: labelKey.pairErrorRate,
      again: true,
      held: true,
    });
    await h.run.ask();
    expect(h.to('/api/pair/ask')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(h.view().held).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    expect(h.view().held).toBe(false);
    await h.run.ask();
    expect(h.view().phase).toBe('waiting');
  });

  it('offers Ask again for a busy computer, one not listening, one full or no answer; never for a refused token', async () => {
    for (const [status, reason, again] of [
      [409, 'busy', true],
      [404, 'closed', true],
      [403, 'full', true],
      [0, 'network', true],
      [401, 'refused', false],
    ] as const) {
      const h = harness({ asks: [fail(status)] });
      await h.run.ask();
      expect(h.view(), String(status)).toMatchObject({
        phase: 'failed',
        reason,
        again,
        code: '',
        held: false,
      });
      await vi.advanceTimersByTimeAsync(5000);
      expect(h.to('/api/pair/wait'), String(status)).toHaveLength(0);
    }
  });
});

describe('stopping', () => {
  it('withdraws the request when the PIN takes over, and polls no more', async () => {
    const h = harness();
    await h.run.ask();
    await vi.advanceTimersByTimeAsync(2000);
    h.run.stop();
    expect(h.view()).toMatchObject({ phase: 'idle', code: '' });
    expect(h.to('/api/pair/cancel').map((entry) => [entry.body, entry.keepalive])).toEqual([
      [{ ticket: TICKET }, false],
    ]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(h.to('/api/pair/wait')).toHaveLength(2);
  });

  it('lets go of a request that opens after the PIN took over', async () => {
    const h = harness();
    const asking = h.run.ask();
    h.run.stop();
    await asking;
    expect(h.view().phase).toBe('idle');
    expect(h.to('/api/pair/cancel').map((entry) => entry.body)).toEqual([{ ticket: TICKET }]);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.to('/api/pair/wait')).toHaveLength(0);
  });

  it('withdraws with a request that outlives the page as it goes, and a page brought back hears it lapsed', async () => {
    const h = harness();
    await h.run.ask();
    h.run.withdraw();
    expect(h.to('/api/pair/cancel').map((entry) => [entry.body, entry.keepalive])).toEqual([
      [{ ticket: TICKET }, true],
    ]);
    expect(h.view().phase).toBe('waiting');
    h.script.waits = [fail(404)];
    h.run.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.view()).toMatchObject({ phase: 'failed', reason: 'expired', again: true });
  });
});
