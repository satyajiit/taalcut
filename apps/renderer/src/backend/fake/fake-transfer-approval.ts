// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The fake transfer's 'approval' scenario (UX3): the scripted phone opened the QR's link, so it asks to pair and
 * only the person's Allow on the computer lets it in. It asks on step 3 of the session; allowed, it goes on as the
 * 'phone' scenario does from its pairing step; denied, or unanswered for `ttlMs`, nothing connects. As the server,
 * the stream sends the request when it arrives and again each time its state changes.
 */
import { newId, NotFoundError, toRpcError, type Id, type TransferApproval } from '@taalcut/core';

/** The step the phone asks on. */
const ASKS_AT = 3;
/** The 'phone' script's step where the phone pairs: an allowed phone carries on from there. */
const PHONE_PAIRS_AT = 6;

export function createFakeApproval(ttlMs: number) {
  let approval: TransferApproval | null = null;
  /** Whether the stream has sent the request's latest state. */
  let sent = true;
  /** The session's step the phone was allowed on. */
  let allowedAt: number | null = null;

  const settle = (state: TransferApproval['state']) => {
    if (!approval || approval.state !== 'pending') return;
    approval = { ...approval, state };
    sent = false;
  };
  const lapse = () => {
    if (approval?.state === 'pending' && Date.now() >= approval.expiresAt) settle('expired');
  };

  return {
    /** A new session: no request yet. */
    reset() {
      approval = null;
      sent = true;
      allowedAt = null;
    },
    /** Milliseconds until a waiting request lapses (the session's next step comes no later); Infinity with none. */
    lapsesIn: () =>
      approval?.state === 'pending' ? Math.max(0, approval.expiresAt - Date.now()) : Number.POSITIVE_INFINITY,
    /**
     * One step of the session: the request's new state, if any, for the stream, and once the phone is allowed, the
     * step of the 'phone' script it is on (null until then).
     */
    step(step: number, sessionId: Id<'TransferSession'>) {
      const now = Date.now();
      if (step === ASKS_AT && !approval) {
        approval = {
          id: newId<'TransferApproval'>(),
          sessionId,
          state: 'pending',
          device: { label: 'iPhone', platform: 'ios' },
          address: '192.168.1.31',
          matchCode: '47',
          requestedAt: now,
          expiresAt: now + ttlMs,
        };
        sent = false;
      }
      lapse();
      const changed = approval && !sent ? approval : null;
      sent = true;
      if (approval?.state === 'allowed') allowedAt ??= step;
      return { changed, phoneStep: allowedAt === null ? null : PHONE_PAIRS_AT + step - allowedAt };
    },
    /** The person's Allow or Deny; too late, the request as it lapsed. */
    answer(approvalId: Id<'TransferApproval'>, allow: boolean): TransferApproval {
      if (!approval || approval.id !== approvalId)
        throw toRpcError(NotFoundError({ entity: 'approval', id: approvalId }));
      lapse();
      settle(allow ? 'allowed' : 'denied');
      return approval;
    },
    current: () => approval,
  };
}
