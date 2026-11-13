// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { type CastingSystem, type CastingVariant, type CastingWeights } from './types';
import { type CastingCase } from '../casting/schema';

export const DEFAULT_CASTING_WEIGHTS: CastingWeights = {
  version: 'synthetic',
  intent: 0.4,
  motion: 0.15,
  quality: 0.15,
  subject: 0.15,
  energy: 0.15,
};

const MISS = 'miss.mp4';

/**
 * Intent at or above 0.3 returns the first acceptable shot per slot, plus a
 * second variant whose hook and another slot miss. Below 0.3 every pick misses.
 */
export function syntheticCastingSystem(cases: readonly CastingCase[]): CastingSystem {
  const byId = new Map(cases.map((item) => [item.caseId, item]));
  return {
    async cast(input): Promise<CastingVariant[]> {
      const item = byId.get(input.caseId);
      if (item === undefined) throw new Error(`No labels for ${input.caseId}`);
      if (input.weights.intent < 0.3) {
        return [
          {
            picks: item.slots.map((slot) => ({
              slotIndex: slot.slotIndex,
              asset: MISS,
              range: { startFrame: 0, endFrame: 1 },
            })),
            alternates: [],
          },
        ];
      }
      const picks = item.slots.map((slot) => {
        const shot = slot.acceptable[0];
        if (shot === undefined)
          throw new Error(`Slot ${slot.slotIndex} of ${item.caseId} has no acceptable shot`);
        return {
          slotIndex: slot.slotIndex,
          asset: shot.asset,
          ...(shot.range === undefined ? {} : { range: shot.range }),
        };
      });
      const diverse = picks.map((pick, index) =>
        index < 2 ? { slotIndex: pick.slotIndex, asset: MISS, range: { startFrame: 0, endFrame: 1 } } : pick,
      );
      const alternates = item.slots.map((slot) => ({
        slotIndex: slot.slotIndex,
        shots: slot.acceptable.slice(1),
      }));
      return [
        { picks, alternates },
        { picks: diverse, alternates },
      ];
    },
  };
}
