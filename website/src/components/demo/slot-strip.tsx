// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: slot strip · mode: Persuade · system: WEB2 Remix Vernacular (violet is the AI's reading of the reel)
 * states: idle (every slot waiting: soft violet, its number in strong violet) · playing (the slots fill left to right
 *   on a clock, stories style: a filled slot is solid violet with its number in violet ink; the rose music-beat ticks
 *   under it swell as the playhead crosses them) · filled · lifted (raised on the lift shadow, ready to fly) · an unsure
 *   cut (a dashed outline) · reduced motion (no swell, no lift; the fill follows the clock) · without JavaScript (as
 *   its state says). Not a control: one image, named by its words.
 * The template's slots as one clean stories-segment strip, the same on the reel and in the app window: the number of
 * every slot holds 4.5:1 or better, waiting or filled, in both themes and over any footage, because each slot is an
 * opaque violet chip. The fill is a second, solid layer revealed by clip-path from the left: the slot playing now is
 * part filled, its number split between the two pairings, each of which holds the contrast. */

import { motion, type MotionValue, useMotionValue, useTransform } from 'motion/react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { beatPosition, beatPulsing, segmentBarLabel, type Segment } from '#components/ui/segments';
import { cn } from '#lib/cn';
import { BEAT_PULSE, FLIGHT } from '#lib/motion';

export type SlotStripState = 'idle' | 'playing' | 'filled' | 'lifted';

export interface SlotStripProps {
  readonly segments: readonly Segment[];
  /** The clock the slots fill on, in seconds (the reel's, or the window's as picks land). */
  readonly time?: MotionValue<number>;
  /** Music beats in seconds: a rose tick each. */
  readonly beats?: readonly number[];
  readonly state?: SlotStripState;
  /** On the footage (a white dashed outline for an unsure cut) or on the window's surface (a violet one). */
  readonly tone?: 'video' | 'surface';
  /** Overrides the words assistive technology reads. */
  readonly label?: string;
  readonly className?: string;
}

function Slots({ segments, filled, tone, marked }: { readonly segments: readonly Segment[]; readonly filled: boolean; readonly tone: 'video' | 'surface'; readonly marked: boolean }) {
  return (
    <>
      {segments.map((s, i) => (
        <span
          key={`${s.start}-${i}`}
          {...(marked ? { 'data-slot': 'segment', 'data-group': s.group, 'data-unsure': s.unsure ? '' : undefined } : {})}
          className={cn(
            'flex h-5 min-w-0 flex-1 basis-0 items-center justify-center rounded-sm type-caption font-bold tracking-[-0.02em] tabular-nums',
            filled ? 'bg-violet text-violet-ink' : 'bg-violet-soft text-violet-strong',
            marked && s.unsure && cn('outline-1 outline-offset-1 outline-dashed', tone === 'video' ? 'outline-viewer-ink' : 'outline-violet-strong'),
          )}
        >
          {i + 1}
        </span>
      ))}
    </>
  );
}

function Tick({ at, beat, time, pulse }: { readonly at: number; readonly beat: number; readonly time?: MotionValue<number>; readonly pulse: boolean }) {
  const still = useMotionValue(0);
  const scale = useTransform(time ?? still, (t: number) => (beatPulsing(beat, t, BEAT_PULSE.seconds) ? BEAT_PULSE.scale : 1));
  return (
    <motion.span
      aria-hidden
      data-slot="beat-tick"
      className="absolute -bottom-2.5 h-1.5 w-0.5 rounded-pill bg-rose"
      style={{ left: `${(at * 100).toFixed(3)}%`, x: '-50%', scaleY: pulse && time ? scale : 1, originY: 0 }}
    />
  );
}

export function SlotStrip({ segments, time, beats = [], state = 'idle', tone = 'surface', label, className }: SlotStripProps) {
  const reduce = useReducedMotionPref();
  const still = useMotionValue(0);
  // How much of the strip is filled, 0 to 1: the playhead's place along equal slots.
  const playing = state === 'playing' && time !== undefined;
  const fixed = state === 'filled' || state === 'lifted' ? 0 : 100;
  const reveal = useTransform(time ?? still, (t: number) => `inset(0 ${((1 - beatPosition(segments, t, 'equal')) * 100).toFixed(2)}% 0 0)`);
  const lifted = state === 'lifted' && !reduce;
  return (
    <motion.div
      role="img"
      aria-label={label ?? segmentBarLabel(segments, beats.length)}
      data-slot="segment-bar"
      data-state={state}
      data-tone={tone}
      transition={FLIGHT}
      initial={false}
      animate={{ y: lifted ? -6 : 0, scale: lifted ? 1.03 : 1 }}
      className={cn('relative w-full rounded-sm', lifted && 'shadow-lift', className)}
    >
      <div className="relative flex gap-1">
        <Slots segments={segments} filled={false} tone={tone} marked />
        <motion.div aria-hidden className="pointer-events-none absolute inset-0 flex gap-1" style={{ clipPath: playing ? reveal : `inset(0 ${fixed}% 0 0)` }}>
          <Slots segments={segments} filled tone={tone} marked={false} />
        </motion.div>
        {beats.map((b) => (
          <Tick key={b} at={beatPosition(segments, b, 'equal')} beat={b} time={time} pulse={state === 'playing' && !reduce} />
        ))}
      </div>
    </motion.div>
  );
}
