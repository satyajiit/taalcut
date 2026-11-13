// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// "Approve on computer" (UX3) over real HTTP: a phone with the QR's token asks, the window that opened the session
// sees the request and a person answers it. Only Allow pairs: a photo of the QR can ask, never pair. One request at
// a time; unanswered for a minute it lapses, and a phone that stops asking has gone.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TransferApproval, TransferApprovalId, TransferSessionId } from '@taalcut/core';
import { afterEach, describe, expect, it } from 'vitest';
import { TRANSFER_LIMITS } from '../../src/limits';
import { httpCall, manualClock, startFixture, type Fixture, type FixtureClock } from '../support/harness';
import { pairPhone, tokenOf } from '../support/upload';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36';

type Asked = { status: number; ticket: string; matchCode: string; address: string; body: string };

async function post(fx: Fixture, path: string, body: unknown, userAgent = IPHONE) {
  return httpCall({
    host: fx.address,
    port: fx.port,
    method: 'POST',
    path,
    headers: { 'content-type': 'application/json', 'user-agent': userAgent },
    body: JSON.stringify(body),
  });
}

async function ask(fx: Fixture, token: string, userAgent = IPHONE): Promise<Asked> {
  const res = await post(fx, '/api/pair/ask', { token, device: { name: 'not-trusted' } }, userAgent);
  const parsed = res.status === 202 ? (JSON.parse(res.body) as Omit<Asked, 'status' | 'body'>) : null;
  return {
    status: res.status,
    body: res.body,
    ticket: parsed?.ticket ?? '',
    matchCode: parsed?.matchCode ?? '',
    address: parsed?.address ?? '',
  };
}

async function wait(fx: Fixture, ticket: string) {
  const res = await post(fx, '/api/pair/wait', { ticket });
  return { status: res.status, value: res.body ? (JSON.parse(res.body) as Record<string, unknown>) : null };
}

/** The approval the opening window saw last for `id`, once it reaches `state`. */
async function seen(fx: Fixture, state: TransferApproval['state'], id?: string): Promise<TransferApproval> {
  const item = await fx.waitFor(
    (next) => next.type === 'approval' && next.approval.state === state && (!id || next.approval.id === id),
  );
  if (item.type !== 'approval') throw new Error('not an approval');
  return item.approval;
}

function answer(fx: Fixture, id: string, allow: boolean) {
  return fx.service.answerApproval(fx.sessionId as TransferSessionId, id as TransferApprovalId, allow);
}

const later = (clock: FixtureClock, ms: number) => clock.set(clock.now() + ms);

describe('approve on computer', () => {
  let fx: Fixture | undefined;

  afterEach(async () => {
    await fx?.dispose();
    fx = undefined;
  });

  it('pairs a phone with the QR once a person allows it, and hands over the credential once', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const token = tokenOf(fx.pairing.qrText);
    const asked = await ask(fx, token);
    expect(asked.status).toBe(202);
    expect(asked.ticket).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(asked.matchCode).toMatch(/^\d{2}$/);
    expect(asked.address).toBe('127.0.0.1');
    const pending = await seen(fx, 'pending');
    expect(pending).toMatchObject({
      sessionId: fx.sessionId,
      device: { label: 'iPhone', platform: 'ios' },
      address: '127.0.0.1',
      matchCode: asked.matchCode,
      expiresAt: clock.now() + TRANSFER_LIMITS.approvalTtlMs,
    });
    expect(await wait(fx, asked.ticket)).toMatchObject({ status: 200, value: { state: 'pending' } });

    const allowed = await answer(fx, pending.id, true);
    expect(allowed.state).toBe('allowed');
    await seen(fx, 'allowed', pending.id);
    const told = await wait(fx, asked.ticket);
    expect(told.value).toMatchObject({ state: 'allowed', limits: { chunkSize: TRANSFER_LIMITS.chunkSize } });
    const credential = String(told.value?.credential);
    const session = await httpCall({
      host: fx.address,
      port: fx.port,
      path: '/api/session',
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(session.status).toBe(200);
    expect((await wait(fx, asked.ticket)).status).toBe(404);
    const listed = await fx.waitFor((item) => item.type === 'session' && item.session.devices.length === 1);
    expect(listed.type === 'session' && listed.session.devices[0]?.label).toBe('iPhone');

    // The secrets stay where they belong: never on disk, in a log or in an event every window sees.
    const stored = await readFile(join(fx.stateDir, 'devices.json'), 'utf8');
    const everywhere = [stored, fx.logs.join('\n'), JSON.stringify(fx.events)].join('\n');
    for (const secret of [credential, asked.ticket, token]) expect(everywhere).not.toContain(secret);
    expect(fx.events.some((event) => JSON.stringify(event).includes('"approval"'))).toBe(false);
  });

  it('never pairs on the QR alone: unanswered, the request lapses after a minute', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const token = tokenOf(fx.pairing.qrText);
    const asked = await ask(fx, token);
    const pending = await seen(fx, 'pending');
    later(clock, 1_100);
    expect((await post(fx, '/api/pair', { token, device: {} })).status).toBe(401);
    // The phone keeps asking how it stands (here every 9 s, inside the 10 s that would mean it had gone).
    expect((await wait(fx, asked.ticket)).value).toMatchObject({ state: 'pending' });
    for (let poll = 0; poll < 6; poll += 1) {
      later(clock, 9_000);
      expect((await wait(fx, asked.ticket)).value).toMatchObject({ state: 'pending' });
    }
    later(clock, TRANSFER_LIMITS.approvalTtlMs);
    await seen(fx, 'expired', pending.id);
    expect((await wait(fx, asked.ticket)).value).toEqual({ state: 'expired' });
    expect((await wait(fx, asked.ticket)).status).toBe(404);
    // An answer that comes too late says how the request ended, and lets nobody in.
    expect((await answer(fx, pending.id, true)).state).toBe('expired');
    const sessions = fx.items.filter((item) => item.type === 'session');
    expect(sessions.every((item) => item.type === 'session' && item.session.devices.length === 0)).toBe(true);
  });

  it('tells the phone a refusal, and counts it as a failed pairing', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const first = fx.pairing.pin;
    for (let attempt = 0; attempt < TRANSFER_LIMITS.pairFailuresBeforeReset - 1; attempt += 1) {
      later(clock, 1_100);
      expect((await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: '000000' })).status).toBe(401);
    }
    later(clock, 1_100);
    const asked = await ask(fx, tokenOf(fx.pairing.qrText));
    const pending = await seen(fx, 'pending');
    expect((await answer(fx, pending.id, false)).state).toBe('denied');
    expect((await wait(fx, asked.ticket)).value).toEqual({ state: 'denied' });
    // The fifth failure, the refusal, replaced the QR's secrets.
    const rotated = await fx.waitFor(
      (item) => item.type === 'session' && item.pairing !== undefined && item.pairing.pin !== first,
    );
    expect(rotated.type === 'session' && rotated.session.pairingResets).toBe(1);
  });

  it('keeps one request waiting at a time; the same phone asking again replaces its own', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const token = tokenOf(fx.pairing.qrText);
    const iphone = await ask(fx, token);
    const firstPending = await seen(fx, 'pending');
    later(clock, 1_100);
    const pixel = await ask(fx, token, PIXEL);
    expect(pixel.status).toBe(409);
    expect(JSON.parse(pixel.body)).toEqual({ reason: 'busy' });
    later(clock, 1_100);
    const again = await ask(fx, token);
    expect(again.status).toBe(202);
    expect(again.ticket).not.toBe(iphone.ticket);
    await seen(fx, 'withdrawn', firstPending.id);
    expect((await wait(fx, iphone.ticket)).value).toEqual({ state: 'expired' });
    expect((await wait(fx, again.ticket)).value).toMatchObject({ state: 'pending' });
  });

  it('refuses a wrong or missing token, and a full session', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    expect((await ask(fx, 'not-the-token')).status).toBe(401);
    later(clock, 1_100);
    expect((await post(fx, '/api/pair/ask', { device: {} })).status).toBe(401);
    later(clock, 61_000);
    for (let phone = 0; phone < TRANSFER_LIMITS.maxDevices; phone += 1) {
      later(clock, 1_100);
      expect((await pairPhone(fx, { token: tokenOf(fx.pairing.qrText), pin: fx.pairing.pin })).status).toBe(
        200,
      );
    }
    later(clock, 1_100);
    expect((await ask(fx, tokenOf(fx.pairing.qrText))).status).toBe(403);
  });

  it('lets the phone take its request back, and lets a phone that went quiet go', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const token = tokenOf(fx.pairing.qrText);
    const asked = await ask(fx, token);
    const pending = await seen(fx, 'pending');
    expect((await post(fx, '/api/pair/cancel', { ticket: asked.ticket })).status).toBe(204);
    await seen(fx, 'withdrawn', pending.id);
    expect((await answer(fx, pending.id, true)).state).toBe('withdrawn');
    expect((await post(fx, '/api/pair/cancel', { ticket: asked.ticket })).status).toBe(404);

    later(clock, 1_100);
    const quiet = await ask(fx, token);
    expect(quiet.status).toBe(202);
    const next = await fx.waitFor(
      (item) =>
        item.type === 'approval' && item.approval.state === 'pending' && item.approval.id !== pending.id,
    );
    const second = next.type === 'approval' ? next.approval.id : '';
    later(clock, TRANSFER_LIMITS.approvalAbandonMs + 1_000);
    // The computer looks every second: the dialog closes without anyone touching it.
    await seen(fx, 'withdrawn', second);
    expect((await answer(fx, second, true)).state).toBe('withdrawn');
  });

  it('limits asking per address, but not the waiting', async () => {
    const clock = manualClock();
    fx = await startFixture({ clock });
    const token = tokenOf(fx.pairing.qrText);
    const statuses: number[] = [];
    let ticket = '';
    for (let attempt = 0; attempt < TRANSFER_LIMITS.approvalAsksPerMinute + 1; attempt += 1) {
      later(clock, 1_100);
      const asked = await ask(fx, token);
      statuses.push(asked.status);
      if (asked.ticket) ticket = asked.ticket;
    }
    expect(statuses).toEqual([202, 202, 202, 429]);
    // A minute of waiting is 60 polls: twice the unauthenticated ceiling, and every one answered.
    const polls = [];
    for (let poll = 0; poll < 2 * TRANSFER_LIMITS.unauthPerMinute; poll += 1)
      polls.push(await wait(fx, ticket));
    expect(polls.every((poll) => poll.status === 200)).toBe(true);
  });

  it('answers only for a live session and a request it knows', async () => {
    fx = await startFixture({ clock: manualClock() });
    await expect(answer(fx, '01K7C5M6Q8PH0NE00000000A01', true)).rejects.toMatchObject({
      code: 'transfer.pairing_failed',
    });
    const sessionId = fx.sessionId;
    await fx.close();
    await expect(
      fx.service.answerApproval(
        sessionId as TransferSessionId,
        '01K7C5M6Q8PH0NE00000000A01' as TransferApprovalId,
        true,
      ),
    ).rejects.toMatchObject({ code: 'transfer.session_closed' });
  });
});
