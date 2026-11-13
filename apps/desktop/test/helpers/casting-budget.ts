// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A complete production-shaped cast at the supported three-rerank text bounds. */
import { newId } from '@taalcut/core';

export function castingBudgetFixture() {
  const shots = Array.from({ length: 16 }, () => newId<'Shot'>());
  const slots = Array.from({ length: 13 }, (_, index) => ({
    slotId: newId<'TemplateSlot'>(),
    shotId: shots[index]!,
    assetId: newId<'Asset'>(),
    confidence: 0.4,
    needsRerank: true,
    note: null,
    alternates: shots.slice(13),
  }));
  const rerank = slots.slice(0, 3).map((slot) => ({
    slotId: slot.slotId,
    intent: {
      text: 'A wide view of the creator walking through the city, matching the reference motion and pacing. '
        .repeat(3)
        .slice(0, 200),
      shotType: null,
      motion: null,
    },
    candidates: [slot.shotId, ...slot.alternates].map((shotId) => ({
      shotId,
      description:
        'The creator walks through the scene as the camera follows, with clear surroundings and room for the overlay. '
          .repeat(3)
          .slice(0, 200),
    })),
  }));
  const cast = {
    castId: newId<'Cast'>(),
    configVersion: 'casting.v5',
    variants: [{ sequenceConfidence: 0.4, slots }],
    rerank,
    artifact: {
      id: newId<'Artifact'>(),
      mediaType: 'application/json',
      bytes: 20_000,
      summary: 'The original cast, before rerank descriptions.',
    },
  };
  return { cast, rerank };
}
