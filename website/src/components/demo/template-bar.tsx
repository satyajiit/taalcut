// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: template bar · mode: Persuade · system: WEB2 Remix Vernacular
 * states: on the reel (video tone: the part names white with a shadow, over the reel's scrim) · in the app window
 *   (surface tone) · idle · playing (fills on a clock) · lifted · filled · a pick landing (a rose ring bursts round its
 *   segment) · reduced motion (no burst; the strip's own states) · without JavaScript (as its state says). Not a
 *   control.
 * A reel's segment bar with its part names over it: Hook, Build, Peak, Outro. The names sit in one row that gives each
 * part room for its whole word (a one-slot part borrows from its neighbours, the first and last hug the ends), with a
 * bracket drawn exactly over each part's segments, so no name is ever cut to "H…". SlotStrip draws the slots as one
 * violet stories strip, the same on the reel and in the window, with the rose music-beat ticks under it. `flight` marks
 * the strip as an end of the stage's flight (flight-layer.tsx): the reel and the window both clip, so the bar flies as
 * a ghost above them. */

import { motion, type MotionValue } from 'motion/react';
import { GROUP_WORDS, groupsOf, type Segment } from '#components/ui/segments';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import type { Reel } from '#content/schema';
import { cn } from '#lib/cn';
import { EASE_OUT } from '#lib/motion';
import { SlotStrip, type SlotStripState } from './slot-strip';

export function reelSegments(reel: Pick<Reel, 'slots'>): Segment[] {
  return reel.slots.map((s) => ({ start: s.start, end: s.end, group: s.role, ...(s.uncertainCut ? { unsure: true } : {}) }));
}

/** Where segment `from`..`to` (0-based, inclusive) sits along a bar of `count` segments with a 1-unit gap between. */
export function spanStyle(from: number, to: number, count: number): { left: string; width: string } {
  const gaps = `(var(--spacing) * ${Math.max(count - 1, 0)})`;
  const one = `((100% - ${gaps}) / ${Math.max(count, 1)})`;
  return {
    left: `calc(${from} * (${one} + var(--spacing)))`,
    width: `calc(${to - from + 1} * ${one} + var(--spacing) * ${to - from})`,
  };
}

export interface TemplateBarProps {
  readonly reel: Reel;
  readonly tone: 'video' | 'surface';
  readonly state: SlotStripState;
  readonly time?: MotionValue<number>;
  /** The music beats shown so far (all of them, or the ones read). */
  readonly beats: readonly number[];
  /** Marks the segment row as where the stage's bar flight leaves from (`from`) or lands (`to`). */
  readonly flight?: 'from' | 'to';
  /** The slot whose pick just landed: a rose ring bursts round it. */
  readonly landing?: number;
  /** What assistive technology reads instead of the bar's own words. */
  readonly label?: string;
  readonly className?: string;
}

export function TemplateBar({ reel, tone, state, time, beats, flight, landing, label, className }: TemplateBarProps) {
  const reduce = useReducedMotionPref();
  const segments = reelSegments(reel);
  const groups = groupsOf(segments);
  const count = segments.length;
  const video = tone === 'video';
  return (
    <div data-slot="template-bar" data-tone={tone} className={cn('relative w-full', className)}>
      <div aria-hidden className="flex gap-1">
        {groups.map((g, i) => (
          <span
            key={`${g.group}-${g.from}`}
            data-part={g.group}
            className={cn(
              'min-w-max flex-1 basis-0 font-semibold whitespace-nowrap',
              i === 0 ? 'text-start' : i === groups.length - 1 ? 'text-end' : 'text-center',
              video ? 'type-meta text-viewer-ink [text-shadow:0_1px_3px_var(--color-viewer)]' : 'type-caption text-ink-2',
            )}
            style={{ flexGrow: g.to - g.from + 1 }}
          >
            {GROUP_WORDS[g.group]}
          </span>
        ))}
      </div>
      <div aria-hidden className="relative mt-0.5 h-1.5">
        {groups.map((g) => (
          <span
            key={`${g.group}-${g.from}`}
            className={cn('absolute top-0 h-1.5 rounded-t-sm border-x border-t', video ? 'border-viewer-ink/80' : 'border-rule-strong')}
            style={spanStyle(g.from - 1, g.to - 1, count)}
          />
        ))}
      </div>
      <div className="relative mt-1" {...(flight ? { [`data-flight-${flight}`]: 'bar' } : {})}>
        <SlotStrip segments={segments} beats={beats} time={time} state={state} tone={tone} {...(label ? { label } : {})} />
        {landing !== undefined && landing >= 0 && !reduce ? (
          <motion.span
            key={`land-${landing}`}
            aria-hidden
            data-slot="landing"
            className="pointer-events-none absolute top-0 h-5 rounded-sm ring-2 ring-rose"
            style={spanStyle(landing, landing, count)}
            initial={{ opacity: 1, scale: 0.7 }}
            animate={{ opacity: 0, scale: 1.6 }}
            transition={{ duration: 0.5, ease: EASE_OUT }}
          />
        ) : null}
      </div>
    </div>
  );
}
