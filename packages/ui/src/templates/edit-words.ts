// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a review fix did, in words (BRK1-REV): said beside Undo, and in a screen reader's status, for every fix
 * ("The cut before slot 4 moved to 3.47s", "Slot 2 is now the hook", "Now 60 beats a minute"), and again by Undo
 * ("Undone: …"). Written from the template before the fix, so the slot numbers are the ones the person saw.
 */
import type { I18n } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import type { Id, Template } from '@taalcut/core';
import { proposalWords } from './proposal-words';
import { MOTION_LABELS, ROLE_LABELS, toSeconds } from './slot-words';
import type { ReviewEdit } from './review-edit';

/** Fixes that take something out of view: on a page they toast with Undo, as the rest of the app does. */
export const REMOVES: ReadonlySet<ReviewEdit['kind']> = new Set(['drop', 'merge', 'notCut', 'notText']);

export function editWords(i18n: I18n, template: Template, edit: ReviewEdit): string {
  const numberOf = (slotId: Id<'TemplateSlot'>) =>
    i18n.number(template.slots.findIndex((slot) => slot.id === slotId) + 1);
  const seconds = (time: Parameters<typeof toSeconds>[0]) =>
    i18n.number(toSeconds(time), {
      style: 'unit',
      unit: 'second',
      unitDisplay: 'narrow',
      maximumFractionDigits: 2,
    });
  switch (edit.kind) {
    case 'drop': {
      const n = i18n.number(edit.index + 1);
      return i18n._(msg`Slot ${n} dropped`);
    }
    case 'merge': {
      const n = i18n.number(edit.index + 1);
      const next = i18n.number(edit.index + 2);
      return i18n._(msg`Slots ${n} and ${next} merged`);
    }
    case 'notCut': {
      const n = numberOf(edit.slotId);
      return i18n._(msg`The cut before slot ${n} is gone`);
    }
    case 'notText':
      return i18n._(msg`Text removed`);
    case 'rename': {
      const n = i18n.number(edit.index + 1);
      return i18n._(msg`Slot ${n} renamed`);
    }
    case 'approve': {
      if (edit.indices.length === 1) {
        const n = i18n.number(edit.indices[0]! + 1);
        return edit.approved ? i18n._(msg`Slot ${n} approved`) : i18n._(msg`Slot ${n} is to check again`);
      }
      const count = edit.indices.length;
      return i18n._(msg`${plural(count, { one: '# slot approved', other: '# slots approved' })}`);
    }
    case 'moveCut': {
      const n = numberOf(edit.slotId);
      const at = seconds(edit.to);
      return i18n._(msg`The cut before slot ${n} moved to ${at}`);
    }
    case 'split': {
      const at = seconds(edit.at);
      return i18n._(msg`Cut added at ${at}`);
    }
    case 'setRole': {
      const n = numberOf(edit.slotId);
      const role = i18n._(ROLE_LABELS[edit.role]);
      return i18n._(msg`Slot ${n}’s part is now ${role}`);
    }
    case 'describe': {
      const n = numberOf(edit.slotId);
      return i18n._(msg`Slot ${n}’s description changed`);
    }
    case 'tempo': {
      const bpm = template.beatMap?.bpm;
      if (!bpm) return edit.factor === 2 ? i18n._(msg`Twice as many beats`) : i18n._(msg`Half as many beats`);
      const next = i18n.number(Math.round(bpm * edit.factor));
      return i18n._(msg`Now ${next} beats a minute`);
    }
    case 'dismiss': {
      if (edit.target.kind === 'text') return i18n._(msg`Kept as text`);
      if (edit.reason === 'cutUnsure' || edit.reason === 'cutMaybeTransition') {
        const n = edit.target.kind === 'slot' ? numberOf(edit.target.slotId) : null;
        return n ? i18n._(msg`The cut before slot ${n} kept`) : i18n._(msg`Left as it is`);
      }
      return i18n._(msg`Left as it is`);
    }
    case 'soundCredit':
      return edit.credit ? i18n._(msg`Sound credit added`) : i18n._(msg`Sound credit cleared`);
    case 'setMotion': {
      const n = numberOf(edit.slotId);
      if (!edit.motion) return i18n._(msg`Slot ${n}’s camera move left unknown`);
      const move = i18n._(MOTION_LABELS[edit.motion]);
      return i18n._(msg`Slot ${n}’s camera move is now ${move}`);
    }
    case 'setGraphic':
      return edit.graphic ? i18n._(msg`Restored as a graphic`) : i18n._(msg`Left out: not a graphic`);
    case 'editBrief':
      return i18n._(msg`Graphic brief changed`);
    case 'proposal': {
      const what = proposalWords(i18n, template, edit.proposal).what;
      return i18n._(msg`Accepted: ${what}`);
    }
  }
}
