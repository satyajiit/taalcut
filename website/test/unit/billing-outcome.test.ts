// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import type { Confirmation } from '#lib/billing/api';
import { OUTCOME_KEY, rememberOutcome, rememberedOutcome } from '#lib/billing/outcome';

/** A confirmed payment's outcome, kept for the tab so a reload of /premium/thanks/ still shows it. */

const PAID: Confirmation = {
  orderId: '01KA7Q3ZV5R8N2M4X6C9D1E3F5',
  status: 'paid',
  plan: 'premium',
  currency: 'USD',
  amount: 33900,
  paidAt: '2026-11-19T09:00:00.000Z',
  activateBy: '2026-11-26T09:00:00.000Z',
};

/** A session store in memory, as the browser's behaves. */
function store(initial: Record<string, string> = {}) {
  const held = new Map(Object.entries(initial));
  return {
    held,
    getItem: (key: string) => held.get(key) ?? null,
    setItem: (key: string, value: string) => {
      held.set(key, value);
    },
  };
}

describe('the kept outcome of a payment', () => {
  it('keeps a paid order under one key, and gives it back whole', () => {
    const session = store();
    rememberOutcome(PAID, session);
    expect([...session.held.keys()]).toEqual([OUTCOME_KEY]);
    expect(rememberedOutcome(session)).toEqual(PAID);
  });

  it('keeps the billing service’s answer and nothing else: no name, no address, none of the payment’s own values', () => {
    const session = store();
    rememberOutcome(PAID, session);
    expect(Object.keys(JSON.parse(session.held.get(OUTCOME_KEY)!) as object).sort()).toEqual(
      ['activateBy', 'amount', 'currency', 'orderId', 'paidAt', 'plan', 'status'].sort(),
    );
    // Something else found in the store never reaches the page: what is read is checked like any answer.
    const padded = store({
      [OUTCOME_KEY]: JSON.stringify({ ...PAID, name: 'Asha Rao', signature: 'a'.repeat(64) }),
    });
    expect(rememberedOutcome(padded)).toEqual(PAID);
  });

  it('keeps only a confirmed payment', () => {
    for (const status of ['pending', 'expired', 'cancelled'] as const) {
      const session = store();
      rememberOutcome({ ...PAID, status, paidAt: null, activateBy: null }, session);
      expect(session.held.size, status).toBe(0);
      // And one written by hand is not shown as paid.
      const forged = store({
        [OUTCOME_KEY]: JSON.stringify({ ...PAID, status, paidAt: null, activateBy: null }),
      });
      expect(rememberedOutcome(forged), status).toBeNull();
    }
  });

  it('remembers nothing from an empty, broken or blocked store, and never throws', () => {
    expect(rememberedOutcome(store())).toBeNull();
    expect(rememberedOutcome(null)).toBeNull();
    for (const raw of [
      '',
      'not json',
      '[]',
      'null',
      '{"status":"paid"}',
      JSON.stringify({ ...PAID, amount: 'free' }),
    ]) {
      expect(rememberedOutcome(store({ [OUTCOME_KEY]: raw })), raw).toBeNull();
    }
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(rememberedOutcome(blocked)).toBeNull();
    expect(() => rememberOutcome(PAID, blocked)).not.toThrow();
    expect(() => rememberOutcome(PAID, null)).not.toThrow();
  });
});
