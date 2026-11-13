// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-PREF: Settings → Memory's casting weights. A person's weights are saved fitted, with core's sentence and no
// pairs behind them, so the library accepts the item (memoryItemProblems); the lean reads in each language the app
// ships, never in the item's English.
import {
  castingWeightsText,
  memoryItemProblems,
  newId,
  type CastingWeights,
  type MemoryItemView,
} from '@taalcut/core';
import { castingWeightsSentence, type CastingWeightsData } from '@taalcut/ui';
import { afterAll, describe, expect, it } from 'vitest';
import {
  castingWeightsOf,
  castingWeightsPatch,
} from '../../src/features/settings/memory/casting-weights-patch';
import { castingWeightsRules } from '../../src/features/settings/memory/casting-weights-rules';
import { activateLocale, i18n } from '../../src/i18n/i18n';

const DEFAULTS: CastingWeights = { intent: 0.4, motion: 0.15, quality: 0.15, subject: 0.15, energy: 0.15 };
const LEARNED: CastingWeights = { intent: 0.38, motion: 0.24, quality: 0.11, subject: 0.12, energy: 0.15 };
const DATA: CastingWeightsData = {
  kind: 'casting-weights',
  configVersion: 'casting.v1',
  defaults: DEFAULTS,
  weights: LEARNED,
  pairs: 18,
};
const ENGLISH =
  'When picking shots, leans toward shots whose camera motion matches the template, and less on picture quality ' +
  'and matching people and subject.';

describe('casting weights in Settings → Memory (LRN1-PREF)', () => {
  afterAll(() => activateLocale('en'));

  it('finds the casting weights only on their own item', () => {
    expect(castingWeightsOf({ data: DATA })).toBe(DATA);
    expect(castingWeightsOf({ data: null })).toBeNull();
    const worked: MemoryItemView['data'] = {
      kind: 'what-worked',
      templateVersion: 1,
      styleId: null,
      presetId: 'reels',
      renderId: newId<'Render'>(),
      exports: 1,
    };
    expect(castingWeightsOf({ data: worked })).toBeNull();
  });

  it("saves a person's weights fitted, with core's sentence and no pairs, as the library accepts them", () => {
    expect(castingWeightsPatch(DATA, LEARNED)).toBeNull();
    const patch = castingWeightsPatch(DATA, { ...LEARNED, quality: 0.3, intent: 0.2 });
    if (!patch) throw new Error('no patch');
    expect(patch.data.pairs).toBe(0);
    expect(patch.data.defaults).toEqual(DEFAULTS);
    expect(patch.text).toBe(castingWeightsText(patch.data.weights, DEFAULTS));
    const total = Object.values(patch.data.weights).reduce((sum, value) => sum + value, 0);
    expect(Math.round(total * 1000)).toBe(1000);
    expect(
      memoryItemProblems({
        scope: { kind: 'user' },
        source: 'learned',
        data: patch.data,
        conversationId: null,
      }),
    ).toEqual([]);
  });

  it('brings weights from outside their bounds inside before they are saved', () => {
    const patch = castingWeightsPatch(DATA, { intent: 2, motion: 0, quality: 0, subject: 0, energy: 0 });
    if (!patch) throw new Error('no patch');
    expect(patch.data.weights.intent).toBe(0.7);
    expect(
      memoryItemProblems({
        scope: { kind: 'user' },
        source: 'learned',
        data: patch.data,
        conversationId: null,
      }),
    ).toEqual([]);
  });

  it.each(['es', 'hi', 'pt-BR'] as const)('says the lean in %s, without the English', async (locale) => {
    await activateLocale('en');
    const lean = castingWeightsRules(DEFAULTS).lean(LEARNED);
    expect(castingWeightsSentence(i18n, lean)).toBe(ENGLISH);
    await activateLocale(locale);
    const sentence = castingWeightsSentence(i18n, lean);
    expect(sentence).not.toBe(ENGLISH);
    expect(sentence).not.toMatch(/shots|picture quality|camera motion/);
  });
});
