// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: segment bar · mode: Persuade · system: WEB2 Remix Vernacular
 * states: idle (empty tracks) · playing (the segments fill by the reel's time, stories style, and each rose beat tick
 *   swells as the playhead crosses it) · filled (every segment full) · lifted (raised off the reel on a violet shadow,
 *   ready to fly into the app window by shared layout: pass the same layoutId on both ends) · reduced motion (no
 *   swell, no lift; the fill follows the time without easing) · without JavaScript (as its state says, filled or
 *   empty). Not a control.
 * The template's slots as a reel's segmented progress bar: N segments in labelled parts (Hook, Build, Peak, Outro),
 * optional numbers, rose music-beat ticks, and a dashed segment where the AI was unsure of the cut. Read by assistive
 * technology as one image with its words (segmentBarLabel); the drawn labels are hidden from it. */

import { motion, type MotionValue, useMotionValue, useTransform } from 'motion/react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { cn } from '#lib/cn';
import { BEAT_PULSE, FLIGHT } from '#lib/motion';
import { beatPosition, beatPulsing, GROUP_WORDS, groupsOf, type Segment, segmentBarLabel, segmentFill } from './segments';

export type { Segment };
export type SegmentBarState = 'idle' | 'playing' | 'filled' | 'lifted';

export interface SegmentBarProps {
  readonly segments: readonly Segment[];
  /** The reel's time in seconds, while it plays (ReelFrame writes one). Without it, the state decides the fill. */
  readonly time?: MotionValue<number>;
  /** Music beats in seconds: a rose tick each. */
  readonly beats?: readonly number[];
  readonly state?: SegmentBarState;
  /** Part names over their segments, each with a bracket. */
  readonly labels?: boolean;
  /** Slot numbers in the segments (taller segments). */
  readonly numbers?: boolean;
  /** `equal` gives each slot the same width (stories style, the default); `time` follows the reel's clock. */
  readonly layout?: 'equal' | 'time';
  /** On video (white on the picture) or on a surface (violet: the AI's reading of the reel). */
  readonly tone?: 'video' | 'surface';
  /** Shared-layout id: the same id on the reel's bar and the window's lets motion fly one into the other. */
  readonly layoutId?: string;
  /** Overrides the words assistive technology reads. */
  readonly label?: string;
  /** The motif only (a divider, the footer): hidden from assistive technology. */
  readonly decorative?: boolean;
  readonly className?: string;
}

const TONE = {
  video: { track: 'bg-viewer-ink/35', fill: 'bg-viewer-ink', number: 'text-viewer', numberOff: 'text-viewer-ink', label: 'text-viewer-ink', bracket: 'border-viewer-ink/70', tick: 'bg-rose' },
  surface: { track: 'bg-violet-soft', fill: 'bg-violet', number: 'text-violet-ink', numberOff: 'text-violet-strong', label: 'text-ink-2', bracket: 'border-rule-strong', tick: 'bg-rose' },
} as const;

function Fill({ segment, time, state, tone }: { segment: Segment; time?: MotionValue<number>; state: SegmentBarState; tone: 'video' | 'surface' }) {
  const fixed = state === 'filled' || state === 'lifted' ? 1 : 0;
  const still = useMotionValue(0);
  const scale = useTransform(time ?? still, (t: number) => segmentFill(segment, t));
  return (
    <motion.span
      aria-hidden
      className={cn('absolute inset-0 origin-left rounded-[inherit]', TONE[tone].fill)}
      style={{ scaleX: time && state === 'playing' ? scale : fixed }}
    />
  );
}

function Tick({ at, beat, time, pulse, numbers }: { at: number; beat: number; time?: MotionValue<number>; pulse: boolean; numbers: boolean }) {
  const still = useMotionValue(0);
  const scale = useTransform(time ?? still, (t: number) => (beatPulsing(beat, t, BEAT_PULSE.seconds) ? BEAT_PULSE.scale : 1));
  return (
    <motion.span
      aria-hidden
      data-slot="beat-tick"
      className={cn('absolute h-1.5 w-0.5 rounded-pill bg-rose', numbers ? '-bottom-2.5' : '-bottom-2')}
      style={{ left: `${(at * 100).toFixed(3)}%`, x: '-50%', scaleY: pulse && time ? scale : 1, originY: 0 }}
    />
  );
}

export function SegmentBar({
  segments,
  time,
  beats = [],
  state = 'idle',
  labels = false,
  numbers = false,
  layout = 'equal',
  tone = 'video',
  layoutId,
  label,
  decorative = false,
  className,
}: SegmentBarProps) {
  const reduce = useReducedMotionPref();
  const t = TONE[tone];
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.end - s.start), 0) || 1;
  const grow = (s: Segment) => (layout === 'equal' ? 1 : Math.max(0, s.end - s.start) / total);
  const groups = groupsOf(segments);
  const lifted = state === 'lifted' && !reduce;
  return (
    <motion.div
      {...(decorative ? { 'aria-hidden': true } : { role: 'img', 'aria-label': label ?? segmentBarLabel(segments, beats.length) })}
      data-slot="segment-bar"
      data-state={state}
      data-tone={tone}
      layoutId={layoutId}
      transition={FLIGHT}
      initial={false}
      animate={{ y: lifted ? -6 : 0, scale: lifted ? 1.03 : 1 }}
      className={cn('relative w-full rounded-lg', lifted && 'shadow-lift', className)}
    >
      {labels ? (
        <div aria-hidden className="mb-1.5 flex gap-1">
          {groups.map((g) => (
            <span
              key={`${g.group}-${g.from}`}
              className="flex min-w-0 flex-col items-center gap-1"
              style={{ flexGrow: segments.slice(g.from - 1, g.to).reduce((sum, s) => sum + grow(s), 0), flexBasis: 0 }}
            >
              <span className={cn('max-w-full truncate type-caption font-semibold', t.label)}>{GROUP_WORDS[g.group]}</span>
              <span className={cn('h-1.5 w-full rounded-t-sm border-x border-t', t.bracket)} />
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative flex gap-1">
        {segments.map((s, i) => (
          <span
            key={`${s.start}-${i}`}
            data-slot="segment"
            data-group={s.group}
            data-unsure={s.unsure ? '' : undefined}
            className={cn(
              'relative flex min-w-0 items-center justify-center overflow-hidden rounded-sm',
              numbers ? 'h-5' : 'h-1',
              t.track,
              s.unsure && 'outline-1 outline-offset-1 outline-violet-strong outline-dashed',
            )}
            style={{ flexGrow: grow(s), flexBasis: 0 }}
          >
            <Fill segment={s} time={time} state={state} tone={tone} />
            {numbers ? (
              <span aria-hidden className={cn('relative type-caption font-semibold tabular-nums', state === 'idle' ? t.numberOff : t.number)}>
                {i + 1}
              </span>
            ) : null}
          </span>
        ))}
        {beats.map((b) => (
          <Tick key={b} at={beatPosition(segments, b, layout)} beat={b} time={time} pulse={state === 'playing' && !reduce} numbers={numbers} />
        ))}
      </div>
    </motion.div>
  );
}
