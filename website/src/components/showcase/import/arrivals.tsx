// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: clips arriving in the library · mode: Operate · system: WEB2 Remix Vernacular (teal is yours)
 * rebuilt lean from the app's import progress (apps/renderer/src/features/library/imports/session-progress.tsx,
 *   import-words.ts STAGE_NAMES): each clip the phone sent, newest first, its frame from the owner's camera roll, what
 *   it shows, and the stage it has reached in the app's words beside a five-step meter (Receiving or
 *   copying, Checking the copy, Available to edit, Searchable, Fully analysed). A clip still to come holds its place
 *   as a dashed ghost row, so nothing below moves
 * states: a row per stage (neutral while it is copied and checked, teal once it is yours to edit, success when fully
 *   analysed) · ghost (scheduled, not sent yet; mounts only once a run starts) · empty (no clip yet: one line) · more
 *   than fit (the newest, and how many more are in the library). Not a control.
 * motion: a row rises in as it lands; the meter's steps fill by scaleX; the stage word crossfades (--dur-short,
 *   ease-out); reduced motion: at once */

import { ArrowDownToLine, CircleCheck, CopyCheck, Film, Search, type LucideIcon } from 'lucide-react';
import { AnimatePresence, motion, MotionConfig } from 'motion/react';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT, RISE } from '#lib/motion';
import { clipById } from '../auto-pick/roll';
import { Chip, type ChipTone } from '../chip';
import { ClipFrame } from '../frame';
import { type Arrival, STAGES, stageAt } from './ways';

const STAGE_ICONS: readonly LucideIcon[] = [ArrowDownToLine, CopyCheck, Film, Search, CircleCheck];
const STAGE_TONES: readonly ChipTone[] = ['neutral', 'neutral', 'you', 'you', 'success'];

/** The five steps as one short bar: filled up to the clip's stage. */
export function StageMeter({ stage, className }: { readonly stage: number; readonly className?: string }) {
  return (
    <span aria-hidden className={cn('flex w-full gap-0.5', className)}>
      {STAGES.map((name, i) => (
        <span key={name} className="relative h-1 min-w-0 flex-1 overflow-hidden rounded-pill bg-rule-subtle">
          <motion.span
            className={cn('absolute inset-0 origin-left rounded-pill', stage >= 4 ? 'bg-success-strong' : 'bg-teal-strong')}
            initial={false}
            animate={{ scaleX: i <= stage ? 1 : 0 }}
            transition={{ duration: DUR.short, ease: EASE_OUT }}
          />
        </span>
      ))}
    </span>
  );
}

/** A stage as the app says it, with its glyph, in its tone. */
export function StageChip({ stage }: { readonly stage: number }) {
  const at = Math.max(0, stage);
  const Icon = STAGE_ICONS[at] ?? ArrowDownToLine;
  return (
    <AnimatePresence initial={false} mode="popLayout">
      <motion.span
        key={at}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DUR.short, ease: EASE_OUT }}
        className="inline-flex"
      >
        <Chip tone={STAGE_TONES[at] ?? 'neutral'}>
          <Icon aria-hidden />
          {STAGES[at]}
        </Chip>
      </motion.span>
    </AnimatePresence>
  );
}

function Ghost() {
  return (
    <span className="flex h-full items-center gap-3 rounded-lg border border-dashed border-rule px-2 py-1.5">
      <span className="aspect-[9/16] w-5 shrink-0 rounded-sm bg-rule-subtle" />
      <span className="flex flex-1 flex-col gap-1.5">
        <span className="h-2 w-2/5 rounded-pill bg-rule-subtle" />
        <span className="h-2 w-1/4 rounded-pill bg-rule-subtle" />
      </span>
    </span>
  );
}

export function Arrivals({
  arrivals,
  clock,
  ran,
  max = 4,
  compact = false,
}: {
  readonly arrivals: readonly Arrival[];
  /** The run's clock, in ms: each row's stage follows it. */
  readonly clock: number;
  /** A run has started in this browser: rows still to come show as ghosts. */
  readonly ran: boolean;
  /** How many rows show at most (the newest). */
  readonly max?: number;
  readonly compact?: boolean;
}) {
  const landed = arrivals.filter((a) => a.sentAt <= clock);
  const coming = ran ? arrivals.filter((a) => a.sentAt > clock) : [];
  const shown = [...landed].reverse().slice(0, max);
  const ghosts = coming.slice(0, Math.max(0, max - shown.length));
  const hidden = landed.length - shown.length;
  const row = cn('relative', compact ? 'h-12' : 'h-14');
  return (
    <MotionConfig reducedMotion="user">
      <div className="flex flex-col gap-2">
        {landed.length === 0 && ghosts.length === 0 ? (
          <p className="m-0 type-body text-ink-2">Nothing yet. Clips join your library here as they land.</p>
        ) : null}
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          <AnimatePresence initial={false}>
            {shown.map((a) => {
              const clip = clipById(a.clipId);
              const stage = stageAt(clock - a.sentAt);
              return (
                <motion.li
                  key={a.clipId}
                  layout="position"
                  data-stage={stage}
                  initial={{ opacity: 0, y: -RISE }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DUR.short, ease: EASE_OUT }}
                  className={cn(row, 'flex items-center gap-3 rounded-lg bg-raised px-2 py-1.5 shadow-xs')}
                >
                  <ClipFrame sprite={clip.sprite} className={cn('shrink-0 rounded-sm', compact ? 'w-5' : 'w-6')} />
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="truncate type-label text-ink">{compact ? clip.short : clip.name}</span>
                    <StageMeter stage={stage} className="max-w-40" />
                  </span>
                  <span className="shrink-0">
                    <StageChip stage={stage} />
                  </span>
                </motion.li>
              );
            })}
          </AnimatePresence>
          {ghosts.map((a) => (
            <li key={a.clipId} aria-hidden data-ghost className={row}>
              <Ghost />
            </li>
          ))}
        </ul>
        {hidden > 0 ? (
          <p className="m-0 type-meta text-ink-2">
            And {hidden} more in your library.
          </p>
        ) : null}
      </div>
    </MotionConfig>
  );
}
