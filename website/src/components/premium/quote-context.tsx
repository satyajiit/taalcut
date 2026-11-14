// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Premium quote · the price /premium/ shows, asked of the billing service once when the page opens
 * mode: Persuade · system: WEB2 Remix Vernacular
 * states: checking (the server HTML: the list price, the form as it is) · ready (the service's quote: the price it
 *   named, a launch price when it carries one; orders open) · closed (the service says it isn't selling, didn't
 *   answer, or sent something else: the list price stays and the form gives way to the address)
 * Not a control: it holds the quote for the price lines and the order form, so both show one price. The page never
 * works a price out; an order sends back the amount it showed. */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { PREMIUM } from '#content/premium';
import type { Quote } from '#lib/billing/api';
import { type BillingClient, createBillingClient } from '#lib/billing/client';
import { refFor } from '#lib/billing/ref';

export type QuoteState =
  | { readonly status: 'checking' }
  | { readonly status: 'ready'; readonly quote: Quote; readonly tag: string | null }
  | { readonly status: 'closed' };

interface QuoteContext {
  readonly state: QuoteState;
  readonly client: BillingClient;
  /** The state once the first answer is in: an order sent while the price is still being checked waits for it. */
  settled(): Promise<QuoteState>;
  /** The service's newer quote, after it refused an order whose price had moved. */
  reprice(quote: Quote): void;
  /** The service stopped taking orders. */
  close(): void;
}

const Context = createContext<QuoteContext | null>(null);

const stateFor = (quote: Quote, tag: string | null): QuoteState =>
  quote.selling ? { status: 'ready', quote, tag } : { status: 'closed' };

export function QuoteProvider({
  children,
  client: given,
}: {
  readonly children: ReactNode;
  readonly client?: BillingClient;
}) {
  const client = useMemo(() => given ?? createBillingClient(), [given]);
  const [state, setState] = useState<QuoteState>({ status: 'checking' });
  /** The newest state, for an order sent between renders, and the first answer while it is still out. */
  const latest = useRef<QuoteState>({ status: 'checking' });
  const first = useRef<Promise<QuoteState> | null>(null);
  const apply = useCallback((next: QuoteState) => {
    latest.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    let current = true;
    const tag = refFor(window.location.search);
    const asked = client
      .quote(PREMIUM.plan, tag)
      .then((result): QuoteState => (result.ok ? stateFor(result.value, tag) : { status: 'closed' }));
    first.current = asked.then((next) => {
      if (current) apply(next);
      // A price that moved meanwhile is the one an order carries.
      return latest.current.status === 'checking' ? next : latest.current;
    });
    return () => {
      current = false;
    };
  }, [apply, client]);

  const settled = useCallback(
    () =>
      latest.current.status === 'checking'
        ? (first.current ?? Promise.resolve<QuoteState>({ status: 'closed' }))
        : Promise.resolve(latest.current),
    [],
  );
  const reprice = useCallback(
    (quote: Quote) => apply(stateFor(quote, latest.current.status === 'ready' ? latest.current.tag : null)),
    [apply],
  );
  const close = useCallback(() => apply({ status: 'closed' }), [apply]);
  const value = useMemo(
    () => ({ state, client, settled, reprice, close }),
    [state, client, settled, reprice, close],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePremiumQuote(): QuoteContext {
  const context = useContext(Context);
  if (!context) throw new Error('usePremiumQuote needs a QuoteProvider above it');
  return context;
}
