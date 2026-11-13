// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the cut, checked against the reel · mode: Operate · system: WEB2 Remix Vernacular
 * the agent's check as a picture: the reel's slots on top (the violet slot strip, grouped Hook, Build, Peak and Outro,
 *   its rose music beats under it) and the cut under them, slot for slot, each slot's clip from the owner's camera roll
 *   at its own 9:16. The run fills it: the clips land in their slots, the cuts that fall on a music beat get their rose
 *   tick, the shots are checked against their moments one by one (a miss is outlined in violet dashes, then swapped
 *   for a shot that shows what the moment needs, then ticked), and the five checks pass in turn
 * states: a slot: waiting (its violet number) · placed (its clip) · missed (dashed violet) · checked (the AI's tick)
 *   · a cut: on the beat (a rose tick once marked) · a check: waiting (a hollow ring) · passed (the AI's tick) · missed
 *   (dashed, said in words) · the server HTML, reduced motion: finished, every slot checked
 * motion: a clip pops into its slot, a tick pops on, during a run only (transform and opacity); reduced motion: none */

import { motion } from 'motion/react';
import { SegmentBar } from '#components/ui/segment-bar';
import { cn } from '#lib/cn';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import { SHOWCASE_ICONS } from '../icons';
import { reelSegments } from '../reel-side';
import { CHECKS, clipsWith, missedWith, ON_BEAT, REEL, type RunFrame, type SlotState } from './run-script';

const POP = { type: 'spring', stiffness: 520, damping: 24, mass: 0.7 } as const;

/** Each slot's state once the visitor's undo is counted: a swap taken back misses its moment again. */
export function slotStates(frame: RunFrame, undone: number): readonly SlotState[] {
  const missed = new Set(frame.done ? missedWith(undone) : []);
  return frame.slots.map((s, k) => (missed.has(k) ? 'missed' : s));
}

export function CheckStrip({
  frame,
  undone,
  live,
}: {
  readonly frame: RunFrame;
  readonly undone: number;
  readonly live: boolean;
}) {
  const clips = clipsWith(frame, undone);
  const states = slotStates(frame, undone);
  const missedNeeds = frame.done && missedWith(undone).length > 0;
  const marked = new Set(ON_BEAT.slice(0, frame.seams));
  return (
    <section
      aria-label="Your cut, checked against the reel"
      data-slot="check-strip"
      className="@container flex min-w-0 flex-col gap-3 rounded-xl border border-rule-subtle bg-raised p-3"
    >
      <div className="grid grid-cols-1 items-end gap-x-3 gap-y-2 @min-[30rem]:grid-cols-[4.25rem_minmax(0,1fr)]">
        <span aria-hidden className="hidden pb-0.5 type-meta text-ink-2 @min-[30rem]:block">
          The reel
        </span>
        {/* The part names only where each part has room for its word. */}
        {[true, false].map((labels) => (
          <div key={String(labels)} className={labels ? 'hidden @min-[30rem]:block' : '@min-[30rem]:hidden'}>
            <SegmentBar
              segments={reelSegments(REEL)}
              beats={REEL.beats}
              state="filled"
              tone="surface"
              labels={labels}
              numbers
              label={`The reel’s ${REEL.slots.length} slots and ${REEL.beats.length} music beats`}
            />
          </div>
        ))}
        <span aria-hidden className="hidden self-center type-meta text-ink-2 @min-[30rem]:block">
          Your cut
        </span>
        <ol
          aria-label={`Your cut: ${states.filter((s) => s === 'checked').length} of ${states.length} shots checked`}
          className="m-0 mt-2.5 flex list-none gap-1 p-0"
        >
          {states.map((state, k) => {
            const clip = clips[k];
            return (
              <li key={k} data-slot-state={state} className="relative min-w-0 flex-1">
                {state === 'waiting' ? (
                  <span
                    aria-hidden
                    className="flex aspect-[9/16] w-full items-center justify-center rounded-md bg-violet-soft type-caption font-semibold text-violet-strong"
                  >
                    {k + 1}
                  </span>
                ) : (
                  <motion.span
                    key={clip}
                    className="block"
                    initial={live ? { opacity: 0, scale: 0.7 } : false}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={POP}
                  >
                    <ClipFrame
                      sprite={frameOf(clip)}
                      className={cn(
                        'w-full rounded-md',
                        state === 'missed' &&
                          'outline-2 outline-offset-1 outline-violet-strong outline-dashed',
                      )}
                    />
                  </motion.span>
                )}
                {state === 'checked' ? (
                  <motion.span
                    aria-hidden
                    initial={live ? { opacity: 0, scale: 0.4 } : false}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={POP}
                    className="absolute -bottom-1.5 left-1/2 -ms-2 inline-grid size-4 place-items-center rounded-pill bg-violet text-violet-ink shadow-sticker"
                  >
                    <SHOWCASE_ICONS.approve strokeWidth={3.25} className="size-2.5" />
                  </motion.span>
                ) : null}
                {marked.has(k) ? (
                  <motion.span
                    aria-hidden
                    data-slot="beat-cut"
                    initial={live ? { scaleY: 0 } : false}
                    animate={{ scaleY: 1 }}
                    transition={POP}
                    className="absolute -top-2.5 -left-[3px] h-2 w-0.5 origin-bottom rounded-pill bg-rose"
                  />
                ) : null}
                <span className="sr-only">
                  {`Slot ${k + 1}: ${state === 'waiting' ? 'waiting' : state === 'missed' ? `misses ${REEL.slots[k]?.needs ?? 'its moment'}` : state === 'checked' ? 'checked' : 'placed'}`}
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <ul
        aria-label="Checked against the reel"
        className="m-0 mt-1 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0"
      >
        {CHECKS.map((check, i) => {
          const missed = missedNeeds && check.id === 'needs';
          const passed = !missed && i < frame.checks;
          const Mark = missed
            ? SHOWCASE_ICONS.toCheck
            : passed
              ? SHOWCASE_ICONS.passed
              : SHOWCASE_ICONS.pending;
          return (
            <li
              key={check.id}
              data-check={check.id}
              data-passed={passed || undefined}
              className="flex items-center gap-1.5 type-label-sm"
            >
              <Mark
                aria-hidden
                strokeWidth={2.25}
                className={cn(
                  'size-4 shrink-0',
                  passed || missed ? 'text-violet-strong' : 'text-rule-strong',
                )}
              />
              <span className={passed ? 'text-ink' : 'text-ink-2'}>{check.name}</span>
              <span className="sr-only">{missed ? ', missed' : passed ? ', passed' : ', waiting'}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
