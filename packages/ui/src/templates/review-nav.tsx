// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the review's route through what to check (BRK1-REV) · system: DESIGN.md v0.7
 * one row under the strip: ◀ the thing to check before (K), how much is left ("3 to check · 9 approved"), the next
 *   (J) ▶, as vim moves down and up; at its end Undo for this session's fixes, and Approve the rest once nothing is left to check (never
 *   before: approving without looking is what the review is for not doing)
 * states: things to check (the dashed warning circle and the count) · nothing left (the success check: "Nothing
 *   left to check") · every slot approved (the success check and its words; no Approve) · approving (spins) ·
 *   undoing (Undo spins) · nothing to undo (Undo off) · read-only (the count alone)
 * motion: the count ticks when it changes (NumberTicker); reduced motion: at once
 */
import { Plural, useLingui } from '@lingui/react/macro';
import { Button } from '#components/button';
import { cn } from '#lib/cn';
import { REVIEW_ICONS } from './review-icons';
import { DOUBT_WORDS, type CheckItem, type ReviewCounts } from './review-checks';
import { useShortcutFormat } from '../palette/key-words';

export interface ReviewNavProps {
  counts: ReviewCounts;
  editable: boolean;
  onStep: (step: 1 | -1) => void;
  canUndo: boolean;
  /** What the last fix took out of view ("Text removed"), said beside Undo. */
  said?: string | null;
  /** What J and K are on now, for a screen reader ("Slot 4: This may be part of the scene, not text on top"). */
  current?: { item: CheckItem; slot: number | null } | null;
  className?: string | undefined;
  undoing: boolean;
  onUndo: () => void;
  approving: boolean;
  onApproveRest: () => void;
}

function CurrentWords({ item, slot }: { item: CheckItem; slot: number | null }) {
  const { t, i18n } = useLingui();
  const words = i18n._(DOUBT_WORDS[item.reason]);
  const number = slot === null ? null : i18n.number(slot + 1);
  return <>{number === null ? t`The whole reel: ${words}` : t`Slot ${number}: ${words}`}</>;
}

export function ReviewNav({
  counts,
  editable,
  onStep,
  canUndo,
  said = null,
  current = null,
  className,
  undoing,
  onUndo,
  approving,
  onApproveRest,
}: ReviewNavProps) {
  const { t, i18n } = useLingui();
  const keys = useShortcutFormat();
  const ToCheck = REVIEW_ICONS.toCheck;
  const Approved = REVIEW_ICONS.approved;
  const approved = i18n.number(counts.approved);
  const waiting = i18n.number(counts.waiting);
  return (
    <div data-slot="review-nav" className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', className)}>
      <div role="group" aria-label={t`The things to check`} className="flex items-center gap-1">
        <Button
          size="sm"
          variant="ghost"
          icon={REVIEW_ICONS.previous}
          aria-keyshortcuts="K"
          disabled={counts.toCheck === 0}
          onClick={() => onStep(-1)}
        >
          {t`Previous`}{' '}
          <kbd aria-hidden className="rounded-sm bg-chip px-1 type-caption text-ink-2">
            K
          </kbd>
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={REVIEW_ICONS.next}
          iconPlacement="end"
          aria-keyshortcuts="J"
          disabled={counts.toCheck === 0}
          onClick={() => onStep(1)}
        >
          {t`Next`}{' '}
          <kbd aria-hidden className="rounded-sm bg-chip px-1 type-caption text-ink-2">
            J
          </kbd>
        </Button>
      </div>
      <p role="status" data-slot="review-current" className="sr-only">
        {current ? <CurrentWords item={current.item} slot={current.slot} /> : null}
      </p>
      <p role="status" data-slot="review-count" className="m-0 flex items-center gap-1.5 type-body text-ink">
        {counts.toCheck > 0 ? (
          <>
            <ToCheck aria-hidden className="size-4 shrink-0 text-warning-strong" />
            <Plural value={counts.toCheck} one="# to check" other="# to check" />
            <span className="text-ink-2">· {t`${approved} approved`}</span>
          </>
        ) : counts.waiting === 0 ? (
          <>
            <Approved aria-hidden className="size-4 shrink-0 text-success-strong" />
            {t`Every slot approved`}
          </>
        ) : (
          <>
            <Approved aria-hidden className="size-4 shrink-0 text-success-strong" />
            {t`Nothing left to check`}
            <span className="text-ink-2">· {t`${approved} approved`}</span>
          </>
        )}
      </p>
      {editable ? (
        <div className="ms-auto flex flex-wrap items-center gap-2">
          <span role="status" data-slot="review-said" className="type-meta text-ink-2">
            {said}
          </span>
          <Button
            size="sm"
            variant="ghost"
            icon={REVIEW_ICONS.undo}
            aria-keyshortcuts={keys.aria('mod+z')}
            loading={undoing}
            disabled={!canUndo}
            onClick={onUndo}
          >
            {t`Undo`}
          </Button>
          {counts.toCheck === 0 && counts.waiting > 0 ? (
            <Button
              size="sm"
              variant="primary"
              icon={REVIEW_ICONS.looksRight}
              loading={approving}
              onClick={onApproveRest}
            >
              {counts.approved === 0 ? t`Approve all ${waiting}` : t`Approve the rest (${waiting})`}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
