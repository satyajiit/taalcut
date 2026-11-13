// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Paste, pick, approve: the three story frames · mode: Persuade · system: WEB2 Remix Vernacular
 * states: each frame follows its step's progress (0 to 1): at 1, the finished frame (server HTML, reduced motion,
 *   a step already seen); between, its parts pop in as the progress passes them; at 0, only its footage or its
 *   empty list · the reels' own Pause/Play (ReelFrame). Drawings otherwise: nothing here is a control.
 * Paste: the owner's reel playing while the five things Taalcut reads pop onto its edge. Pick: the slots taking
 * their clips from the camera roll, each with the AI-pick chip and how sure the AI is. Approve: your version, checked
 * against the reel, and the one Approve. */

import { Check, Link2, ListChecks, Undo2 } from 'lucide-react';
import { AnimatePresence, motion, type MotionValue, useMotionValueEvent, useTransform } from 'motion/react';
import { type ReactNode, useState } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { ReelFrame } from '#components/ui/reel-frame';
import { SegmentBar } from '#components/ui/segment-bar';
import type { Segment } from '#components/ui/segments';
import { Sticker, type StickerField } from '#components/ui/sticker';
import { HOW, ROLL_PROBLEM, type Sure } from '#content/home';
import { smallPoster } from '#content/reels';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { AiPickChip, SureMeter, Thumb } from './kit';
import { REEL, SLOT_PICKS } from './reel-data';

export interface FrameProps {
  /** This step's progress, 0 to 1. */
  readonly progress: MotionValue<number>;
}

/** A story bar of n equal parts, filled by the step's progress. */
function storyBar(n: number): Segment[] {
  return Array.from({ length: n }, (_, i) => ({ start: i, end: i + 1, group: 'build' as const }));
}

function StoryBar({ progress, parts, tone }: FrameProps & { readonly parts: number; readonly tone: 'video' | 'surface' }) {
  const time = useTransform(progress, (v) => v * parts);
  return <SegmentBar segments={storyBar(parts)} time={time} state="playing" tone={tone} decorative />;
}

/** Shows its part once the step's progress passes `at`, with a sticker's pop. */
function Reveal({ progress, at, children, className }: FrameProps & { readonly at: number; readonly children: ReactNode; readonly className?: string }) {
  const opacity = useTransform(progress, [at, at + 0.05], [0, 1]);
  const scale = useTransform(progress, [at, at + 0.05], [0.75, 1]);
  return (
    <motion.span style={{ opacity, scale }} className={cn('block', className)}>
      {children}
    </motion.span>
  );
}

/** Where in the Approve step the pill turns to Approved, and how fast it swaps. */
const APPROVED_AT = 0.81;
const PILL_SWAP = { duration: 0.2 } as const;

const READ_FIELDS: readonly StickerField[] = ['pink', 'sky', 'lime', 'violet', 'teal'];
const READ_PLACES = ['top-[18%] -right-3', 'top-[30%] -left-3', 'top-[42%] -right-4', 'top-[54%] -left-2', 'top-[66%] -right-3'] as const;

export function PasteFrame({ progress }: FrameProps) {
  const step = HOW.steps[0];
  return (
    <ReelFrame
      sources={REEL.reference}
      poster={smallPoster(REEL.id) ?? REEL.poster}
      label={`${step.title}: ${step.line}`}
      bar={<StoryBar progress={progress} parts={step.reads.length} tone="video" />}
      bottom={
        <span className="inline-flex h-10 max-w-full items-center gap-2 rounded-pill bg-sticker-paper px-4 type-label text-sticker-paper-ink shadow-sticker">
          <Link2 aria-hidden strokeWidth={ICON_STROKE} className="size-4 shrink-0" />
          <span className="truncate">instagram.com/reel/…</span>
        </span>
      }
      stickers={step.reads.map((word, i) => (
        <span key={word} className={cn('absolute', READ_PLACES[i])}>
          <Reveal progress={progress} at={0.08 + i * 0.16}>
            <Sticker field={READ_FIELDS[i]} size="sm" tilt={i % 2 ? 4 : -5} pop={false}>
              {word}
            </Sticker>
          </Reveal>
        </span>
      ))}
    />
  );
}

/** The four slots the Pick frame lists: the hook, a build whose cut the AI wasn't sure of, the fast peak, the outro. */
const PICK_ROWS: readonly { readonly n: number; readonly sure: Sure }[] = [
  { n: 1, sure: 'high' },
  { n: 4, sure: 'medium' },
  { n: 9, sure: 'medium' },
  { n: 13, sure: 'high' },
];
const PART = { hook: 'Hook', build: 'Build', peak: 'Peak', outro: 'Outro' } as const;

export function PickFrame({ progress }: FrameProps) {
  const count = useTransform(progress, (v) => HOW.picked(Math.round(v * SLOT_PICKS.length), SLOT_PICKS.length));
  const others = SLOT_PICKS.slice(5, 8);
  return (
    <div className="relative flex aspect-[9/16] w-full flex-col gap-3 overflow-hidden rounded-reel bg-panel p-3 text-ink shadow-reel ring-1 ring-rule-subtle">
      <StoryBar progress={progress} parts={SLOT_PICKS.length} tone="surface" />
      <p className="mt-1 flex items-center gap-1.5 px-1 type-label font-semibold text-violet-strong">
        <AiMark className="size-4" />
        <motion.span>{count}</motion.span>
      </p>
      <ul className="flex flex-col gap-2">
        {PICK_ROWS.map((row, i) => {
          const slot = SLOT_PICKS[row.n - 1]!;
          return (
            <li key={row.n}>
              <Reveal progress={progress} at={0.06 + i * 0.2} className="origin-left">
                <span className="flex items-center gap-2.5 rounded-xl bg-raised p-2 shadow-xs ring-1 ring-rule-subtle">
                  <Thumb sprite={slot.sprite} className="aspect-[9/16] w-9 shrink-0 rounded-md" />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="type-caption font-semibold text-ink">
                      Slot {row.n} · {PART[slot.role]}
                    </span>
                    <span className="line-clamp-2 type-caption text-ink-2">{slot.needs}</span>
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <AiPickChip label={ROLL_PROBLEM.pickChip} />
                      <SureMeter sure={row.sure} />
                    </span>
                  </span>
                </span>
              </Reveal>
            </li>
          );
        })}
      </ul>
      <Reveal progress={progress} at={0.86} className="mt-auto origin-left">
        <span className="flex items-center gap-2 px-1 type-caption text-ink-2">
          <span aria-hidden className="flex -space-x-2">
            {others.map((s) => (
              <Thumb key={s.n} sprite={s.sprite} className="aspect-square w-6 rounded-full ring-2 ring-panel" />
            ))}
          </span>
          {HOW.others}
        </span>
      </Reveal>
    </div>
  );
}

/** Approve, then Approved once the step passes 0.8: one pill at a time, so the server HTML holds no hidden words. */
function ApprovePill({ progress }: FrameProps) {
  const [approved, setApproved] = useState(() => progress.get() >= APPROVED_AT);
  useMotionValueEvent(progress, 'change', (v) => setApproved(v >= APPROVED_AT));
  return (
    <span className="relative inline-grid h-11 place-items-center">
      <AnimatePresence initial={false}>
        {approved ? (
          <motion.span
            key="approved"
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            transition={PILL_SWAP}
            className="col-start-1 row-start-1 inline-flex h-11 items-center gap-2 rounded-pill bg-teal px-6 type-label font-semibold text-teal-ink shadow-sticker"
          >
            <Check aria-hidden strokeWidth={ICON_STROKE + 0.5} className="size-4" />
            {HOW.approved}
          </motion.span>
        ) : (
          <motion.span
            key="approve"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={PILL_SWAP}
            className="col-start-1 row-start-1 inline-flex h-11 items-center gap-2 rounded-pill bg-inverse px-6 type-label font-semibold text-on-inverse shadow-sticker"
          >
            <Check aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
            {HOW.approve}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

export function ApproveFrame({ progress }: FrameProps) {
  const step = HOW.steps[2];
  return (
    <ReelFrame
      sources={REEL.reference}
      poster={smallPoster(REEL.id) ?? REEL.poster}
      label={`${HOW.version}: ${step.line}`}
      bar={<StoryBar progress={progress} parts={step.reads.length} tone="video" />}
      bottom={<ApprovePill progress={progress} />}
      stickers={
        <>
          <span className="absolute top-[22%] -right-4">
            <Reveal progress={progress} at={0.12}>
              <Sticker field="violet" icon={ListChecks} size="sm" tilt={-4} pop={false}>
                {step.reads[0]}
              </Sticker>
            </Reveal>
          </span>
          <span className="absolute top-[64%] -left-3">
            <Reveal progress={progress} at={0.45}>
              <Sticker field="teal" icon={Undo2} size="sm" tilt={5} pop={false}>
                {HOW.undo}
              </Sticker>
            </Reveal>
          </span>
        </>
      }
    />
  );
}
