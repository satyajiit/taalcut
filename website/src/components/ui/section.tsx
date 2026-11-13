// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: section · mode: Persuade · system: WEB2 Remix Vernacular
 * states: arrived (the finished state: server HTML, already on screen at load, reduced motion) · arriving (below the
 *   fold at load: its heading, lead and <Arrive> parts rise 16 px and fade in, 70 ms apart, once a third of it is on
 *   screen) · a marker sticker leans toward a fine pointer. Not a control.
 * The page section frame: one spacing rhythm for every section (more room above the heading than below it: pt-section-
 * top, the heading-gap, pb-section-bottom), the heading on its own (no icon tile beside it, never an eyebrow label,
 * never "01 ·"), an optional marker (one tilted Sticker carrying the section's fact, used sparingly), a lead, and the
 * section's own content. Lucide icons live on the rows, chips and links inside. Wrap the content's parts in <Arrive> to
 * join the one orchestrated arrival. <ArriveGroup> gives a block that isn't a Section the same arrival. */

import { motion } from 'motion/react';
import { type ReactNode, useId, useRef } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ARRIVE, EASE_OUT } from '#lib/motion';

export type SectionTone = 'canvas' | 'sunken' | 'panel';
export type SectionJob = 'ink' | 'ai' | 'beat' | 'you' | 'action';

const TONES: Readonly<Record<SectionTone, string>> = { canvas: 'bg-canvas', sunken: 'bg-sunken', panel: 'bg-panel' };
const WIDTHS = { site: 'max-w-site', narrow: 'max-w-4xl', full: 'max-w-none' } as const;
const STAGGER = { hidden: {}, shown: { transition: { staggerChildren: ARRIVE.stagger } } } as const;

/** One part of a section's arrival: rises and fades in with its neighbours. */
export const ARRIVE_ITEM = {
  hidden: { opacity: 0, y: ARRIVE.rise, transition: { duration: 0 } },
  shown: { opacity: 1, y: 0, transition: { duration: ARRIVE.duration, ease: EASE_OUT } },
} as const;

export interface SectionProps {
  readonly heading: ReactNode;
  readonly children?: ReactNode;
  readonly id?: string;
  /** h2 (default) or h3 for a section inside another. */
  readonly level?: 2 | 3;
  /** One tilted Sticker carrying the section's fact, beside the heading's last line (wraps under it on a phone). */
  readonly marker?: ReactNode;
  readonly lead?: ReactNode;
  readonly tone?: SectionTone;
  readonly width?: keyof typeof WIDTHS;
  readonly className?: string;
  /** Classes for the content under the heading and lead. */
  readonly bodyClassName?: string;
  /** Write data-arrival on the section (default). Off for a block shared across pages that their tests don't count. */
  readonly mark?: boolean;
}

/**
 * A heading and, when there is one, its marker: the sticker sits beside the heading's last line and wraps under it
 * where the line runs out. Without a marker it is the heading alone.
 */
export function HeadingRow({ marker, children, className }: { readonly marker?: ReactNode; readonly children: ReactNode; readonly className?: string }) {
  if (!marker) return <>{children}</>;
  return (
    <div className={cn('flex flex-wrap items-end gap-x-5 gap-y-3', className)}>
      {children}
      <motion.span variants={ARRIVE_ITEM} data-slot="section-marker" className="inline-flex pb-[0.35em]">
        {marker}
      </motion.span>
    </div>
  );
}

export function Section({ heading, children, id, level = 2, marker, lead, tone = 'canvas', width = 'site', className, bodyClassName, mark = true }: SectionProps) {
  const ref = useRef<HTMLElement>(null);
  const headingId = useId();
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  const H = level === 2 ? motion.h2 : motion.h3;
  return (
    <motion.section
      ref={ref}
      id={id}
      aria-labelledby={headingId}
      data-slot="section"
      data-arrival={mark ? arrival : undefined}
      initial={false}
      animate={arrival}
      variants={STAGGER}
      className={cn('px-gutter pt-section-top pb-section-bottom', TONES[tone], className)}
    >
      <div className={cn('mx-auto', WIDTHS[width])}>
        <HeadingRow marker={marker}>
          <H id={headingId} variants={ARRIVE_ITEM} className={cn('max-w-[20ch] text-ink [text-wrap:balance]', level === 2 ? 'type-site-headline' : 'type-site-subhead')}>
            {heading}
          </H>
        </HeadingRow>
        {lead ? (
          <motion.p variants={ARRIVE_ITEM} className="mt-4 max-w-[38em] type-site-lead text-ink-2">
            {lead}
          </motion.p>
        ) : null}
        {children ? <div className={cn('mt-heading-gap', bodyClassName)}>{children}</div> : null}
      </div>
    </motion.section>
  );
}

/**
 * A block that arrives as a Section does without being one (the waitlist band's panel): its <Arrive> parts rise in turn
 * once it comes on screen. `mark` writes data-arrival; leave it off for a block shared across pages.
 */
export function ArriveGroup({
  children,
  className,
  mark = false,
}: {
  readonly children: ReactNode;
  readonly className?: string;
  readonly mark?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  return (
    <motion.div ref={ref} data-arrival={mark ? arrival : undefined} initial={false} animate={arrival} variants={STAGGER} className={className}>
      {children}
    </motion.div>
  );
}

/** Wrap a part of a section's content to arrive with it, in order. `as` picks the element (div by default). */
export function Arrive({ children, className, as = 'div' }: { readonly children: ReactNode; readonly className?: string; readonly as?: 'div' | 'li' | 'p' | 'span' }) {
  const Tag = motion[as];
  return (
    <Tag variants={ARRIVE_ITEM} className={className}>
      {children}
    </Tag>
  );
}
