// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { ProjectId, Result, TaalcutError, Template } from '@taalcut/core';
import { useEffect, useRef, useState } from 'react';
import { toast } from '../feedback/toast-store';
import { editWords, REMOVES } from './edit-words';
import { REVIEW_COMMANDS } from './review-commands';
import type { ReviewEdit, ReviewEditKind } from './review-edit';
import { slotEditCommand } from './use-slot-edits';

export type { ReviewEdit, ReviewEditKind } from './review-edit';

/** A fix this session made, with what it did in words (said again by Undo). */
export interface MadeEdit {
  readonly edit: ReviewEdit;
  readonly words: string;
}

export function reviewEditCommand(
  template: Template,
  projectId: ProjectId | null,
  edit: ReviewEdit,
  /** The head after this session's last fix, when the page hasn't read it yet (Accept all, one after another). */
  head: number = template.version,
): { name: string; payload: unknown } {
  const base = { projectId, templateId: template.id, baseVersion: head };
  const at = head === template.version ? template : { ...template, version: head };
  switch (edit.kind) {
    case 'rename':
    case 'merge':
    case 'drop':
    case 'approve':
      return slotEditCommand(at, projectId, edit);
    case 'moveCut':
      return {
        name: REVIEW_COMMANDS.moveCut,
        payload: { ...base, slotId: edit.slotId, to: edit.to, snap: edit.snap },
      };
    case 'split':
      return {
        name: REVIEW_COMMANDS.splitSlot,
        payload: { ...base, slotId: edit.slotId, at: edit.at },
      };
    case 'notCut': {
      const index = template.slots.findIndex((slot) => slot.id === edit.slotId);
      const before = template.slots[index - 1];
      return slotEditCommand(at, projectId, { kind: 'merge', index: before ? index - 1 : index });
    }
    case 'setRole':
      return { name: REVIEW_COMMANDS.setRole, payload: { ...base, slotId: edit.slotId, role: edit.role } };
    case 'describe':
      return {
        name: REVIEW_COMMANDS.editIntent,
        payload: { ...base, slotId: edit.slotId, intent: { text: edit.text } },
      };
    case 'notText':
      return { name: REVIEW_COMMANDS.removeText, payload: { ...base, overlayIds: [...edit.overlayIds] } };
    case 'tempo':
      return { name: REVIEW_COMMANDS.setTempo, payload: { ...base, factor: edit.factor } };
    case 'dismiss':
      return {
        name: REVIEW_COMMANDS.dismissDoubt,
        payload: { ...base, target: edit.target, reason: edit.reason },
      };
    case 'soundCredit':
      return { name: REVIEW_COMMANDS.setSoundCredit, payload: { ...base, credit: edit.credit } };
    case 'setMotion':
      return {
        name: REVIEW_COMMANDS.setMotion,
        payload: { ...base, slotId: edit.slotId, motion: edit.motion },
      };
    case 'setGraphic':
      return {
        name: REVIEW_COMMANDS.setGraphic,
        payload: { ...base, overlayId: edit.overlayId, graphic: edit.graphic },
      };
    case 'editBrief':
      return {
        name: REVIEW_COMMANDS.editGraphic,
        payload: { ...base, overlayId: edit.overlayId, brief: edit.brief },
      };
    case 'proposal':
      return { name: edit.proposal.command, payload: { ...edit.proposal.payload, ...base } };
  }
}

export interface ReviewEditsOptions {
  template: Template;
  projectId: ProjectId | null;
  dispatch?: ((name: string, payload: unknown) => Promise<Result<unknown>>) | undefined;
  undo?: (() => Promise<Result<unknown>>) | undefined;
  /**
   * Where a fix that takes something out of view says so: a toast with Undo (a page), or `said`, for the review to
   * show beside its own Undo (a modal sheet, whose page's toasts can't be reached while it is open).
   */
  announce?: 'toast' | 'inline';
}

/**
 * Runs the review's fixes as commands. Every fix says what it did beside Undo, in a status a screen reader hears
 * ("The cut before slot 4 moved to 3.47s"); on a page, one that takes something out of view (a dropped slot, a cut
 * that wasn't one, text that wasn't text) says it in a toast with Undo instead, as the rest of the app does. Every
 * fix this session can be undone from the review's Undo, which is the same as ⌘Z, and Undo says what it took back.
 * A failure stays in the panel as one line.
 */
export function useReviewEdits({
  template,
  projectId,
  dispatch,
  undo,
  announce = 'toast',
}: ReviewEditsOptions) {
  const { t, i18n } = useLingui();
  const [pending, setPending] = useState<ReviewEditKind | 'undo' | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  // This session's fixes, newest last: Undo takes the last one back (and Tell Taalcut's row says so).
  const [made, setMade] = useState<readonly MadeEdit[]>([]);
  const stack = useRef<readonly MadeEdit[]>([]);
  const keep = (next: readonly MadeEdit[]) => {
    stack.current = next;
    setMade(next);
  };
  const [said, setSaid] = useState<string | null>(null);
  // The head a fix made, until the page reads it: the next fix is made on it, not on the version still on screen.
  const head = useRef<number | null>(null);
  useEffect(() => {
    head.current = null;
  }, [template.version]);

  const undoOnce = async (): Promise<boolean> => {
    if (!undo) return false;
    setPending('undo');
    setSaid(null);
    head.current = null;
    const result = await undo();
    setPending(null);
    if (!result.ok) {
      setError(result.error);
      return false;
    }
    setError(null);
    const last = stack.current.at(-1);
    keep(stack.current.slice(0, -1));
    // Said beside Undo, so taking a fix back is never silent, and says what came back.
    const what = last?.words ?? null;
    setSaid(what ? t`Undone: ${what}` : t`Undone`);
    return true;
  };

  /** Runs a fix; resolves with its failure, or null when it was made. `quiet` keeps a failure off the panel. */
  async function attempt(edit: ReviewEdit, quiet = false): Promise<TaalcutError | null> {
    if (!dispatch) return null;
    const { name, payload } = reviewEditCommand(template, projectId, edit, head.current ?? template.version);
    setPending(edit.kind);
    setError(null);
    setSaid(null);
    const result = await dispatch(name, payload);
    setPending(null);
    if (!result.ok) {
      if (!quiet) setError(result.error);
      return result.error;
    }
    const made = (result.value as { result?: { version?: unknown } } | null)?.result?.version;
    if (typeof made === 'number' && made > template.version) head.current = made;
    const words = editWords(i18n, template, edit);
    keep([...stack.current, { edit, words }]);
    if (announce === 'inline' || !REMOVES.has(edit.kind)) setSaid(words);
    else
      toast({
        title: words,
        ...(undo ? { action: { label: t`Undo`, onSelect: () => void undoOnce() } } : {}),
      });
    return null;
  }

  const run = async (edit: ReviewEdit): Promise<boolean> =>
    Boolean(dispatch) && (await attempt(edit)) === null;

  return {
    run,
    attempt,
    undo: undoOnce,
    pending,
    error,
    /** What the last fix or Undo did, said beside Undo (a removal on a page toasts instead). */
    said,
    /** This session's fixes still standing, oldest first. */
    made,
    clearError: () => setError(null),
    canEdit: Boolean(dispatch),
    canUndo: Boolean(undo) && made.length > 0,
  };
}

export type ReviewEdits = ReturnType<typeof useReviewEdits>;
