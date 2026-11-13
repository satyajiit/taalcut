// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: memory meter · mode: Persuade · system: WEB2 Remix Vernacular
 * states: filled (the finished state: the server HTML, reduced motion, at rest) · filling (in a run, once on arrival
 *   and again on every pick: the segments fill one a beat, stories style, in teal) · or more (the rest of the meter
 *   dashed in teal where the fact says "or more") · a mark is current (its bracket and words in ink) or not (ink-3).
 *   Not a control: hidden from assistive technology, since the picker and the words below say every figure.
 * The world's segment bar as a memory meter: eight segments of 4 GB, bracketed at 8, 16 and 32 GB, filled in teal
 * (your computer) as far as the computer you picked. Ubuntu adds a row for the graphics card's video memory, the
 * high-end Mac a row for its GPU's 16 or more cores. */

import { motion } from 'motion/react';
import type { ReactNode } from 'react';
import { grow } from '#components/home/tour-motion';
import { AI_METER } from '#content/ai-map';
import { cn } from '#lib/cn';
import { type DeviceRun, SEGMENTS, segmentsFor } from './model';

/** Seconds between two segments filling in a run. */
export const STEP = 0.07;
/** Where each mark's bracket starts and ends, in segments (0-based, inclusive): 8, 16 and 32 GB. */
const BRACKETS = [
  { mark: AI_METER.marks[0], from: 0, to: 1, gb: 8 },
  { mark: AI_METER.marks[1], from: 2, to: 3, gb: 16 },
  { mark: AI_METER.marks[2], from: 4, to: 7, gb: 32 },
] as const;

function Row({ label, count, filled, dashed = 0, at, thin = false, children, after }: {
  readonly label: string;
  readonly count: number;
  readonly filled: number;
  /** Segments after the filled ones drawn dashed ("or more"). */
  readonly dashed?: number;
  readonly at: number;
  readonly thin?: boolean;
  readonly children?: ReactNode;
  /** Under the segments: "or more" beneath the dashed run. */
  readonly after?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2 sm:grid-cols-[7.5rem_minmax(0,1fr)] sm:items-center sm:gap-4">
      <span className="type-label font-semibold text-ink sm:pb-0.5">{label}</span>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children}
        <div className={cn('grid gap-1', thin ? 'gap-0.5' : 'gap-1')} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              data-slot="meter-segment"
              data-filled={i < filled ? '' : undefined}
              className={cn(
                'relative overflow-hidden',
                thin ? 'h-5 rounded-[3px] sm:h-6' : 'h-9 rounded-md sm:h-12',
                i < filled ? 'bg-rule' : i < filled + dashed ? 'border-2 border-dashed border-teal-strong' : 'bg-rule',
              )}
            >
              {i < filled ? <motion.span variants={grow(at + i * STEP, 'x')} className="absolute inset-0 origin-left bg-teal" /> : null}
            </span>
          ))}
        </div>
        {after}
      </div>
    </div>
  );
}

/** "or more" under the dashed segments, from `from` to the end of a row of `count`. */
function OrMore({ from, count }: { readonly from: number; readonly count: number }) {
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))` }}>
      <span className="type-label font-semibold whitespace-nowrap text-teal-strong" style={{ gridColumn: `${from + 1} / ${count + 1}` }}>
        {AI_METER.orMore}
      </span>
    </div>
  );
}

export function MemoryMeter({ run, at = 0.15 }: { readonly run: DeviceRun; readonly at?: number }) {
  const filled = segmentsFor(run.memory);
  const dashed = run.orMore ? SEGMENTS - filled : 0;
  return (
    <div aria-hidden data-slot="memory-meter" data-filled={filled} data-or-more={run.orMore ? 'true' : 'false'} className="flex flex-col gap-5">
      <Row label={AI_METER.memory} count={SEGMENTS} filled={filled} dashed={dashed} at={at} after={dashed > 0 ? <OrMore from={filled} count={SEGMENTS} /> : null}>
        {/* The marks over their segments, each with a bracket, as a segment bar names its parts. */}
        <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${SEGMENTS}, minmax(0, 1fr))` }}>
          {BRACKETS.map((b) => {
            const current = b.gb === run.memory;
            return (
              <span key={b.mark} className="flex min-w-0 flex-col gap-1" style={{ gridColumn: `${b.from + 1} / ${b.to + 2}` }}>
                <span className={cn('truncate type-label tabular-nums', current ? 'font-bold text-ink' : 'text-ink-3')}>{b.mark}</span>
                <span className={cn('h-1.5 rounded-t-sm border-x border-t', current ? 'border-ink' : 'border-rule-strong')} />
              </span>
            );
          })}
        </div>
      </Row>
      {run.videoMemory ? (
        <Row label={AI_METER.videoMemory} count={SEGMENTS} filled={segmentsFor(run.videoMemory)} at={at + filled * STEP}>
          <span className="type-label font-bold text-ink tabular-nums">{`${run.videoMemory} GB`}</span>
        </Row>
      ) : null}
      {run.gpuCores ? (
        <Row label={AI_METER.gpu} count={run.gpuCores + 4} filled={run.gpuCores} dashed={4} at={at + filled * STEP} thin after={<OrMore from={run.gpuCores} count={run.gpuCores + 4} />}>
          <span className="type-label font-bold text-ink tabular-nums">{run.gpuCores}</span>
        </Row>
      ) : null}
    </div>
  );
}
