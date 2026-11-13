// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { RationalTime } from '@taalcut/core';
import type { RenderPlan } from '../plan/types';
import type { QaGraphic } from '../types';

/** Chapter windows intersect the trimmed source range; the program itself never restarts at a chapter. */
export function authoredQaGraphics(plan: RenderPlan): QaGraphic[] {
  return (plan.programs ?? []).flatMap((placed) => {
    const sourceStart = RationalTime.toFrames(placed.sourceStart, plan.rate);
    const chapters =
      placed.program.chapters.length > 0
        ? placed.program.chapters
        : [
            {
              id: 'program',
              name: 'Program',
              start: RationalTime.zero(plan.rate),
              duration: placed.program.duration,
            },
          ];
    return chapters.flatMap((chapter, index) => {
      const start = Math.max(
        placed.span.start,
        placed.span.start + RationalTime.toFrames(chapter.start, plan.rate) - sourceStart,
      );
      const end = Math.min(
        placed.span.end,
        placed.span.start +
          RationalTime.toFrames(RationalTime.add(chapter.start, chapter.duration), plan.rate) -
          sourceStart,
      );
      return end <= start
        ? []
        : [
            {
              id: `${placed.itemId}:${index}`,
              programItemId: placed.itemId,
              span: { start, end },
              compositionId: placed.program.id,
              hash: placed.program.hash,
              params: { sourceOffset: sourceStart + start - placed.span.start },
            },
          ];
    });
  });
}
