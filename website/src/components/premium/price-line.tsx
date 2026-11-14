// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Premium price line · the plan's price, as the billing service quotes it
 * mode: Persuade · system: WEB2 Remix Vernacular
 * states: list (the server HTML, and whenever no quote is in or orders are closed: the list price a month) · quoted
 *   (the service's price a month, in the quote's currency: "₹37,600" for a quote in rupees) · launch price (the quoted
 *   price for the first month, the list price struck through beside it and named for assistive technology, then the
 *   offer's name, when it ends in the visitor's own time zone, and what later months cost: the quote's list price).
 *   `live` makes it a polite live region: the order form's copy says the amount about to be charged, and says it
 *   again if the price or its currency moves.
 * Not a control. Money and the moment are written by `Intl` (lib/billing/money). */

import { LIST_PRICE, OFFER, PER_MONTH, offerName } from '#content/premium';
import { money, momentWords } from '#lib/billing/money';
import { cn } from '#lib/cn';
import { usePremiumQuote } from './quote-context';

export function PriceLine({
  live = false,
  className,
}: {
  readonly live?: boolean;
  readonly className?: string;
}) {
  const { state } = usePremiumQuote();
  const quote = state.status === 'ready' ? state.quote : null;
  const offer = quote && quote.amount < quote.listAmount ? quote.offer : null;
  return (
    <div
      data-slot="premium-price"
      data-offer={offer?.id}
      aria-live={live ? 'polite' : undefined}
      aria-atomic={live ? true : undefined}
      className={cn('flex flex-col gap-2', className)}
    >
      <p className="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span data-slot="price-amount" className="type-site-display text-ink">
          {quote ? money(quote.amount, quote.currency) : LIST_PRICE}
        </span>
        {quote && offer ? (
          <s data-slot="price-list" className="type-site-subhead text-ink-2 decoration-2">
            <span className="sr-only">{OFFER.list} </span>
            {money(quote.listAmount, quote.currency)}
          </s>
        ) : null}
        <span className="type-site-lead text-ink-2">{offer ? OFFER.first : PER_MONTH}</span>
      </p>
      {quote && offer ? (
        <p data-slot="price-offer" className="m-0 max-w-[30em] type-body text-pretty text-ink-2">
          {OFFER.until(offerName(offer.id), momentWords(offer.endsAt))}{' '}
          {OFFER.later(money(quote.listAmount, quote.currency))}
        </p>
      ) : null}
    </div>
  );
}
