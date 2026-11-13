// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a feature page's answer-first header · mode: Persuade · system: WEB2 Remix Vernacular
 * states: resting (the server HTML: every word and sticker shown) · the stickers pop and settle once on load and lean
 *   toward a fine pointer · Kaatu plays its pose once and reacts to a click · reduced motion (all resting). Nothing
 *   here is a control.
 * The feature's name as the page's h1, on its own (no icon tile beside it: the stickers carry the page's marks), its
 * one-sentence definition straight under it (what search and AI engines quote), and its key facts as a hand-placed run
 * of stickers with Kaatu at their end. The facts in full sit further down the page, in words. */

import { Kaatu } from '#components/kaatu/kaatu';
import { Sticker } from '#components/ui/sticker';
import { AiMark } from '#components/brand/ai-mark';
import { cn } from '#lib/cn';
import { lookOf } from './look';

/** Each sticker's tilt and where it sits in the run on a wide screen: a hand-placed stack, never a row of chips. */
const PLACES = [
  { tilt: -4, at: 'lg:ms-0' },
  { tilt: 3, at: 'lg:ms-16' },
  { tilt: -2, at: 'lg:ms-6' },
] as const;

export interface FeatureHeaderProps {
  readonly title: string;
  readonly lead: string;
  /** The feature's slug, or 'index' for the features index: its look (look.tsx). */
  readonly lookKey: string;
  readonly stickers: readonly string[];
}

export function FeatureHeader({ title, lead, lookKey, stickers }: FeatureHeaderProps) {
  const look = lookOf(lookKey);
  return (
    <header data-slot="feature-header" className="px-gutter pt-10 pb-12 sm:pt-14 sm:pb-16">
      <div className="mx-auto grid max-w-site grid-cols-1 items-end gap-x-10 gap-y-8 lg:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-8">
          <h1 className="max-w-[13ch] type-site-display text-balance text-ink">{title}</h1>
          <p className="m-0 max-w-[38em] type-site-lead text-pretty text-ink-2">{lead}</p>
        </div>
        <div className="relative flex min-w-0 flex-wrap items-center gap-x-3 gap-y-3 lg:col-span-4 lg:flex-col lg:items-start lg:gap-4 lg:pb-2">
          {stickers.map((words, i) => {
            const style = look.stickers[i];
            const place = PLACES[i % PLACES.length] ?? PLACES[0];
            const icon = style?.icon;
            return (
              <span key={words} className={cn('inline-flex', place.at)}>
                <Sticker
                  field={style?.field ?? 'paper'}
                  size="lg"
                  tilt={place.tilt}
                  delay={0.12 + i * 0.09}
                  {...(icon === 'ai' ? { mark: <AiMark className="size-full" /> } : icon ? { icon } : {})}
                >
                  {words}
                </Sticker>
              </span>
            );
          })}
          <Kaatu
            pose={look.pose}
            size={104}
            interactive
            sticker
            className="ms-auto -mt-20 sm:mt-0 lg:-mt-10 lg:self-end"
          />
        </div>
      </div>
    </header>
  );
}
