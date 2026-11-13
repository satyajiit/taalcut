// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-M2 done-when: 10 variants for one template differ in ≥ 30% of picks and in the hook. */
import { newId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { candidateKey } from '../src/model/cast';
import type { CastVariant } from '../src/casting/result';
import { world } from './fixtures/casting';

const projectId = newId<'Project'>();

function keys(variant: CastVariant): (string | null)[] {
  return variant.slots.map((slot) => (slot.pick ? candidateKey(slot.pick) : null));
}

describe('variants', () => {
  it('makes 10 variants that differ pairwise in at least 30% of picks and in the hook', async () => {
    const { template, engine } = world({ slots: 10, perSlot: 8, distractors: 60, seed: 11 });
    const result = await engine.cast({ projectId, template, mode: 'template', variants: 10, seed: 1 });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.variants).toHaveLength(10);
    expect(result.value.variantsShort).toBeUndefined();
    const all = result.value.variants.map(keys);
    for (let a = 0; a < all.length; a++)
      for (let b = a + 1; b < all.length; b++) {
        const x = all[a]!;
        const y = all[b]!;
        const differences = x.filter((key, slot) => key !== y[slot]).length;
        expect(differences, `variants ${a} and ${b}`).toBeGreaterThanOrEqual(3);
        expect(x[0], `hooks of ${a} and ${b}`).not.toBe(y[0]);
      }
    for (const variant of all) expect(new Set(variant).size).toBe(variant.length);
  });

  it('reports the shortfall when a small library can not make them all', async () => {
    const { template, engine } = world({ slots: 4, perSlot: 1, distractors: 2, seed: 3 });
    const result = await engine.cast({ projectId, template, mode: 'template', variants: 10, seed: 1 });
    if (!result.ok) throw new Error(result.error.code);
    expect(result.value.variants.length).toBeLessThan(10);
    expect(result.value.variantsShort).toEqual({ asked: 10, made: result.value.variants.length });
  });

  it('refuses a variant count outside 1–10', async () => {
    const { template, engine } = world({ slots: 2, perSlot: 2, distractors: 0, seed: 5 });
    const zero = await engine.cast({ projectId, template, mode: 'template', variants: 0, seed: 1 });
    expect(!zero.ok && zero.error.code).toBe('core.validation');
  });
});
