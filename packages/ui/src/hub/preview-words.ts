// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The StructurePreview's words (U6): its summary, the "Describe slots" lines and the text boxes' labels. */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg, plural } from '@lingui/core/macro';
import type { HubStructure } from '@taalcut/core';
import type { Formatters } from '../lib/format';
import { MOTION_LABELS, ROLE_LABELS, SHOT_TYPE_LABELS } from '../templates/slot-words';
import type { PreviewModel, PreviewSlot } from './structure-of';

/** What a text box is for, on its placeholder bar. */
export const OVERLAY_WORDS: Readonly<Record<HubStructure['text'][number]['role'], MessageDescriptor>> = {
  title: msg`Title`,
  label: msg`Label`,
  list: msg`List`,
  caption: msg`Caption`,
  cta: msg`Call to action`,
  other: msg`Text`,
};

/** "8 slots, 30s, cuts on the beat": the accessible summary, also the caption under a frame. */
export function structureSummary(i18n: I18n, model: PreviewModel, format: Formatters): string {
  const count = model.slots.length;
  const slots = i18n._(msg`${plural(count, { one: '# slot', other: '# slots' })}`);
  const length = format.duration(model.duration * 1000);
  return model.onBeat ? i18n._(msg`${slots}, ${length}, cuts on the beat`) : i18n._(msg`${slots}, ${length}`);
}

/** One slot in words, for "Describe slots": "Slot 2, Middle, 1.5s to 2.5s: Wide, Pan." Its intent follows. */
export function slotLine(i18n: I18n, slot: PreviewSlot, format: Formatters): string {
  const number = i18n.number(slot.index + 1);
  const from = format.duration(slot.start * 1000);
  const to = format.duration((slot.start + slot.duration) * 1000);
  const parts = [
    slot.role ? i18n._(ROLE_LABELS[slot.role]) : null,
    slot.shotType ? i18n._(SHOT_TYPE_LABELS[slot.shotType]) : null,
    slot.motion ? i18n._(MOTION_LABELS[slot.motion]) : null,
  ].filter((part): part is string => part !== null);
  const what = parts.join(', ');
  return what
    ? i18n._(msg`Slot ${number}, ${from} to ${to}: ${what}`)
    : i18n._(msg`Slot ${number}, ${from} to ${to}`);
}
