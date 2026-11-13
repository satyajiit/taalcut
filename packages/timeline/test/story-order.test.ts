// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-M12: story order: capture order, contiguous place blocks, the energy shape, the hook in the first block. */
import { newId, type ShotProfile, type Template } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createMemoryShotCatalog, profileKey } from '../src/casting/catalog';
import { CASTING_CONFIG } from '../src/casting/config';
import { createCastingEngine } from '../src/casting/engine';
import { slotSpecs } from '../src/casting/slots';
import { blockQuotas, collapseDuplicates, placeBlocks, storyTargets } from '../src/casting/story';
import { candidateKey } from '../src/model/cast';
import { fakeEmbedder, makeProfile, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const config = CASTING_CONFIG;
const day = 86_400_000;

/** Two days at the beach, a market, then the fort: shots in capture order with rising and falling energy. */
function trip(): ShotProfile[] {
  const places = ['beach', 'beach', 'beach', 'beach', 'market', 'market', 'market', 'fort', 'fort', 'fort', 'fort', 'fort'];
  return places.map((place, index) =>
    makeProfile({
      embedding: unitVector(900 + index),
      place,
      capturedAt: 1_700_000_000_000 + index * day,
      energy: [0.2, 0.9, 0.4, 0.5, 0.7, 0.85, 0.6, 0.8, 0.3, 0.5, 0.25, 0.1][index]!,
      faceCount: index === 2 ? 1 : 0,
      motionClass: index === 2 ? 'handheld' : 'static',
    }),
  );
}

function format(slots: number, pending = false): Template {
  return buildTemplate({
    origin: 'format',
    slots: Array.from({ length: slots }, (_, index) => ({ frames: 30, text: 'a moment', energy: 0.3 + index * 0.1, pending })),
  });
}

async function storyCast(template: Template, profiles: ShotProfile[], variants = 1) {
  const engine = createCastingEngine({ catalog: createMemoryShotCatalog(profiles), embedder: fakeEmbedder(new Map()) });
  const result = await engine.cast({ projectId: newId<'Project'>(), template, mode: 'story', variants, seed: 1 });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

describe('story order', () => {
  it('splits capture order into place blocks and merges the smallest while there are too many', () => {
    const shots = trip();
    expect(placeBlocks(shots, 10).map((block) => block.length)).toEqual([4, 3, 5]);
    expect(placeBlocks(shots, 2).map((block) => block.length)).toEqual([7, 5]);
    const unknown = [makeProfile({ embedding: unitVector(1), place: null }), makeProfile({ embedding: unitVector(2), place: null })];
    expect(placeBlocks(unknown, 5)).toHaveLength(2);
    expect(blockQuotas(placeBlocks(shots, 10), 8)).toEqual([3, 2, 3]);
    expect(blockQuotas(placeBlocks(shots, 10), 20)).toEqual([4, 3, 5]);
  });

  it('keeps blocks contiguous and in capture order, the hook from the first block', async () => {
    const shots = trip();
    const result = await storyCast(format(6), shots);
    const picks = result.variants[0]!.slots.map((slot) => shots.find((shot) => profileKey(shot) === candidateKey(slot.pick!))!);
    const places = picks.map((shot) => shot.placeClusterId);
    const order = [...new Set(places)];
    expect(order).toEqual(['beach', 'market', 'fort']);
    expect(places.join(',')).toMatch(/^(beach,)+(market,)+(fort,?)+$/);
    // The hook is the best hook in the first block: the handheld shot with a face.
    expect(picks[0]).toBe(shots[2]);
    // The outro is the calmest shot of the last block.
    expect(picks.at(-1)).toBe(shots[11]);
    // Inside a block (after the hook), shots stay in capture order.
    const middle = picks.slice(1, -1);
    for (let index = 1; index < middle.length; index++)
      if (middle[index]!.placeClusterId === middle[index - 1]!.placeClusterId)
        expect(middle[index]!.capturedAt!).toBeGreaterThan(middle[index - 1]!.capturedAt!);
  });

  it('follows the format slots energy, else the sine shape', () => {
    const shaped = format(5);
    expect(storyTargets(shaped, slotSpecs(shaped, config), config)).toEqual(slotSpecs(shaped, config).map((spec) => spec.energy));
    const pending = format(5, true);
    const targets = storyTargets(pending, slotSpecs(pending, config), config);
    expect(targets[0]).toBeCloseTo(0.25, 9);
    expect(targets[2]).toBeCloseTo(0.85, 9);
    expect(targets[4]).toBeCloseTo(0.25, 9);
  });

  it('collapses near duplicates to the best take', () => {
    const takes = [
      makeProfile({ embedding: unitVector(1), duplicateGroup: 'g', bestTake: false, quality: 0.9 }),
      makeProfile({ embedding: unitVector(1), duplicateGroup: 'g', bestTake: true, quality: 0.6 }),
      makeProfile({ embedding: unitVector(2) }),
    ];
    expect(collapseDuplicates(takes).map(profileKey).sort()).toEqual([profileKey(takes[1]!), profileKey(takes[2]!)].sort());
  });

  it('makes story variants that open differently, and alternates from the same block', async () => {
    const shots = trip();
    const result = await storyCast(format(4), shots, 3);
    const hooks = result.variants.map((variant) => variant.slots[0]!.pick!.shotId);
    expect(new Set(hooks).size).toBe(hooks.length);
    expect(result.variants.length).toBeGreaterThanOrEqual(2);
    const first = result.variants[0]!.slots[0]!;
    const block = shots.filter((shot) => shot.placeClusterId === 'beach').map(profileKey);
    for (const alternate of first.alternates) expect(block).toContain(candidateKey(alternate));
  });

  it('leaves slots empty when there are fewer shots than slots', async () => {
    const shots = trip().slice(0, 3);
    const result = await storyCast(format(5), shots);
    const filled = result.variants[0]!.slots.filter((slot) => slot.pick).length;
    expect(filled).toBe(3);
  });
});
