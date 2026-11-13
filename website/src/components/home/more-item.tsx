// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: more ways · one feature's item · mode: Persuade · system: WEB2 Remix Vernacular
 * states: arrived (server HTML, on screen at load, reduced motion) · arriving (the item rises in once a third of it is
 *   on screen; its drawing plays its own run) · the name's link: default (ink, no underline) · hover (the underline
 *   comes in, the arrow steps right) · focus (base ring) · active (n/a) · its sticker pops once and leans toward a fine
 *   pointer · horizontal (from 1024 px the words sit beside the drawing, level with its middle).
 * A feature of More ways to make: its drawing (the feature working, in the app's own labels), a sticker on the
 *   drawing's edge where one earns its place, then its glyph chip in its colour job, its name as the link to its page
 *   (an h3 under the section's h2) and one line. */

import { ArrowRight } from 'lucide-react';
import { motion } from 'motion/react';
import type { Route } from 'next';
import Link from 'next/link';
import { type ReactNode, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { LookGlyph } from '#components/showcase/icon-chip';
import { JOB_CHIP, lookOf } from '#components/showcase/look';
import { ARRIVE_ITEM } from '#components/ui/section';
import type { Feature } from '#content/schema';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';

export interface MoreItemProps {
  readonly feature: Feature;
  readonly line: string;
  /** The feature working, drawn. */
  readonly drawing: ReactNode;
  /** A sticker (or Kaatu) hung on the drawing's edge, already positioned. */
  readonly hang?: ReactNode;
  /** From 1024 px, the words beside the drawing instead of under it. */
  readonly horizontal?: boolean;
  readonly className?: string;
}

export function MoreItem({ feature, line, drawing, hang, horizontal = false, className }: MoreItemProps) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  const look = lookOf(feature.slug);
  const headingId = `more-${feature.slug}`;
  return (
    <motion.article
      ref={ref}
      aria-labelledby={headingId}
      data-more={feature.slug}
      initial={false}
      animate={arrival}
      variants={ARRIVE_ITEM}
      className={cn('flex min-w-0 flex-col gap-7', horizontal && 'lg:grid lg:grid-cols-12 lg:items-center lg:gap-x-14', className)}
    >
      <div className={cn('relative min-w-0', horizontal && 'lg:order-2 lg:col-span-8')}>
        {drawing}
        {hang}
      </div>
      <div className={cn('flex min-w-0 items-start gap-3.5', horizontal && 'lg:order-1 lg:col-span-4')}>
        <span aria-hidden className={cn('inline-grid size-10 shrink-0 place-items-center rounded-xl', JOB_CHIP[look.job])}>
          <LookGlyph icon={look.icon} className="size-5" />
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <h3 id={headingId} className="type-site-subhead text-balance text-ink">
            <Link
              href={`/features/${feature.slug}/` as Route}
              className="group rounded-sm underline decoration-transparent decoration-2 underline-offset-4 transition-[text-decoration-color] duration-(--dur-micro) hover:decoration-ink"
            >
              {feature.name}
              <ArrowRight
                aria-hidden
                strokeWidth={ICON_STROKE}
                className="ms-1.5 inline-block size-[0.85em] align-[-0.08em] transition-transform duration-(--dur-short) ease-(--ease-out) group-hover:translate-x-1 motion-reduce:transition-none"
              />
            </Link>
          </h3>
          <p className="max-w-[34em] type-site-body text-ink-2">{line}</p>
        </div>
      </div>
    </motion.article>
  );
}
