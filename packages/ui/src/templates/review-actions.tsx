// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the review's actions row (BRK1-REV) · system: DESIGN.md v0.7
 * Looks right (the screen's one primary while anything is left to check; it approves the slot on screen), Fix (the
 *   direct fixes, fix-menu.tsx) and Tell Taalcut (violet, the AI mark; it opens the proposals under the slot)
 * states: working (the pressed action spins, Fix waits while a fix runs) · approved (Looks right rests) · nothing
 *   left to check (Looks right steps back to secondary: Approve the rest is the primary then)
 */
import { useLingui } from '@lingui/react/macro';
import type { Template } from '@taalcut/core';
import { AiMark } from '#components/ai-mark';
import { Button } from '#components/button';
import { cutTime } from './cut-math';
import { FixMenu } from './fix-menu';
import { REVIEW_ICONS } from './review-icons';
import type { ReviewEdits } from './use-review-edits';

export interface ReviewActionsProps {
  template: Template;
  index: number;
  /** How many things are left to check in the whole template. */
  toCheck: number;
  /** A doubt about the whole reel is current: its own answers lead, and Looks right (a slot's) steps back. */
  reelFirst?: boolean;
  edits: ReviewEdits;
  /** Where the playhead is, in seconds, and whether a cut can go there. */
  playhead: () => number;
  canCutAtPlayhead: () => boolean;
  /** Fix opened: the reel pauses there. */
  onMenuOpen?: () => void;
  onLooksRight: () => void;
  onMoveCut: () => void;
  onRename: () => void;
  /** Tell Taalcut's toggle; undefined hides it. */
  telling?: { open: boolean; onToggle: () => void } | undefined;
}

const FIXING = ['moveCut', 'split', 'notCut', 'drop', 'setRole', 'tempo', 'approve'];

export function ReviewActions({
  template,
  index,
  toCheck,
  reelFirst = false,
  edits,
  playhead,
  canCutAtPlayhead,
  onMenuOpen,
  onLooksRight,
  onMoveCut,
  onRename,
  telling,
}: ReviewActionsProps) {
  const { t, i18n } = useLingui();
  const slot = template.slots[index]!;
  const number = i18n.number(index + 1);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        data-slot="looks-right"
        size="sm"
        variant={toCheck > 0 && !reelFirst ? 'primary' : 'secondary'}
        icon={REVIEW_ICONS.looksRight}
        loading={edits.pending === 'approve'}
        disabled={slot.approved}
        onClick={onLooksRight}
      >
        {t`Slot ${number} looks right`}
      </Button>
      <FixMenu
        template={template}
        index={index}
        busy={FIXING.includes(edits.pending ?? '')}
        canCutAtPlayhead={canCutAtPlayhead}
        playhead={playhead}
        onOpen={onMenuOpen}
        onAddCut={() => void edits.run({ kind: 'split', slotId: slot.id, at: cutTime(template, playhead()) })}
        onMoveCut={onMoveCut}
        onNotCut={() => void edits.run({ kind: 'notCut', slotId: slot.id })}
        onDrop={() => void edits.run({ kind: 'drop', index })}
        onRename={onRename}
        onUnapprove={() => void edits.run({ kind: 'approve', indices: [index], approved: false })}
        onRole={(role) => void edits.run({ kind: 'setRole', slotId: slot.id, role })}
        onTempo={(factor) => void edits.run({ kind: 'tempo', factor })}
      />
      {telling ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<AiMark className="size-3.5" />}
          aria-expanded={telling.open}
          onClick={telling.onToggle}
        >
          {t`Tell Taalcut`}
        </Button>
      ) : null}
    </div>
  );
}
