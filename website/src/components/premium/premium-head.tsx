// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: Premium head · the top of /premium/: what the plan is, and its price card
 * mode: Persuade · system: WEB2 Remix Vernacular (the display h1 in two lines, three stickers carrying facts the lead
 *   and the card also say in words, and the price as a reel-cornered card with a stories bar over it and Kaatu on its
 *   edge, as /waitlist/ draws its card)
 * states: the price line's own (list · quoted · launch price) · the way to the order form: an outlined link (default:
 *   ink edge · hover and active: fills with ink · focus: base ring). The stickers pop in once; under reduced motion
 *   all rest. A server component: the price line and the arrivals are its client parts.
 * The page's one marigold fill is the order form's button, a screen below: this link only leads to it. */

import { ArrowDown, Check } from 'lucide-react';
import { PageArrival } from '#components/contact/page-arrival';
import { Kaatu } from '#components/kaatu/kaatu';
import { SegmentBar } from '#components/ui/segment-bar';
import { Sticker } from '#components/ui/sticker';
import { ORDER, PREMIUM_PAGE } from '#content/premium';
import type { SlotRole } from '#content/schema';
import { ICON_STROKE } from '#lib/icons';
import { PriceLine } from './price-line';

const P = PREMIUM_PAGE;

/** The stories bar over the card: one equal part a fact, the motif only. */
const STORY: { start: number; end: number; group: SlotRole }[] = P.card.facts.map((_, i) => ({
  start: i,
  end: i + 1,
  group: (['hook', 'build', 'peak', 'outro'] as const)[i] ?? 'build',
}));

/** The link to the order form: the header's outlined Download, a size up. */
const ORDER_LINK =
  'inline-flex h-12 items-center justify-center gap-2 whitespace-nowrap rounded-pill border-[1.5px] border-ink px-6 type-label font-semibold text-ink ' +
  'transition-[background-color,color,transform] duration-(--dur-micro) ease-(--ease-out) hover:bg-inverse hover:text-on-inverse ' +
  'active:scale-[0.98] active:bg-inverse active:text-on-inverse motion-reduce:active:scale-100';

export function PremiumHead() {
  return (
    <div className="mx-auto grid max-w-site grid-cols-1 gap-x-16 gap-y-20 overflow-x-clip px-gutter pt-10 pb-section-bottom sm:pt-14 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
      <PageArrival className="flex min-w-0 flex-col gap-6">
        <h1 className="m-0 type-site-display text-balance text-ink">
          {P.title.map((line, i) => (
            <span key={line} className="block">
              {i > 0 ? ' ' : null}
              {line}
            </span>
          ))}
        </h1>
        <div aria-hidden className="-mt-1 flex flex-wrap items-center gap-2">
          <Sticker field="lime" icon="gift" tilt={-4}>
            {P.stickers.monthly}
          </Sticker>
          <Sticker field="violet" icon="model" tilt={3} delay={0.06}>
            {P.stickers.models}
          </Sticker>
          <Sticker field="paper" icon="approve" tilt={-2} delay={0.12}>
            {P.stickers.active}
          </Sticker>
        </div>
        <p className="m-0 max-w-[34em] type-site-lead text-ink-2">{P.lead}</p>
      </PageArrival>

      <PageArrival delay={0.1} className="self-start lg:mt-16">
        <aside
          aria-labelledby="premium-plan"
          data-slot="premium-card"
          className="relative rounded-reel bg-panel px-5 pt-14 pb-8 sm:px-8"
        >
          <Kaatu
            mood="wave"
            size={112}
            toward="left"
            interactive
            sticker
            className="absolute -top-16 end-6"
          />
          <SegmentBar segments={STORY} state="filled" tone="surface" decorative className="mb-6" />
          <h2 id="premium-plan" className="m-0 type-site-subhead text-ink">
            {P.card.heading}
          </h2>
          <PriceLine className="mt-3" />
          <ul className="m-0 mt-6 flex list-none flex-col gap-3 p-0">
            {P.card.facts.map((fact) => (
              <li key={fact} className="flex items-start gap-3 type-site-body text-pretty text-ink-2">
                <span aria-hidden className="inline-flex h-[1lh] shrink-0 items-center text-teal-strong">
                  <Check strokeWidth={ICON_STROKE + 0.5} className="size-5" />
                </span>
                <span className="min-w-0">{fact}</span>
              </li>
            ))}
          </ul>
          <a href={`#${ORDER.id}`} data-slot="order-jump" className={`${ORDER_LINK} mt-8`}>
            {P.card.order}
            <ArrowDown aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
          </a>
        </aside>
      </PageArrival>
    </div>
  );
}
