// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: currency switch · one quiet line under the order's price: what the prices are in, and the way to pay in
 *   the other currency ("Prices in Indian rupees. Pay in US dollars instead")
 * mode: Persuade · system: WEB2 Remix Vernacular · DESIGN.md (Feedback: the retry button's text-button face)
 * states: absent (no quote, orders closed, or a quote that lists one currency) · default · the button: hover
 *   (underline ink) · focus (base ring) · active (words ink-2) · asking (its words become "Getting that price…",
 *   aria-busy; the price shown stays) · failed (one line under it says so, politely; the button tries again) · held
 *   while an order is on its way (aria-disabled, dimmed)
 * Choosing asks the billing service for the price in that currency: the page never converts one. The button keeps its
 * place and its focus when the line turns round. The choice lasts for the visit, in memory only
 * (lib/billing/currency), and goes with the order. Only the order section has one: the price card above follows it. */

import { CURRENCY, currencyName } from '#content/premium';
import { cn } from '#lib/cn';
import { usePremiumQuote } from './quote-context';

const BUTTON =
  '-my-px inline-flex min-h-6 items-center whitespace-nowrap rounded-sm align-top text-ink underline ' +
  'decoration-rule-strong decoration-1 underline-offset-4 transition-colors duration-(--dur-micro) ' +
  'hover:decoration-ink active:text-ink-2 ' +
  'aria-disabled:cursor-default aria-disabled:text-ink-2 aria-disabled:decoration-rule';

export function CurrencySwitch({ className }: { readonly className?: string }) {
  const { state, change, ordering, choose } = usePremiumQuote();
  if (state.status !== 'ready' || state.quote.currencies.length < 2) return null;
  const { currency, currencies } = state.quote;
  const asking = change === 'asking';
  const held = asking || ordering;
  return (
    <div
      data-slot="price-currency"
      data-currency={currency}
      data-state={change}
      className={cn('type-body text-pretty text-ink-2', className)}
    >
      <p className="m-0">
        {CURRENCY.shown(currencyName(currency))}{' '}
        {currencies
          .filter((code) => code !== currency)
          .map((code, i) => (
            // Keyed by place, so the one button stays in the page, and keeps focus, when the currencies change sides.
            <span key={i}>
              {i > 0 ? ' · ' : null}
              <button
                type="button"
                data-currency={code}
                aria-disabled={held || undefined}
                aria-busy={asking || undefined}
                onClick={() => {
                  if (!held) choose(code);
                }}
                className={BUTTON}
              >
                {asking ? CURRENCY.asking : CURRENCY.pay(currencyName(code))}
              </button>
            </span>
          ))}
      </p>
      {/* Always in the page, so a failure is said when it appears; empty, it takes no room. */}
      <p role="status" className={cn('m-0 text-ink', change === 'failed' && 'mt-1')}>
        {change === 'failed' ? CURRENCY.failed : null}
      </p>
    </div>
  );
}
