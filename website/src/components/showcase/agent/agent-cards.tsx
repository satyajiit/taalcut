// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the chat's cards · mode: Operate · system: WEB2 Remix Vernacular (Cards and plates: decision cards raised,
 *   a rule hairline all round, xl radius, no shadow, no stripe; a review card a hairline frame)
 * rebuilt lean from packages/ui/src/cards/{edit-changes-card,export-approval-card,export-review}.tsx: "What changed",
 *   one row per change in the editor's words, a swap shown as the clip it had and the clip it has now (the owner's
 *   footage) with what the slot's moment needs, Undo (takes back the last) and Redo; then the one approval, "Ready to
 *   export": the cut's first frame, what the check found, and Review and export, which turns the reel beside the chat
 *   to Your version, where Export is the go-ahead (an ink pill: the page's one marigold is its waitlist button)
 * states: changes: applied · some undone (Redo; a swap taken back misses its moment again, and the check says so) ·
 *   all undone ("Nothing on the timeline changed.") · buttons: default, hover, focus, active, disabled · approval:
 *   checking (the count climbing, Review and export resting) · waiting · missed (the slot named, the approval held) ·
 *   reviewing (Your version on the reel: Export, Not now) · exported (the tick, in teal: yours)
 * motion: an undone row fades out, a redone one fades in (opacity, --dur-short); reduced motion: the 150 ms fade */

import { ArrowRight } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useId } from 'react';
import { buttonClasses } from '#components/ui/button';
import { cn } from '#lib/cn';
import { DUR, EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { ClipFrame } from '../frame';
import { frameOf } from '../frames';
import { SHOWCASE_ICONS } from '../icons';
import { INK_PILL } from '../launch-videos/ink';
import { applied, type Change, CHANGES, CHECKS, PICKS, REEL } from './run-script';
import type { Review } from './use-agent-run';

const FADE = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: DUR.short, ease: EASE_OUT },
};

function Thumbs({ change }: { readonly change: Change }) {
  const before = change.swap?.before ?? PICKS[0];
  const after = change.swap?.after ?? PICKS[0];
  return (
    <span aria-hidden className="flex shrink-0 items-center gap-1">
      <ClipFrame sprite={frameOf(before)} className="w-8 rounded-md opacity-80" />
      <ArrowRight className="size-3.5 text-ink-3" />
      <span className="relative block">
        <ClipFrame
          sprite={frameOf(after)}
          className="w-8 rounded-md ring-2 ring-violet-strong ring-offset-1 ring-offset-canvas"
        />
        {change.swap ? null : (
          <span className="absolute inset-x-0.5 top-1/2 -translate-y-1/2 rounded-sm bg-violet px-0.5 text-center text-[0.6875rem] leading-4 font-bold text-violet-ink">
            Aa
          </span>
        )}
      </span>
    </span>
  );
}

export function ChangesCard({
  undone,
  happened,
  onUndo,
  onRedo,
}: {
  readonly undone: number;
  /** Whether each change has happened yet in the run (a swap once the check makes it; the rest once it is over). */
  readonly happened: (change: Change) => boolean;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
}) {
  const rows = applied(undone);
  const last = CHANGES[CHANGES.length - undone];
  const Undo = SHOWCASE_ICONS.undo;
  const Redo = SHOWCASE_ICONS.redo;
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-rule-subtle p-4"
      data-slot="changes"
    >
      <header className="flex items-center gap-2">
        <h4 id={id} className="m-0 type-card-title text-ink">
          What changed
        </h4>
        {undone > 0 ? <Chip>Undone {undone}</Chip> : null}
      </header>
      {rows.length === 0 ? (
        <p className="m-0 type-body text-ink-2">Nothing on the timeline changed.</p>
      ) : null}
      <ul aria-label="Changes" className="m-0 flex list-none flex-col gap-2.5 p-0">
        <AnimatePresence initial={false}>
          {rows.map((row) => (
            <motion.li
              key={row.id}
              {...FADE}
              data-change={row.id}
              data-pending={happened(row) ? undefined : true}
              className={cn(
                'flex items-center gap-3 transition-opacity duration-(--dur-short)',
                !happened(row) && 'opacity-45',
              )}
            >
              <Thumbs change={row} />
              <span className="flex min-w-0 flex-col">
                <span className="type-body text-ink">
                  <span className="font-medium">{row.target}</span>: {row.what}
                </span>
                {row.needs ? (
                  <span className="type-meta text-ink-2">Its moment: {row.needs.toLowerCase()}</span>
                ) : null}
              </span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <div className="mt-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClasses('secondary', 'md')}
          onClick={onUndo}
          disabled={rows.length === 0}
        >
          <Undo aria-hidden className="size-4" />
          Undo
        </button>
        <button
          type="button"
          className={buttonClasses('quiet', 'md')}
          onClick={onRedo}
          disabled={undone === 0}
        >
          <Redo aria-hidden className="size-4" />
          Redo
        </button>
        <span role="status" className="type-meta text-ink-2">
          {undone > 0 && last ? `Undone: ${last.target}, ${last.what}.` : ''}
        </span>
      </div>
    </section>
  );
}

export function ApprovalCard({
  checks,
  missed,
  done,
  review,
  onReview,
  onExport,
  onNotNow,
}: {
  /** How many checks have passed. */
  readonly checks: number;
  /** The slots that miss their moment (a swap taken back). */
  readonly missed: readonly number[];
  /** The run is over. */
  readonly done: boolean;
  readonly review: Review;
  readonly onReview: () => void;
  readonly onExport: () => void;
  readonly onNotNow: () => void;
}) {
  const Passed = SHOWCASE_ICONS.passed;
  const Missed = SHOWCASE_ICONS.toCheck;
  const Running = SHOWCASE_ICONS.running;
  const Play = SHOWCASE_ICONS.play;
  const Tick = SHOWCASE_ICONS.approve;
  const id = useId();
  const held = missed.length > 0;
  const passed = held ? checks - 1 : checks;
  const first = missed[0];
  return (
    <section
      aria-labelledby={id}
      data-slot="approval"
      data-status={review}
      className="flex min-w-0 flex-col gap-3 self-start rounded-xl border border-rule bg-raised p-4"
    >
      <h4 id={id} className="m-0 type-card-title font-bold text-ink">
        Ready to export
      </h4>
      <div className="flex items-start gap-4">
        <ClipFrame sprite={frameOf(PICKS[0])} className="w-14 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-col gap-3">
          <p className="m-0 flex flex-wrap items-center gap-x-2 type-body text-ink">
            {held ? (
              <Missed aria-hidden className="size-4 shrink-0 text-violet-strong" />
            ) : done ? (
              <Passed aria-hidden className="size-4 shrink-0 text-violet-strong" />
            ) : (
              <Running
                aria-hidden
                className="size-4 shrink-0 animate-spin text-ai-strong motion-reduce:animate-none"
              />
            )}
            <span className="tabular-nums">
              Checked: {passed} of {CHECKS.length} passed
            </span>
          </p>
          {held && first !== undefined ? (
            <p className="m-0 type-meta text-pretty text-ink-2">
              Clip {first + 1} misses its moment, {REEL.slots[first]?.needs.toLowerCase()}. Redo the change to
              put its shot back.
            </p>
          ) : null}
          {review === 'exported' ? (
            <p role="status" className="m-0 flex items-center gap-2 type-body text-ink">
              <Tick aria-hidden className="size-4 shrink-0 text-teal-strong" />
              Exported. MP4 for Reels, Shorts and TikTok.
            </p>
          ) : review === 'reviewing' ? (
            <div className="flex flex-col gap-2.5">
              <p role="status" className="m-0 type-body text-pretty text-ink">
                Your version is on the reel. Export it?
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className={INK_PILL} onClick={onExport}>
                  <Tick aria-hidden className="size-4" />
                  Export
                </button>
                <button type="button" className={buttonClasses('quiet', 'md')} onClick={onNotNow}>
                  Not now
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className={`${INK_PILL} w-fit`} onClick={onReview} disabled={!done || held}>
              <Play aria-hidden className="size-4" />
              Review and export
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
