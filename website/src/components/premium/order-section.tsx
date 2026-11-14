// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: Premium order section · the close of /premium/: the price about to be charged, and the order form
 * mode: Persuade · system: WEB2 Remix Vernacular (the download band's reel-cornered panel, Kaatu standing on its top
 *   edge; here it holds the page's one marigold fill, the form's Continue to payment)
 * states: the price line's (list · quoted · launch price, said again to assistive technology when it moves) · the
 *   currency switch's (currency-switch.tsx), under the price when the quote lists more than one currency · the
 *   form's own (order-form.tsx), or its closed sentence · without JavaScript: the form hides, and one line says it
 *   needs JavaScript, with the address. A server component: the price line, the switch and the form are its client
 *   parts. */

import { InlineText } from '#components/content/inline-text';
import { Kaatu } from '#components/kaatu/kaatu';
import { ORDER } from '#content/premium';
import { CurrencySwitch } from './currency-switch';
import { OrderForm } from './order-form';
import { PriceLine } from './price-line';

const HEADING = 'premium-order';
const NO_SCRIPT_STYLE = 'form[data-slot="order-form"]{display:none!important}';

export function OrderSection() {
  return (
    <section
      id={ORDER.id}
      aria-labelledby={HEADING}
      data-slot="premium-order"
      className="scroll-mt-24 px-gutter pt-section-top pb-section-bottom"
    >
      <div className="relative mx-auto max-w-site rounded-reel bg-panel px-5 pt-16 pb-10 sm:px-10 lg:px-16 lg:pt-20 lg:pb-14">
        <Kaatu
          pose="laptop"
          size={112}
          interactive
          sticker
          className="absolute -top-14 start-4 sm:start-10 lg:start-14"
        />
        <div className="grid grid-cols-1 items-start gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <h2 id={HEADING} className="m-0 type-site-headline text-balance text-ink">
              {ORDER.heading}
            </h2>
            <div className="flex flex-col gap-3">
              <PriceLine live />
              <CurrencySwitch />
            </div>
            <p className="m-0 max-w-[30em] type-site-body text-pretty text-ink-2">{ORDER.lead}</p>
          </div>
          <div className="flex min-w-0 flex-col gap-6">
            {/* Without JavaScript the form can't send, so it hides and one sentence with the address stands in its place. */}
            <noscript>
              <style>{NO_SCRIPT_STYLE}</style>
              <p className="m-0 max-w-[34em] type-site-body text-pretty text-ink">
                <InlineText text={ORDER.noScript} />
              </p>
            </noscript>
            <OrderForm labelledBy={HEADING} />
          </div>
        </div>
      </div>
    </section>
  );
}
