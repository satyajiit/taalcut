// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: home split section · mode: Persuade · system: WEB2 Remix Vernacular
 * states: arrived (the finished state: server HTML, on screen at load, reduced motion) · arriving (below the fold:
 *   the heading, lead, facts and the demo rise in turn once a third of it is on screen) · a marker sticker leans
 *   toward a fine pointer · flipped (the demo on the left from 1024 px). Not a control.
 * The home's two-column section: the words in one column (the h2 on its own, or with one marker sticker carrying the
 * section's fact, the lead, the facts and the link onward) and the working demo in the other, the way the critique
 * comp sets "Too many clips to pick from" beside the camera roll. No icon tile by the heading: the icons live on the
 * facts and in the demo. One column under 1024 px, words first. Same rhythm as <Section>. */

import { motion } from 'motion/react';
import { type ReactNode, useId, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { ARRIVE_ITEM, HeadingRow, type SectionTone } from '#components/ui/section';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ARRIVE } from '#lib/motion';

const TONES: Readonly<Record<SectionTone, string>> = { canvas: 'bg-canvas', sunken: 'bg-sunken', panel: 'bg-panel' };

export interface HomeSectionProps {
  readonly id: string;
  readonly heading: ReactNode;
  /** One tilted Sticker carrying the section's fact, beside the heading. Sparingly: most headings stand alone. */
  readonly marker?: ReactNode;
  readonly lead?: ReactNode;
  /** Under the lead: the facts and the link onward. */
  readonly aside?: ReactNode;
  /** The working demo. */
  readonly children: ReactNode;
  readonly tone?: SectionTone;
  /** The demo on the left from 1024 px. */
  readonly flip?: boolean;
  /** How the 12 columns split between the words and the demo. */
  readonly split?: '4/8' | '5/7';
  readonly className?: string;
  readonly demoClassName?: string;
}

const SPLITS = {
  '4/8': { words: 'lg:col-span-4', demo: 'lg:col-span-8' },
  '5/7': { words: 'lg:col-span-5', demo: 'lg:col-span-7' },
} as const;

export function HomeSection({ id, heading, marker, lead, aside, children, tone = 'canvas', flip = false, split = '4/8', className, demoClassName }: HomeSectionProps) {
  const ref = useRef<HTMLElement>(null);
  const headingId = useId();
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  const s = SPLITS[split];
  return (
    <motion.section
      ref={ref}
      id={id}
      aria-labelledby={headingId}
      data-slot="section"
      data-arrival={arrival}
      initial={false}
      animate={arrival}
      variants={{ hidden: {}, shown: { transition: { staggerChildren: ARRIVE.stagger } } }}
      className={cn('px-gutter pt-section-top pb-section-bottom', TONES[tone], className)}
    >
      <div className="mx-auto grid max-w-site grid-cols-1 items-center gap-x-14 gap-y-12 lg:grid-cols-12">
        <div className={cn('flex min-w-0 flex-col', s.words, flip && 'lg:order-last')}>
          <HeadingRow marker={marker}>
            <motion.h2 id={headingId} variants={ARRIVE_ITEM} className="max-w-[12ch] type-site-headline text-ink [text-wrap:balance]">
              {heading}
            </motion.h2>
          </HeadingRow>
          {lead ? (
            <motion.p variants={ARRIVE_ITEM} className="mt-5 max-w-[34em] type-site-lead text-ink-2">
              {lead}
            </motion.p>
          ) : null}
          {aside ? (
            <motion.div variants={ARRIVE_ITEM} className="mt-8 flex flex-col gap-6">
              {aside}
            </motion.div>
          ) : null}
        </div>
        <motion.div variants={ARRIVE_ITEM} className={cn('min-w-0', s.demo, demoClassName)}>
          {children}
        </motion.div>
      </div>
    </motion.section>
  );
}
