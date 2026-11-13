// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-M12, timeline half: brief → format plan → story-order cast → assembly →
 * a valid timeline. The format plan here is a fixture standing in for the
 * templates lane's planFormat; the three real sample libraries are human input.
 */
import { newId, timelineSchema } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/assembly/assemble';
import { createMemoryShotCatalog } from '../src/casting/catalog';
import { createCastingEngine } from '../src/casting/engine';
import { cutsOffAnchor } from '../src/model/checks';
import { fakeEmbedder, makeProfile, near, unitVector } from './fixtures/library';
import { buildTemplate } from './fixtures/template';

describe('the brief path', () => {
  it('turns "a 30 s vlog of my Goa trip" into a valid story-ordered timeline', async () => {
    const goa = unitVector(77);
    const day = 86_400_000;
    const tripStart = 1_700_000_000_000;
    const trip = Array.from({ length: 14 }, (_, index) =>
      makeProfile({
        embedding: near(goa, index, 0.3),
        place: ['beach', 'beach', 'beach', 'market', 'market', 'fort'][index % 6] ?? null,
        capturedAt: tripStart + index * day,
        energy: (index % 5) / 5,
      }),
    );
    const office = Array.from({ length: 10 }, (_, index) =>
      makeProfile({ embedding: unitVector(300 + index), capturedAt: tripStart - 60 * day + index * day }),
    );
    const format = buildTemplate({
      origin: 'format',
      slots: Array.from({ length: 10 }, (_, index) => ({ frames: index === 0 ? 45 : 90, text: 'a moment', energy: 0.4 })),
    });
    const engine = createCastingEngine({
      catalog: createMemoryShotCatalog([...trip, ...office]),
      embedder: fakeEmbedder(new Map([['Goa trip', goa]])),
    });
    const projectId = newId<'Project'>();
    const cast = await engine.cast({
      projectId,
      template: format,
      mode: 'story',
      variants: 1,
      seed: 1,
      pool: { query: 'Goa trip', capturedFrom: tripStart, capturedTo: tripStart + 30 * day },
    });
    if (!cast.ok) throw new Error(cast.error.code);
    const variant = cast.value.variants[0]!;
    const tripIds = new Set(trip.map((shot) => shot.shotId));
    for (const slot of variant.slots) expect(tripIds.has(slot.pick!.shotId)).toBe(true);
    const timeline = assemble(
      {
        projectId,
        template: format,
        variant,
        cast: { castId: cast.value.castId, mode: 'story', variantIndex: 0, variantCount: 1, configVersion: cast.value.configVersion },
        timelineId: newId<'Timeline'>(),
        name: 'Goa',
        now: 0,
      },
      { item: () => newId<'TimelineItem'>() },
    );
    if (!timeline.ok) throw new Error(`${timeline.error.code} ${timeline.error.detail ?? ''}`);
    expect(timelineSchema.safeParse(timeline.value).success).toBe(true);
    expect(timeline.value.cast?.mode).toBe('story');
    expect(cutsOffAnchor(timeline.value)).toEqual([]);
  });
});
