// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LRN1-PREF: the kit's casting weights editor on core's rules, as Settings → Memory gives them
// (casting-weights-rules.ts). Each part reaches only as far as the other four allow; every keyboard move and drag
// keeps the five inside their bounds at the defaults' total, so every save is an item the library accepts
// (memoryItemProblems).
import { I18nProvider } from '@lingui/react';
import {
  castingWeightBounds,
  CASTING_WEIGHT_KEYS,
  fitCastingWeights,
  memoryItemProblems,
  newId,
  sameCastingWeights,
  type CastingWeights,
} from '@taalcut/core';
import { CastingWeightsItem, type CastingWeightsData } from '@taalcut/ui';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  castingWeightReach,
  castingWeightsRules,
} from '../../src/features/settings/memory/casting-weights-rules';
import { activateLocale, i18n } from '../../src/i18n/i18n';

const DEFAULTS: CastingWeights = { intent: 0.4, motion: 0.15, quality: 0.15, subject: 0.15, energy: 0.15 };
const LEARNED: CastingWeights = { intent: 0.38, motion: 0.24, quality: 0.11, subject: 0.12, energy: 0.15 };
const data = (weights: CastingWeights, pairs = 18): CastingWeightsData => ({
  kind: 'casting-weights',
  configVersion: 'casting.v1',
  defaults: DEFAULTS,
  weights,
  pairs,
});

function edit() {
  const onSave = vi.fn();
  render(
    <I18nProvider i18n={i18n}>
      <CastingWeightsItem
        item={{ id: newId<'MemoryItem'>(), updatedAt: 1_000 }}
        data={data(LEARNED)}
        rules={castingWeightsRules(DEFAULTS)}
        editing
        busy={null}
        now={2_000}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
        onSave={onSave}
        onReset={vi.fn()}
      />
    </I18nProvider>,
  );
  return onSave;
}

const slider = (name: string) => screen.getByRole<HTMLInputElement>('slider', { name });
const values = (): CastingWeights => {
  const read = (key: string) =>
    Number(document.querySelector<HTMLInputElement>(`input[data-part=${key}]`)?.value ?? Number.NaN);
  return {
    intent: read('intent'),
    motion: read('motion'),
    quality: read('quality'),
    subject: read('subject'),
    energy: read('energy'),
  };
};
const accepted = (weights: CastingWeights) =>
  memoryItemProblems({
    scope: { kind: 'user' },
    source: 'learned',
    data: data(weights, 0),
    conversationId: null,
  });

describe('the casting weights editor on core’s rules (LRN1-PREF)', () => {
  beforeAll(() => activateLocale('en'));

  it("each part's reach keeps the other four inside their bounds at the total", () => {
    const reach = castingWeightReach(DEFAULTS);
    expect(reach.intent).toEqual({ min: 0.2, max: 0.7 });
    for (const key of ['motion', 'quality', 'subject', 'energy'] as const)
      expect(reach[key]).toEqual(castingWeightBounds(DEFAULTS)[key]);
  });

  it('moving one part shares the difference among the others, and Save gets weights core accepts', () => {
    const onSave = edit();
    fireEvent.keyDown(slider('Picture quality'), { key: 'ArrowRight' });
    expect(values().quality).toBe(0.12);
    expect(sameCastingWeights(values(), LEARNED)).toBe(false);
    expect(accepted(values())).toEqual([]);

    fireEvent.keyDown(slider('Matches the description'), { key: 'End' });
    expect(values().intent).toBe(0.7);
    expect(accepted(values())).toEqual([]);

    fireEvent.change(slider('Camera motion'), { target: { value: '0.3' } });
    expect(values().motion).toBe(0.3);
    expect(accepted(values())).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    const saved = onSave.mock.calls[0]?.[0];
    expect(saved).toEqual(values());
    expect(accepted(saved)).toEqual([]);
  });

  it('keeps every keyboard move inside the bounds at the total', () => {
    edit();
    const keys = ['ArrowRight', 'PageUp', 'ArrowLeft', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'];
    let seed = 7;
    const next = (n: number) => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      return seed % n;
    };
    for (let move = 0; move < 120; move++) {
      const part = CASTING_WEIGHT_KEYS[next(CASTING_WEIGHT_KEYS.length)] ?? 'intent';
      const input = document.querySelector<HTMLInputElement>(`input[data-part=${part}]`);
      if (!input) throw new Error(part);
      fireEvent.keyDown(input, { key: keys[next(keys.length)] });
      const now = values();
      expect(sameCastingWeights(fitCastingWeights(now, DEFAULTS), now)).toBe(true);
    }
    expect(accepted(values())).toEqual([]);
  });
});
