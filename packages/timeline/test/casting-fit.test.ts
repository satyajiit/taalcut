// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FIX-CAST: casting picks what a person would. Night meets night and "from behind" meets a back to the camera,
 * the assignment moves a clip to the slot it fits best, and a pick that fits badly is never shown as sure.
 * Made-up clips only.
 */
import { newId, type ShotProfile } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { attributeMatch, readAttributes } from '../src/casting/attributes';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { CASTING_CONFIG as config } from '../src/casting/config';
import { createCastingEngine } from '../src/casting/engine';
import { fakeEmbedder, makeProfile, near, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

const described = (profile: ShotProfile, description: string): ShotProfile => ({ ...profile, description });

describe('attributes', () => {
  it('reads night or day, facing, indoors or out, and leaves out what the words do not say', () => {
    expect(readAttributes('Track behind the traveler climbing a staircase at night')).toMatchObject({
      light: 'night',
      facing: 'away',
    });
    expect(readAttributes('A person stands with their back to the camera on a sunlit beach')).toMatchObject({
      light: 'day',
      facing: 'away',
      setting: 'outdoor',
    });
    expect(readAttributes('Talking to camera in a kitchen')).toMatchObject({ facing: 'toward', setting: 'indoor' });
    expect(readAttributes('A close shot of hands')).toMatchObject({ light: null, facing: null, setting: null });
  });

  it('counts the same fully, the opposite as a conflict, and nothing either side leaves out', () => {
    const night = readAttributes('walking away at night', 'medium');
    const match = attributeMatch(night, readAttributes('walks away from the camera at night', 'wide'), config.intentMatch);
    expect(match.conflict).toBe(false);
    expect(match.score).toBeGreaterThan(0.8);
    const day = attributeMatch(night, readAttributes('walks away in bright daylight'), config.intentMatch);
    expect(day.conflict).toBe(true);
    expect(attributeMatch(night, readAttributes('a bowl of soup'), config.intentMatch).weight).toBe(0);
  });
});

describe('casting by fit', () => {
  const line = unitVector(1);
  const template = buildTemplate({
    slots: [
      { frames: 30, text: 'Open on a traveler checking a phone indoors while waiting for transit', motion: 'pan' },
      { frames: 30, text: 'Track behind the traveler climbing a narrow staircase at night', motion: 'tracking' },
      { frames: 30, text: 'Frame the traveler from behind on a quiet street at night', motion: 'static' },
    ],
  });
  const table = new Map(template.slots.map((slot) => [slot.intent.text, line]));
  // The night clip pans and is energetic, which the hook likes; the phone clip is still.
  const nightBack = described(
    makeProfile({ embedding: near(line, 2, 0.05), motionClass: 'pan', faceCount: 1, energy: 0.6 }),
    'A person stands with their back to the camera, looking at a lit sign on a street at night.',
  );
  const phone = described(
    makeProfile({ embedding: near(line, 3, 0.05), motionClass: 'static', faceCount: 1, energy: 0.3 }),
    'A person looks at their phone in a bright airport hall in daylight.',
  );
  const selfie = described(
    makeProfile({ embedding: unitVector(9), motionClass: 'static', faceCount: 1 }),
    'A person talks to the camera on a sunny beach.',
  );
  const cast = async (profiles: readonly ShotProfile[]) => {
    const engine = createCastingEngine({ catalog: createMemoryShotCatalog(profiles), embedder: fakeEmbedder(table) });
    const result = await engine.cast({ projectId: newId<'Project'>(), template, mode: 'template', variants: 1, seed: 1 });
    if (!result.ok) throw new Error(result.error.code);
    return result.value.variants[0]!.slots;
  };

  it('puts the night clip seen from behind in the night slot, not in the hook', async () => {
    const slots = await cast([nightBack, phone]);
    expect(slots[0]?.pick?.shotId).toBe(phone.shotId);
    const night = slots.findIndex((slot) => slot.pick?.shotId === nightBack.shotId);
    expect([1, 2]).toContain(night);
  });

  it('flags a pick that fits badly as unsure, even with no runner-up', async () => {
    const slots = await cast([nightBack, phone, selfie]);
    const poor = slots.find((slot) => slot.pick?.shotId === selfie.shotId);
    expect(poor?.alternates).toEqual([]);
    expect(poor?.confidence).toBeLessThan(config.confidence.rerankBelow);
    expect(poor?.needsRerank).toBe(true);
    const sure = slots.find((slot) => slot.pick?.shotId === nightBack.shotId);
    expect(sure?.confidence).toBeGreaterThan(config.confidence.rerankBelow);
  });
});
