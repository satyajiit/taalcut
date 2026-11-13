// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// "Approve on computer" (UX3): a phone that opened the QR's link asks to pair with the QR's token, and only a
// person's Allow in the window that opened the session pairs it. A photo of the QR can ask, never pair. One request
// waits at a time; it lapses after a minute unanswered, or once the phone stops asking how it stands. The phone
// holds a ticket (a 256-bit secret, kept here only as its hash) and collects its credential with it, once.
import { newId, type TransferApproval, type TransferApprovalId } from '@taalcut/core';
import { PairingFailed } from '../errors';
import type { HttpResult } from '../http/dispatch';
import { TRANSFER_LIMITS } from '../limits';
import { sha256 } from '../pairing/devices';
import { describeDevice, safeEqual } from '../pairing/secrets';
import { grantBody, grantDevice, json, limited, listening, notePairFailure } from './admission';
import type { SessionBox } from './box';
import { toApproval, type LiveApproval, type LiveSession } from './live';

const TICKET = /^[A-Za-z0-9_-]{43}$/;

/** `POST /api/pair/ask { token }`: 202 with the phone's ticket and match code, or why not. */
export async function askApproval(
  box: SessionBox,
  ip: string,
  userAgent: string,
  body: unknown,
): Promise<HttpResult> {
  const session = listening(box);
  if (!session) return { status: 404 };
  const paced =
    limited(box, `pair:${ip}`, TRANSFER_LIMITS.pairPerSecond, 1_000) ??
    limited(box, `ask:${ip}`, TRANSFER_LIMITS.approvalAsksPerMinute, 60_000);
  if (paced) return paced;
  const token = field(body, 'token');
  if (!token || !safeEqual(token, session.secrets.token)) {
    notePairFailure(box, session);
    return { status: 401 };
  }
  if (session.devices.size >= TRANSFER_LIMITS.maxDevices) return { status: 403 };
  const ua = userAgent.slice(0, 400);
  const waiting = pendingOf(box, session);
  // The same phone asking again (a reload lost its ticket) replaces its own request; anyone else waits their turn.
  if (waiting && (waiting.address !== ip || waiting.userAgent !== ua)) return json(409, { reason: 'busy' });
  if (waiting) finish(box, session, waiting, 'withdrawn');
  const ticket = box.random.bytes(32).toString('base64url');
  const now = box.deps.clock.now();
  const described = describeDevice(ua);
  const approval: LiveApproval = {
    id: newId<'TransferApproval'>(),
    ticketHash: sha256(ticket),
    state: 'pending',
    label: described.label,
    platform: described.platform,
    userAgent: ua,
    address: ip.slice(0, 45),
    matchCode: String(box.random.int(100)).padStart(2, '0'),
    requestedAt: now,
    expiresAt: now + TRANSFER_LIMITS.approvalTtlMs,
    lastPolledAt: now,
    grant: null,
    told: false,
    timer: null,
  };
  keep(session, approval);
  approval.timer = setInterval(() => sweep(box, session, approval), TRANSFER_LIMITS.approvalPollMs);
  approval.timer.unref?.();
  box.armIdle(session);
  emit(session, approval);
  box.log(`approval ${approval.id} asked`);
  return json(202, {
    ticket,
    matchCode: approval.matchCode,
    address: approval.address,
    expiresInMs: TRANSFER_LIMITS.approvalTtlMs,
    pollMs: TRANSFER_LIMITS.approvalPollMs,
  });
}

/** `POST /api/pair/wait { ticket }`: how the request stands; an answer is told once, the credential with it. */
export function waitApproval(box: SessionBox, ip: string, body: unknown): HttpResult {
  const session = listening(box);
  if (!session) return { status: 404 };
  const paced = limited(box, `wait:${ip}`, TRANSFER_LIMITS.approvalWaitsPerMinute, 60_000);
  if (paced) return paced;
  const approval = byTicket(session, body);
  if (!approval || approval.told) return { status: 404 };
  sweep(box, session, approval);
  const now = box.deps.clock.now();
  approval.lastPolledAt = now;
  if (approval.state === 'pending') {
    return json(200, { state: 'pending', expiresInMs: Math.max(0, approval.expiresAt - now) });
  }
  approval.told = true;
  stopTimer(approval);
  if (approval.state === 'allowed' && approval.grant) {
    const grant = approval.grant;
    approval.grant = null;
    return json(200, { state: 'allowed', ...grantBody(grant) });
  }
  // A request that went quiet and was let go reads to the phone as one that lapsed: it asks again.
  return json(200, { state: approval.state === 'denied' ? 'denied' : 'expired' });
}

/** `POST /api/pair/cancel { ticket }`: the phone stopped asking (it chose the PIN, or left the page). */
export function cancelApproval(box: SessionBox, ip: string, body: unknown): HttpResult {
  const session = listening(box);
  if (!session) return { status: 404 };
  const paced = limited(box, `wait:${ip}`, TRANSFER_LIMITS.approvalWaitsPerMinute, 60_000);
  if (paced) return paced;
  const approval = byTicket(session, body);
  if (!approval || approval.told) return { status: 404 };
  approval.told = true;
  if (approval.state === 'pending') finish(box, session, approval, 'withdrawn');
  approval.grant = null;
  stopTimer(approval);
  return { status: 204 };
}

/** A person's Allow or Deny, from the window that opened the session. Too late, it says how the request ended. */
export async function answerApproval(
  box: SessionBox,
  session: LiveSession,
  approvalId: TransferApprovalId,
  allow: boolean,
): Promise<TransferApproval> {
  const approval = session.approvals.get(approvalId);
  if (!approval) throw PairingFailed();
  sweep(box, session, approval);
  if (approval.state !== 'pending') return toApproval(session, approval);
  if (!allow) {
    finish(box, session, approval, 'denied');
    // A refusal is a failed pairing: a QR that keeps drawing strangers gets replaced.
    notePairFailure(box, session);
    return toApproval(session, approval);
  }
  if (session.devices.size >= TRANSFER_LIMITS.maxDevices) {
    finish(box, session, approval, 'denied');
    return toApproval(session, approval);
  }
  approval.grant = await grantDevice(box, session, approval.userAgent);
  approval.lastPolledAt = box.deps.clock.now();
  finish(box, session, approval, 'allowed');
  return toApproval(session, approval);
}

/** Lapses a request past its minute, or one whose phone stopped asking; forgets an Allow nobody collected. */
function sweep(box: SessionBox, session: LiveSession, approval: LiveApproval): void {
  const now = box.deps.clock.now();
  const quiet = now - approval.lastPolledAt > TRANSFER_LIMITS.approvalAbandonMs;
  if (approval.state === 'pending') {
    if (now >= approval.expiresAt) finish(box, session, approval, 'expired');
    else if (quiet) finish(box, session, approval, 'withdrawn');
    return;
  }
  if (approval.told || quiet) {
    approval.grant = null;
    stopTimer(approval);
  }
}

function finish(
  box: SessionBox,
  session: LiveSession,
  approval: LiveApproval,
  state: Exclude<LiveApproval['state'], 'pending'>,
): void {
  approval.state = state;
  // An Allow keeps looking until the phone collects its credential or goes quiet; anything else is over.
  if (state !== 'allowed') stopTimer(approval);
  emit(session, approval);
  box.log(`approval ${approval.id} ${state}`);
}

function pendingOf(box: SessionBox, session: LiveSession): LiveApproval | null {
  for (const approval of session.approvals.values()) {
    if (approval.state !== 'pending') continue;
    sweep(box, session, approval);
    if (approval.state === 'pending') return approval;
  }
  return null;
}

/** Remembers a request; the oldest settled ones go once there are more than `approvalsKept`. */
function keep(session: LiveSession, approval: LiveApproval): void {
  session.approvals.set(approval.id, approval);
  for (const [id, old] of session.approvals) {
    if (session.approvals.size <= TRANSFER_LIMITS.approvalsKept) break;
    if (old.state === 'pending' || old.timer) continue;
    session.approvals.delete(id);
  }
}

function byTicket(session: LiveSession, body: unknown): LiveApproval | null {
  const ticket = field(body, 'ticket');
  if (!ticket || !TICKET.test(ticket)) return null;
  const hash = sha256(ticket);
  for (const approval of session.approvals.values())
    if (safeEqual(hash, approval.ticketHash)) return approval;
  return null;
}

function emit(session: LiveSession, approval: LiveApproval): void {
  session.queue.push({ type: 'approval', approval: toApproval(session, approval) });
}

function stopTimer(approval: LiveApproval): void {
  if (approval.timer) clearInterval(approval.timer);
  approval.timer = null;
}

function field(body: unknown, name: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[name];
  return typeof value === 'string' && value.length > 0 && value.length <= 200 ? value : null;
}
