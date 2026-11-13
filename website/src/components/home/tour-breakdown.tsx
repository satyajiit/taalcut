// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: tour · reel breakdown · mode: Persuade · system: WEB2 Remix Vernacular
 * states: finished (server HTML, reduced motion: the reel read, every cut and music beat on its lane, the unsure
 *   cut dashed with Fix a cut beside it) · reading (on arrival and on Play again: the playhead crosses the reel in
 *   about 3 s and each cut and beat lands as it passes; then the count and Fix a cut pop) · Play again (kit: in the
 *   window's title bar)
 * The breakdown of the owner's reel in the coded app window, on the reel's own clock: its cuts, its music beats and
 * its slots grouped Hook, Build, Peak, Outro. The cut the scene detector was least sure of is dashed. */

import { AudioLines, Music, RectangleVertical, Wrench } from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useRef } from 'react';
import { AppWindow } from '#components/ui/app-window';
import { IconText } from '#components/ui/icon-text';
import { SegmentBar } from '#components/ui/segment-bar';
import { TOUR } from '#content/home';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { ReplayButton, Thumb, useReplay } from './kit';
import { REEL, REEL_SEGMENTS, REEL_TITLE } from './reel-data';
import { grow, pop, sweep } from './tour-motion';

const START = 0.3;
const SWEEP = 3;
const LENGTH = REEL.durationSec;
/** When the playhead reaches a moment of the reel. */
const passes = (t: number) => START + (t / LENGTH) * SWEEP;
const at = (t: number) => `${((t / LENGTH) * 100).toFixed(2)}%`;

const CUTS = REEL.slots.slice(1).map((s) => ({ t: s.start, unsure: !!s.uncertainCut }));
const FIRST_UNSURE = CUTS.find((c) => c.unsure);

function Lane({ icon, label, children }: { readonly icon: ReactNode; readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="grid grid-cols-[calc(var(--spacing)*30)_minmax(0,1fr)] items-center gap-3">
      <span className="flex items-center gap-2 type-label text-ink-2">
        {icon}
        {label}
      </span>
      <div className="relative h-9 rounded-md bg-sunken">{children}</div>
    </div>
  );
}

export function TourBreakdown() {
  const ref = useRef<HTMLDivElement>(null);
  const { state, replay } = useReplay(ref);
  const b = TOUR.breakdown;
  return (
    <div ref={ref}>
      <AppWindow title={b.title} area="make" fit="fold" actions={<ReplayButton onReplay={replay} label={TOUR.replay} />}>
        <motion.div initial={false} animate={state} className="flex flex-col gap-4 p-5">
          <div className="flex items-center gap-3">
            <Thumb sprite={11} className="aspect-[9/16] w-10 shrink-0 rounded-md" />
            <div className="flex min-w-0 flex-col">
              <span className="truncate type-label font-semibold text-ink">{REEL_TITLE}</span>
              <span className="type-timecode text-ink-3">0:{String(Math.round(LENGTH)).padStart(2, '0')}</span>
            </div>
            <motion.span variants={pop(START + SWEEP + 0.1)} className="ms-auto inline-flex items-center gap-1.5 rounded-pill bg-rose-soft px-3 py-1 type-label font-semibold text-rose-strong">
              <AudioLines aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
              {b.found}
            </motion.span>
          </div>
          <div className="relative flex flex-col gap-2">
            <Lane icon={<ICONS.trim aria-hidden strokeWidth={ICON_STROKE} className="size-4 text-violet-strong" />} label={b.cuts}>
              {CUTS.map((c) => (
                <motion.span
                  key={c.t}
                  variants={grow(passes(c.t))}
                  style={{ left: at(c.t) }}
                  className={cn(
                    'absolute inset-y-1.5 w-0.5 -translate-x-1/2 rounded-pill',
                    c.unsure ? 'border-l-2 border-dashed border-violet-strong bg-transparent' : 'bg-violet',
                  )}
                />
              ))}
              {FIRST_UNSURE ? (
                <motion.span
                  variants={pop(START + SWEEP + 0.35)}
                  style={{ left: at(FIRST_UNSURE.t) }}
                  className="absolute -top-3 z-10 ms-2 inline-flex origin-left items-center gap-1 rounded-pill bg-violet-soft px-2 py-0.5 type-caption font-semibold whitespace-nowrap text-violet-strong shadow-sm"
                >
                  <Wrench aria-hidden strokeWidth={ICON_STROKE} className="size-3" />
                  {b.fix}
                </motion.span>
              ) : null}
            </Lane>
            <Lane icon={<Music aria-hidden strokeWidth={ICON_STROKE} className="size-4 text-rose-strong" />} label={b.beats}>
              {REEL.beats.map((t) => (
                <motion.span key={t} variants={grow(passes(t))} style={{ left: at(t) }} className="absolute inset-y-2.5 w-1 -translate-x-1/2 rounded-pill bg-rose" />
              ))}
            </Lane>
            <Lane icon={<RectangleVertical aria-hidden strokeWidth={ICON_STROKE} className="size-4 text-ink-3" />} label={b.slots}>
              <motion.span variants={grow(START, 'x')} className="absolute inset-x-1.5 top-1/2 block origin-left -translate-y-1/2">
                <SegmentBar segments={REEL_SEGMENTS} beats={[]} state="filled" tone="surface" layout="time" />
              </motion.span>
            </Lane>
            {/* The playhead, over the lanes' tracks only. */}
            <span aria-hidden className="pointer-events-none absolute inset-y-0 right-0 left-[calc(var(--spacing)*33)]">
              <motion.span variants={sweep(START, SWEEP)} className="absolute inset-y-0 left-0 block w-full">
                <span className="absolute -inset-y-1 left-0 w-0.5 -translate-x-1/2 rounded-pill bg-ink" />
                <span className="absolute -top-2 left-0 size-2.5 -translate-x-1/2 rounded-full bg-ink" />
              </motion.span>
            </span>
          </div>
          <IconText icon={AudioLines} tone="muted" size="sm" className="type-meta text-ink-2">
            {TOUR.rows['reel-breakdown'].also}
          </IconText>
        </motion.div>
      </AppWindow>
    </div>
  );
}
