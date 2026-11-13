// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the feature tour · mode: Persuade · system: WEB2 Remix Vernacular
 * states: arrived (server HTML, on screen at load, reduced motion) · arriving (each row rises in as it comes on
 *   screen, its words then its demo; the demos play their own run, and Play again in each window's title bar plays it
 *   again) · the breakdown's marker sticker leans toward a fine pointer · links: default (ink, rule underline) · hover
 *   (ink underline, the arrow steps right) · focus (base ring) · a name is one line from 320 px (24 characters at most)
 * The five features in their running order (#content/features), each with a live demo in the coded app window on
 * the owner's reel and footage, its name, one line and its page. One 7/5 grid for the header and every row: the
 * header's h2 in the seven, its lead and the link to every feature in the five, sitting on the h2's baseline; each
 * row's window in the seven and its words in the five, top-aligned with the window's title bar, the sides alternating.
 * One column under 1024 px, words first. */

import { Music } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useId, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { ARRIVE_ITEM } from '#components/ui/section';
import { Sticker } from '#components/ui/sticker';
import { FEATURES } from '#content/features';
import { SAVED_PROBLEM, TOUR } from '#content/home';
import type { Feature } from '#content/schema';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ARRIVE } from '#lib/motion';

import { MoreLink } from './kit';
import { TourAgent } from './tour-agent';
import { TourBreakdown } from './tour-breakdown';
import { TourEditor } from './tour-editor';
import { TourPick } from './tour-pick';
import { TourTemplate } from './tour-template';

type Slug = keyof typeof TOUR.rows;

/** Each row's demo, and which side its window takes from 1024 px: the sides alternate down the tour. */
const ROWS: Readonly<Record<Slug, { readonly demo: () => ReactNode; readonly marker?: () => ReactNode }>> = {
  'reel-breakdown': {
    demo: () => <TourBreakdown />,
    // The section's one marker: the fact the breakdown finds, as the saved reel's sticker says it.
    marker: () => (
      <Sticker field="pink" icon={Music} tilt={-4} size="lg">
        {SAVED_PROBLEM.stickers.beats}
      </Sticker>
    ),
  },
  'auto-pick': { demo: () => <TourPick /> },
  templates: { demo: () => <TourTemplate /> },
  agent: { demo: () => <TourAgent /> },
  editor: { demo: () => <TourEditor /> },
};

/** The one grid: twelve columns from 1024 px, the window in seven and the words in five. */
const GRID = 'grid grid-cols-1 gap-x-10 gap-y-8 lg:grid-cols-12 xl:gap-x-14';
const STAGGER = { hidden: {}, shown: { transition: { staggerChildren: ARRIVE.stagger * 2 } } } as const;

function useRowArrival<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const reduce = useReducedMotionPref();
  return { ref, state: useArrival(ref, { reduce }) } as const;
}

function TourRow({ feature, index }: { readonly feature: Feature; readonly index: number }) {
  const slug = feature.slug as Slug;
  const row = ROWS[slug];
  const words = TOUR.rows[slug];
  const demoLeft = index % 2 === 0;
  const { ref, state } = useRowArrival<HTMLElement>();
  return (
    <motion.article ref={ref} data-tour={slug} initial={false} animate={state} variants={STAGGER} className={cn(GRID, 'items-start')}>
      {/* The words: the name's line sits level with the window's title (its bar is 52 design px). */}
      <motion.div
        variants={ARRIVE_ITEM}
        className={cn('flex min-w-0 flex-col gap-4 lg:col-span-5 lg:row-start-1 lg:pt-2.5', demoLeft ? 'lg:col-start-8' : 'lg:col-start-1')}
      >
        <h3 className="min-w-0 type-site-subhead text-ink">
          <span data-feature-name="">{feature.name}</span>
        </h3>
        <p className="max-w-[34em] type-site-body text-ink-2">{words.line}</p>
        <MoreLink href={`/features/${feature.slug}/`} className="self-start">
          {words.more}
        </MoreLink>
        {row.marker ? (
          <span data-slot="section-marker" className="mt-3 inline-flex self-start">
            {row.marker()}
          </span>
        ) : null}
      </motion.div>
      <motion.div variants={ARRIVE_ITEM} className={cn('min-w-0 lg:col-span-7 lg:row-start-1', demoLeft ? 'lg:col-start-1' : 'lg:col-start-6')}>
        {row.demo()}
      </motion.div>
    </motion.article>
  );
}

export function FeatureTour() {
  const headingId = useId();
  const { ref, state } = useRowArrival<HTMLElement>();
  const rows = FEATURES.filter((f) => f.slug in ROWS);
  return (
    <section id="features" aria-labelledby={headingId} data-slot="section" className="bg-sunken px-gutter pt-section-top pb-section-bottom">
      <div className="mx-auto flex max-w-site flex-col gap-[clamp(5rem,8vw,8rem)]">
        <motion.header ref={ref} initial={false} animate={state} variants={STAGGER} className={cn(GRID, 'gap-y-5 lg:items-end')}>
          <motion.h2 id={headingId} variants={ARRIVE_ITEM} className="max-w-[14ch] type-site-headline text-ink [text-wrap:balance] lg:col-span-7">
            {TOUR.heading}
          </motion.h2>
          {/* The lead and the way to every feature, on the h2's last line: the header's right half is never empty. */}
          <motion.div variants={ARRIVE_ITEM} className="flex flex-col items-start gap-3 lg:col-span-5 lg:pb-[0.2em]">
            <p className="max-w-[34em] type-site-lead text-ink-2">{TOUR.lead}</p>
            <MoreLink href="/features/">{TOUR.all}</MoreLink>
          </motion.div>
        </motion.header>
        {rows.map((feature, i) => (
          <TourRow key={feature.slug} feature={feature} index={i} />
        ))}
      </div>
    </section>
  );
}
