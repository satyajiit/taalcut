// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The `casting` scenario's extra item (LRN1-PREF): the casting weights Taalcut learned from 18 of the creator's
 * choices, as the agent's learning job writes it (a `learned` item in the user scope, the weights inside their
 * bounds at the defaults' total, the sentence core's castingWeightsText makes): more on camera motion, less on
 * picture quality and on people and subject. Settings → Memory shows it with its casting editor.
 */
import { castingWeightsText, fitCastingWeights, type CastingWeights, type MemoryItem } from '@taalcut/core';
import { fakeUlid } from '../library/seed';
import { MEMORY_KIND } from './memory-seed';

/** casting.v1's own weights (packages/timeline/config/casting.v1.json). */
const DEFAULTS: CastingWeights = { intent: 0.4, motion: 0.15, quality: 0.15, subject: 0.15, energy: 0.15 };
const LEARNED = fitCastingWeights(
  { intent: 0.38, motion: 0.24, quality: 0.11, subject: 0.12, energy: 0.15 },
  DEFAULTS,
);
const AGO = 26 * 60_000;

/** After memory-seed's six items in the id sequence. */
export const CASTING_WEIGHTS_ID = fakeUlid<'MemoryItem'>(MEMORY_KIND, 20);

export function castingWeightsSeed(now: number): MemoryItem[] {
  return [
    {
      id: CASTING_WEIGHTS_ID,
      scope: { kind: 'user' },
      text: castingWeightsText(LEARNED, DEFAULTS),
      source: 'learned',
      data: {
        kind: 'casting-weights',
        configVersion: 'casting.v1',
        defaults: DEFAULTS,
        weights: LEARNED,
        pairs: 18,
      },
      conversationId: null,
      revision: 1,
      createdAt: now - AGO,
      updatedAt: now - AGO,
    },
  ];
}
