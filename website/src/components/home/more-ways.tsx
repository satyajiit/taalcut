// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: More ways to make · mode: Persuade · system: WEB2 Remix Vernacular
 * Hallmark · pre-emit critique: P4 H4 E4 S5 R4 V4
 * states: arrived (server HTML, on screen at load, reduced motion: every drawing finished) · arriving (the heading and
 *   lead rise in, then each item as it comes on screen, and each drawing plays its own run once; a mouse or trackpad
 *   over a drawing plays it again) · the links' own states (MoreLink, MoreItem) · the stickers pop and lean · Kaatu
 *   carries a film strip on the lead drawing's edge, looking about (decoration, never focusable).
 * The six features beyond the reel pass, after the tour and before the starter formats, on the canvas between two
 *   sunken grounds. Never a grid of equal cards: from 1024 px the heading and lead hold the left five columns beside
 *   the lead item (Bring your footage in, the widest drawing); then a row of seven and five (shorts, Edits), a row of
 *   five and seven (launch videos, a video per feature), and plugins across the width, its words beside its drawing.
 *   Two columns from 768 px, one below, words under each drawing. Each item: its drawing of the feature working in the
 *   app's own labels, a sticker or a brand's own icon where one earns its place, its glyph chip, its name as the link
 *   to its page, and one line. */

import { motion } from 'motion/react';
import { type ComponentType, type ReactNode, useId, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { Kaatu } from '#components/kaatu/kaatu';
import { lookOf } from '#components/showcase/look';
import { ARRIVE_ITEM } from '#components/ui/section';
import { Sticker, type StickerProps } from '#components/ui/sticker';
import { FEATURE_STICKERS, FEATURES } from '#content/features';
import { MORE_WAYS } from '#content/home';
import type { Feature } from '#content/schema';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ARRIVE } from '#lib/motion';
import { MoreLink } from './kit';
import { EditsDrawing } from './more-edits';
import { ImportDrawing } from './more-import';
import { MoreItem } from './more-item';
import { LaunchDrawing } from './more-launch';
import { PluginsDrawing } from './more-plugins';
import { ProductDrawing } from './more-product';
import { ShortsDrawing } from './more-shorts';

type Slug = keyof typeof MORE_WAYS.rows;

/** A sticker on a drawing's edge: one of the feature's own (FEATURE_STICKERS, in its look's field and glyph). */
interface Hang {
  readonly sticker: number;
  readonly where: string;
  readonly tilt: number;
  readonly brand?: StickerProps['brand'];
}

interface Place {
  readonly Drawing: ComponentType<{ readonly className?: string }>;
  /** The item's columns: two from 768 px, twelve from 1024. */
  readonly cols: string;
  /** The drawing's height floor from 1024 px, so a row's two drawings stand level. */
  readonly tray?: string;
  readonly hang?: Hang;
  readonly horizontal?: boolean;
}

const PLACES: Readonly<Record<Slug, Place>> = {
  import: { Drawing: ImportDrawing, cols: 'md:col-span-2 lg:col-span-7', hang: { sticker: 1, where: '-bottom-4 left-5', tilt: -4 } },
  shorts: { Drawing: ShortsDrawing, cols: 'lg:col-span-7', tray: 'lg:min-h-[17.5rem]' },
  'instagram-edits': {
    Drawing: EditsDrawing,
    cols: 'lg:col-span-5',
    tray: 'lg:min-h-[17.5rem]',
    hang: { sticker: 0, where: '-bottom-4 left-5', tilt: -3, brand: 'instagram' },
  },
  'launch-videos': { Drawing: LaunchDrawing, cols: 'lg:col-span-5', tray: 'lg:min-h-[18.5rem]', hang: { sticker: 1, where: '-top-4 right-5', tilt: -3 } },
  'product-videos': { Drawing: ProductDrawing, cols: 'lg:col-span-7', tray: 'lg:min-h-[18.5rem]' },
  plugins: { Drawing: PluginsDrawing, cols: 'md:col-span-2 lg:col-span-12', horizontal: true, hang: { sticker: 1, where: '-top-4 right-6', tilt: 3 } },
};

function hangOf(feature: Feature, hang: Hang | undefined): ReactNode {
  if (!hang) return null;
  const words = FEATURE_STICKERS[feature.slug]?.[hang.sticker];
  const style = lookOf(feature.slug).stickers[hang.sticker];
  if (!words || !style) return null;
  const icon = hang.brand || style.icon === 'ai' ? {} : { icon: style.icon };
  return (
    <span className={cn('pointer-events-none absolute z-10 [&>*]:pointer-events-auto', hang.where)}>
      <Sticker field={style.field} tilt={hang.tilt} {...icon} {...(hang.brand ? { brand: hang.brand } : {})}>
        {words}
      </Sticker>
    </span>
  );
}

export function MoreWays() {
  const headingId = useId();
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  const features = FEATURES.filter((f) => f.group === 'more' && f.slug in PLACES);
  return (
    <section id={MORE_WAYS.id} aria-labelledby={headingId} data-slot="section" className="bg-canvas px-gutter pt-section-top pb-section-bottom">
      <div className="mx-auto grid max-w-site grid-cols-1 gap-x-10 gap-y-16 md:grid-cols-2 lg:grid-cols-12 xl:gap-x-14">
        <motion.header
          ref={ref}
          initial={false}
          animate={arrival}
          variants={{ hidden: {}, shown: { transition: { staggerChildren: ARRIVE.stagger * 2 } } }}
          className="flex flex-col items-start gap-5 md:col-span-2 lg:col-span-5 lg:pt-2"
        >
          <motion.h2 id={headingId} variants={ARRIVE_ITEM} className="max-w-[12ch] type-site-headline text-ink [text-wrap:balance]">
            {MORE_WAYS.heading}
          </motion.h2>
          <motion.p variants={ARRIVE_ITEM} className="max-w-[30em] type-site-lead text-ink-2">
            {MORE_WAYS.lead}
          </motion.p>
          <motion.span variants={ARRIVE_ITEM}>
            <MoreLink href="/features/">{MORE_WAYS.all}</MoreLink>
          </motion.span>
        </motion.header>
        {features.map((feature) => {
          const slug = feature.slug as Slug;
          const place = PLACES[slug];
          const { Drawing } = place;
          return (
            <MoreItem
              key={slug}
              feature={feature}
              line={MORE_WAYS.rows[slug].line}
              horizontal={place.horizontal}
              className={place.cols}
              drawing={<Drawing className={place.tray} />}
              hang={
                <>
                  {hangOf(feature, place.hang)}
                  {slug === 'import' ? (
                    <span className="pointer-events-none absolute right-6 bottom-full z-10 -mb-[1.3rem] flex [&>*]:pointer-events-auto max-sm:right-3">
                      <Kaatu pose="carry-strip" size={96} follow className="max-sm:[--kaatu-size:4.75rem]" />
                    </span>
                  ) : null}
                </>
              }
            />
          );
        })}
      </div>
    </section>
  );
}
