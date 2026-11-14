// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Premium quote · the price /premium/ shows, asked of the billing service when the page opens
 * mode: Persuade · system: WEB2 Remix Vernacular
 * states: checking (the server HTML: the list price, the form as it is) · ready (the service's quote: the price it
 *   named in the currency it picked for the visitor's country, a launch price when it carries one; orders open) ·
 *   closed (the service says it isn't selling, didn't answer, or sent something else: the list price stays and the
 *   form gives way to the address) · a change of currency: asking (the price shown stays) · failed (it stays, and the
 *   switch says so)
 * Not a control: it holds the quote for the price lines, the currency switch and the order form, so all show one
 * price. The page never works a price out or converts one; an order sends back the amount and the currency it showed. */

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
import { currencyToAsk, rememberCurrency } from '#lib/billing/currency';
import { refFor } from '#lib/billing/ref';

export type QuoteState =
  | { readonly status: 'checking' }
  | { readonly status: 'ready'; readonly quote: Quote; readonly tag: string | null }
  | { readonly status: 'closed' };

/** The currency switch: at rest, asking for the price in the chosen currency, or told the service didn't give it. */
export type CurrencyChange = 'idle' | 'asking' | 'failed';

interface QuoteContext {
  readonly state: QuoteState;
  readonly client: BillingClient;
  readonly change: CurrencyChange;
  /** An order is on its way: the currency stays as the order carries it. */
  readonly ordering: boolean;
  /** The state once every answer is in: an order sent while a price is still being asked for waits for it. */
  settled(): Promise<QuoteState>;
  /** The service's newer quote, after it refused an order whose price had moved. */
  reprice(quote: Quote): void;
  /** The service stopped taking orders. */
  close(): void;
  /** Asks for the price in another currency the quote lists. The price shown stays until the answer is in. */
  choose(currency: string): void;
  setOrdering(on: boolean): void;
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
  const [change, setChange] = useState<CurrencyChange>('idle');
  const [ordering, setOrdering] = useState(false);
  /** The newest state, for an order sent between renders, and the first answer while it is still out. */
  const latest = useRef<QuoteState>({ status: 'checking' });
  const first = useRef<Promise<QuoteState> | null>(null);
  /** A change of currency whose answer is still out. */
  const changing = useRef<Promise<QuoteState> | null>(null);
  const mounted = useRef(false);
  const apply = useCallback((next: QuoteState) => {
    latest.current = next;
    setState(next);
  }, []);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    const tag = refFor(window.location.search);
    // The first question names the currency: the one chosen earlier in this visit, or `auto` for the visitor's country.
    const asked = client
      .quote(PREMIUM.plan, tag, currencyToAsk())
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
      changing.current ??
      (latest.current.status === 'checking'
        ? (first.current ?? Promise.resolve<QuoteState>({ status: 'closed' }))
        : Promise.resolve(latest.current)),
    [],
  );
  const choose = useCallback(
    (currency: string) => {
      const now = latest.current;
      if (changing.current || now.status !== 'ready') return;
      if (now.quote.currency === currency || !now.quote.currencies.includes(currency)) return;
      setChange('asking');
      changing.current = client.quote(PREMIUM.plan, now.tag, currency).then((result): QuoteState => {
        changing.current = null;
        if (!mounted.current) return latest.current;
        if (!result.ok) {
          // The price shown stays the price: nothing was changed.
          setChange('failed');
          return latest.current;
        }
        // The choice lasts for the visit: the next quote asks in it.
        rememberCurrency(currency);
        setChange('idle');
        const next = stateFor(result.value, now.tag);
        apply(next);
        return next;
      });
    },
    [apply, client],
  );
  const reprice = useCallback(
    (quote: Quote) => apply(stateFor(quote, latest.current.status === 'ready' ? latest.current.tag : null)),
    [apply],
  );
  const close = useCallback(() => apply({ status: 'closed' }), [apply]);
  const value = useMemo(
    () => ({ state, client, change, ordering, settled, reprice, close, choose, setOrdering }),
    [state, client, change, ordering, settled, reprice, close, choose],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePremiumQuote(): QuoteContext {
  const context = useContext(Context);
  if (!context) throw new Error('usePremiumQuote needs a QuoteProvider above it');
  return context;
}
