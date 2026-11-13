// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Learned casting weights in words (LRN1-PREF), in the reader's language: each score part's name, and how the
 * weights lean against casting's defaults (the rules' `lean`, core's castingWeightsLean). The item's own text is the
 * same lean in English, for the agent's prompt and memory search; Settings never shows it.
 */
import type { I18n, MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import type { CastingWeightKey, MemoryData } from '@taalcut/core';
import { listOf } from '#lib/format';
import type { CastingWeightsLean } from './casting-weights-rules';

/** What a `casting-weights` memory item carries (core's castingWeightsDataSchema). */
export type CastingWeightsData = Extract<MemoryData, { kind: 'casting-weights' }>;

/** Each part's name beside its slider. */
export const CASTING_PART_LABELS: Readonly<Record<CastingWeightKey, MessageDescriptor>> = {
  intent: msg({
    message: 'Matches the description',
    comment: 'Casting weight: how much it counts that a shot matches what the template slot describes',
  }),
  motion: msg({
    message: 'Camera motion',
    comment: "Casting weight: how much it counts that a shot's camera motion matches the slot's",
  }),
  quality: msg({
    message: 'Picture quality',
    comment: 'Casting weight: how much it counts that a shot is sharp and well exposed',
  }),
  subject: msg({
    message: 'People and subject',
    comment: 'Casting weight: how much it counts that a shot shows the people and subject the slot asks for',
  }),
  energy: msg({
    message: 'Energy with the music',
    comment: "Casting weight: how much it counts that a shot's energy matches the music at that point",
  }),
};

const TOWARD: Readonly<Record<CastingWeightKey, MessageDescriptor>> = {
  intent: msg`shots that match what the slot describes`,
  motion: msg`shots whose camera motion matches the template`,
  quality: msg`sharp, well-exposed shots`,
  subject: msg`shots with the people and subject the slot asks for`,
  energy: msg`shots whose energy matches the music`,
};

const LESS: Readonly<Record<CastingWeightKey, MessageDescriptor>> = {
  intent: msg`matching the description`,
  motion: msg`matching camera motion`,
  quality: msg`picture quality`,
  subject: msg`matching people and subject`,
  energy: msg`matching energy`,
};

/** "When picking shots, leans toward …, and less on …." Parts within a tenth of their default aren't named. */
export function castingWeightsSentence(i18n: I18n, lean: CastingWeightsLean): string {
  const toward = listOf(
    i18n,
    lean.toward.map((key) => i18n._(TOWARD[key])),
  );
  const less = listOf(
    i18n,
    lean.less.map((key) => i18n._(LESS[key])),
  );
  if (lean.toward.length > 0 && lean.less.length > 0)
    return i18n._(msg`When picking shots, leans toward ${toward}, and less on ${less}.`);
  if (lean.toward.length > 0) return i18n._(msg`When picking shots, leans toward ${toward}.`);
  if (lean.less.length > 0) return i18n._(msg`When picking shots, puts less weight on ${less}.`);
  return i18n._(
    msg`Picks shots with the default balance of description, camera motion, quality, subject and energy.`,
  );
}
