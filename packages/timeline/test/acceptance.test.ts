// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Casting acceptance on a SYNTHETIC stand-in for P2-Q2: 3 libraries × 10
 * templates where each slot has known acceptable shots among distractors.
 * The metric mirrors gate criterion 2 (share of auto-picked shots that are
 * acceptable). It is not the P2-Q2 number: that needs the human labels (H3).
 */
import { newId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { candidateKey } from '../src/model/cast';
import { world } from './fixtures/casting';

describe('casting acceptance (synthetic)', () => {
  it('picks acceptable shots for at least 60% of slots', async ({ annotate }) => {
    let picked = 0;
    let accepted = 0;
    for (let library = 0; library < 3; library++)
      for (let template = 0; template < 10; template++) {
        const seed = 100 + library * 10 + template;
        const { template: doc, engine, acceptable } = world({
          slots: 8,
          perSlot: 4,
          confusers: 4,
          distractors: 80,
          seed,
          noise: 0.9,
        });
        const result = await engine.cast({ projectId: newId<'Project'>(), template: doc, mode: 'template', variants: 1, seed: 1 });
        if (!result.ok) throw new Error(result.error.code);
        result.value.variants[0]!.slots.forEach((slot, index) => {
          if (!slot.pick) return;
          picked++;
          if (acceptable[index]!.has(candidateKey(slot.pick))) accepted++;
        });
      }
    const share = accepted / picked;
    await annotate(`[synthetic P2-Q2] casting acceptance ${(share * 100).toFixed(1)}% of ${picked} slots`);
    expect(share).toBeGreaterThanOrEqual(0.6);
  });
});
