// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The commands the review dispatches (BRK1 §2, core's TEMPLATE_COMMANDS), named here as use-slot-edits.ts names the
 * slot edits: the kit imports only types from core, and `satisfies` keeps each name equal to core's.
 */
import type { TEMPLATE_COMMANDS } from '@taalcut/core';

export const REVIEW_COMMANDS = {
  moveCut: 'template.slot.moveCut',
  splitSlot: 'template.slot.split',
  setRole: 'template.slot.setRole',
  removeText: 'template.text.remove',
  setTempo: 'template.setTempo',
  dismissDoubt: 'template.doubt.dismiss',
  editIntent: 'template.slot.editIntent',
  mergeSlots: 'template.slot.merge',
  dropSlot: 'template.slot.drop',
  renameSlot: 'template.slot.rename',
  setSoundCredit: 'template.setSoundCredit',
  setMotion: 'template.setMotion',
  setGraphic: 'template.graphic.set',
  editGraphic: 'template.graphic.edit',
} as const satisfies Pick<
  typeof TEMPLATE_COMMANDS,
  | 'moveCut'
  | 'splitSlot'
  | 'setRole'
  | 'removeText'
  | 'setTempo'
  | 'dismissDoubt'
  | 'editIntent'
  | 'mergeSlots'
  | 'dropSlot'
  | 'renameSlot'
  | 'setSoundCredit'
  | 'setMotion'
  | 'setGraphic'
  | 'editGraphic'
>;
