// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: a slot and its pick · mode: Operate · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 (violet the AI, teal you, rose the slot)
 * one row of the app's cast grid (packages/ui/src/make/cast-grid.tsx), for the reel's first fast slot: its number,
 *   role and time; what it wants, in the reel's words; the pick in the slot's solid outline with the violet "AI
 *   pick" chip and how sure the AI is (a word beside a three-step meter in neutral ink); and three other shots to
 *   swap in. Using one flies it into the slot and the pick back to the row; the slot is then yours, in teal, "You
 *   changed this", and Back to the AI pick undoes it. The frames are the owner's footage (the camera roll's atlas)
 * states: AI pick (violet chip, how sure) · yours (teal chip, how sure, the AI's pick named) · other-shot buttons:
 *   default, hover (the hover surface), focus (base ring), active (gives 1 %), disabled n/a · loading/error n/a
 * motion: the swap is a shared-layout flight (transform and opacity, --dur-short); reduced motion: at once, faded */

import { LayoutGroup, motion, MotionConfig } from 'motion/react';
import { useState } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { buttonClasses } from '#components/ui/button';
import { DEFAULT_REEL_ID, reelById } from '#content/reels';
import { DUR, EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { ClipFrame } from '../frame';
import { ROLE_ICONS, SHOWCASE_ICONS } from '../icons';
import { formatTime } from '../timecode';
import { Confidence, type ConfidenceLevel } from './confidence';
import { SAMPLE_ROLL, type RollClip } from './roll';

/** How sure the AI is of each shot for this slot (a sample), and the three other shots it keeps to swap in. */
const PICK_LEVEL: ConfidenceLevel = 'high';
const OTHERS: readonly { readonly id: string; readonly level: ConfidenceLevel }[] = [
  { id: 'repeat-09', level: 'medium' },
  { id: 'vietnam-11', level: 'medium' },
  { id: 'airport-03', level: 'low' },
];
const FLIGHT = { duration: DUR.short, ease: EASE_OUT };

const rollClip = (id: string): RollClip | undefined => SAMPLE_ROLL.find((c) => c.id === id);

export function SlotPick() {
  const slots = reelById(DEFAULT_REEL_ID).slots;
  const index = slots.findIndex((s) => s.role === 'peak');
  const slot = slots[index];
  const aiId = slot?.pick.clipId ?? '';
  const [chosen, setChosen] = useState<string>(aiId);
  const ai = rollClip(aiId);
  const picked = rollClip(chosen) ?? ai;
  if (!slot || !ai || !picked) return null;
  const levels = new Map<string, ConfidenceLevel>([[ai.id, PICK_LEVEL], ...OTHERS.map((o) => [o.id, o.level] as const)]);
  const others = [ai.id, ...OTHERS.map((o) => o.id)].filter((id) => id !== picked.id).flatMap((id) => rollClip(id) ?? []);
  const yours = picked.id !== ai.id;
  const Role = ROLE_ICONS.peak;
  const Undo = SHOWCASE_ICONS.undo;

  return (
    <MotionConfig reducedMotion="user">
      <LayoutGroup>
        <div className="flex flex-col gap-4">
          <header className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="m-0 type-section text-ink">Slot {index + 1}</h3>
            <Chip tone="peak">
              <Role aria-hidden />
              Peak
            </Chip>
            <span className="tc-mono type-meta text-ink-2">
              {formatTime(slot.start)} to {formatTime(slot.end)}
            </span>
          </header>
          <p className="m-0 type-body text-ink">
            <span className="text-ink-2">Wants: </span>
            {slot.needs}
          </p>
          <div className="flex items-start gap-4">
            <div className="w-28 shrink-0 rounded-lg border-2 border-beat-strong p-1 sm:w-32">
              <motion.span layoutId={`slot-${picked.id}`} transition={FLIGHT} className="block">
                <ClipFrame sprite={picked.sprite} className="w-full" />
              </motion.span>
            </div>
            <div data-slot="pick" data-by={yours ? 'you' : 'ai'} className="flex min-w-0 flex-col gap-2 pt-1" aria-live="polite">
              {yours ? (
                <Chip tone="you">You changed this</Chip>
              ) : (
                <Chip tone="ai">
                  <AiMark />
                  AI pick
                </Chip>
              )}
              <p className="m-0 type-body text-ink">{picked.name}</p>
              <Confidence level={levels.get(picked.id) ?? PICK_LEVEL} />
              {yours ? (
                <>
                  <p className="m-0 type-body text-ink-2">Taalcut picked “{ai.name}”.</p>
                  <button type="button" className={buttonClasses('secondary', 'md', 'w-fit')} onClick={() => setChosen(ai.id)}>
                    <Undo aria-hidden className="size-4" />
                    Back to the AI pick
                  </button>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <h4 className="m-0 type-label text-ink-2">Other shots</h4>
            <ul className="m-0 grid list-none grid-cols-[repeat(3,minmax(0,6.5rem))] gap-2 p-0">
              {others.map((item) => (
                <li key={item.id} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setChosen(item.id)}
                    className="flex w-full flex-col gap-1.5 rounded-lg p-1 text-start transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out) hover:bg-hover active:scale-[0.99] active:bg-pressed motion-reduce:active:scale-100"
                  >
                    <motion.span aria-hidden layoutId={`slot-${item.id}`} transition={FLIGHT} className="block">
                      <ClipFrame sprite={item.sprite} className="w-full" />
                    </motion.span>
                    {item.id === ai.id ? (
                      <Chip tone="ai">
                        <AiMark />
                        AI pick<span className="sr-only">, {item.name}</span>
                      </Chip>
                    ) : (
                      <span className="block truncate px-0.5 type-meta text-ink">
                        <span className="sr-only">Use this: </span>
                        {item.short}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </LayoutGroup>
    </MotionConfig>
  );
}
