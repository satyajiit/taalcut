// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

import { type RefObject, useCallback, useRef, useState } from 'react';
import { PREMIUM } from '#content/premium';
import type { BillingFailure } from '#lib/billing/api';
import {
  type OrderAnswers,
  type OrderField,
  type OrderProblem,
  checkoutRequest,
  orderProblems,
  refusedFields,
} from '#lib/billing/order';
import { usePremiumQuote } from './quote-context';

export type OrderStatus = 'idle' | 'pricing' | 'submitting' | 'leaving';

/** A refusal the form says in one line under its button; `retry` when trying again is the fix. */
export interface OrderNotice {
  readonly failure: BillingFailure;
  readonly retry: boolean;
}

/** Refusals whose fix is the same order, sent again. */
const RETRIES: ReadonlySet<BillingFailure['kind']> = new Set([
  'busy',
  'provider-unavailable',
  'offline',
  'timeout',
  'unreachable',
  'unexpected',
]);

const EMPTY: OrderAnswers = { name: '', email: '', whatsapp: '', channel: '', agreed: false };

/**
 * The order form's send. Answers are checked first (a problem stays on its field and sends nothing). The order then
 * carries the amount the page shows; the billing service answers with the payment page, and the browser goes there.
 * A price that moved comes back as the new price for the visitor to read: the form never sends twice by itself.
 */
export function useOrder(
  fields: Readonly<Record<OrderField, RefObject<HTMLInputElement | null>>>,
  leave: (payUrl: string) => void,
) {
  const { client, settled, reprice, close } = usePremiumQuote();
  const [answers, setAnswers] = useState<OrderAnswers>(EMPTY);
  const [status, setStatus] = useState<OrderStatus>('idle');
  const [problems, setProblems] = useState<readonly OrderProblem[]>([]);
  const [notice, setNotice] = useState<OrderNotice | null>(null);
  const busy = useRef(false);

  const update = useCallback(<K extends OrderField>(field: K, value: OrderAnswers[K]) => {
    setAnswers((now) => ({ ...now, [field]: value }));
    // Typing clears that field's problem: a field never scolds while someone is still writing.
    setProblems((now) => (now.some((p) => p.field === field) ? now.filter((p) => p.field !== field) : now));
  }, []);

  const show = useCallback(
    (found: readonly OrderProblem[]) => {
      setProblems(found);
      const first = found[0];
      if (first) fields[first.field].current?.focus();
    },
    [fields],
  );

  const send = useCallback(async () => {
    if (busy.current) return;
    const found = orderProblems(answers);
    if (found.length > 0) {
      setNotice(null);
      show(found);
      return;
    }
    busy.current = true;
    setNotice(null);
    setStatus('pricing');
    // The price the page shows, once the service has answered; a closed service has swapped the form out by now.
    const quoted = await settled();
    if (quoted.status !== 'ready') {
      busy.current = false;
      setStatus('idle');
      return;
    }
    const request = checkoutRequest(answers, {
      plan: PREMIUM.plan,
      ref: quoted.tag,
      expect: quoted.quote.amount,
    });
    if (!request) {
      busy.current = false;
      setStatus('idle');
      return;
    }
    setStatus('submitting');
    const result = await client.checkout(request);
    if (result.ok) {
      // The button stays busy while the browser leaves for the payment page.
      setStatus('leaving');
      leave(result.value.payUrl);
      return;
    }
    busy.current = false;
    setStatus('idle');
    const { failure } = result;
    // Orders are off, or the service refuses this page: trying again can't help, so the address takes over.
    if (failure.kind === 'not-selling' || failure.kind === 'forbidden') {
      close();
      return;
    }
    if (failure.kind === 'price-changed' && failure.quote) reprice(failure.quote);
    const refused = failure.kind === 'invalid' ? refusedFields(failure.problems ?? []) : [];
    if (refused.length > 0) show(refused);
    else setNotice({ failure, retry: RETRIES.has(failure.kind) });
  }, [answers, client, close, leave, reprice, settled, show]);

  /** Back to rest: the browser returned to this page after leaving for the payment page. */
  const rest = useCallback(() => {
    busy.current = false;
    setStatus('idle');
  }, []);

  return { answers, update, send, status, problems, notice, rest } as const;
}
