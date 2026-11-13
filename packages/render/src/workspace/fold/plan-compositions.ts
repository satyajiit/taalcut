// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The timeline's composition graphics on its frame grid (HFW1 "hf: compile"): each enabled graphic item with a
 * `composition` ref, timed as any graphic is (its anchor, else its start and duration), with the copy of the
 * composition the timeline keeps (`graphicCompositions`, by id and hash) and its variables' values. A proposal is
 * left out here; the preview shows it (`showProposals`). One whose copy is missing, or whose gate did not pass, is
 * left out with a warning: there is no built-in look to draw instead.
 */
import { compositionFor, type FrameRate, type Timeline } from '@taalcut/core';
import { timingContextOf } from '../../compositions/timing-context';
import { resolveTiming } from '../../compositions/timing';
import { bySpanStart, enabledTextItems } from '../../plan/text-items';
import type { PlannedComposition } from '../../plan/types';
import { toFrame } from '../../time/frames';

export type { PlannedComposition };

export interface PlannedCompositions {
  readonly planned: readonly PlannedComposition[];
  readonly warnings: readonly string[];
}

export function planCompositions(timeline: Timeline, rate: FrameRate): PlannedCompositions {
  const context = timingContextOf(timeline, rate);
  const warnings: string[] = [];
  const planned: PlannedComposition[] = [];
  for (const item of enabledTextItems(timeline, 'graphic')) {
    if (item.proposal) continue;
    const composition = compositionFor(item.composition, timeline.graphicCompositions);
    if (!composition) {
      warnings.push(`graphic ${item.id}: its composition is not on the timeline, so it is left out`);
      continue;
    }
    if (!composition.gate.passed) {
      warnings.push(`graphic ${item.id}: its composition did not pass the gate, so it is left out`);
      continue;
    }
    const timing = resolveTiming(
      {
        anchor: item.anchor,
        frames: toFrame(item.duration, rate),
        fallbackStart: toFrame(item.start, rate),
      },
      { ...context, language: item.language ?? context.language },
    );
    planned.push({
      itemId: item.id,
      span: { start: timing.start, end: timing.end },
      composition,
      values: item.composition.params,
    });
  }
  return { planned: planned.sort(bySpanStart), warnings };
}
