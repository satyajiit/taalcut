// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `timeline.assemble`'s timelines (cast-tools.ts): one assembled timeline per variant of the cast, named and id'd as
 * the input asks. KEEP1: each gets the template's reel for the slots that keep its footage.
 */
import {
  err,
  newId,
  ok,
  type Result,
  type Template,
  type Timeline,
  type TimelineId,
  type TimelineSummary,
} from '@taalcut/core';
import { assemble } from '../assembly/assemble';
import type { ReelMedia } from '../assembly/reel-footage';
import type { CastResult } from '../casting/engine';
import type { AssembleToolInput } from './schemas';

export function assembleVariants(
  input: AssembleToolInput,
  found: { readonly template: Template; readonly cast: CastResult },
  now: number,
  keptAudio: boolean,
  aspects: ReadonlyMap<string, number>,
  existing: readonly TimelineSummary[] = [],
  reel?: ReelMedia,
): Result<Timeline[]> {
  const { template, cast: result } = found;
  const existingIds = new Set<string>(existing.map((item) => item.id));
  const existingNames = new Set<string>(existing.map((item) => item.name));
  const offset = existing.length;
  const timelines: Timeline[] = [];
  for (const [index, variant] of result.variants.entries()) {
    const requestedId = input.timelineIds?.[index];
    const timelineId = (
      requestedId && !existingIds.has(requestedId) ? requestedId : newId<'Timeline'>()
    ) as TimelineId;
    existingIds.add(timelineId);
    const variantIndex = Math.min(9, input.names?.[index] ? index : offset + index);
    let variantNumber = offset + index + 1;
    while (!input.names?.[index] && existingNames.has(`Variant ${variantNumber}`)) variantNumber += 1;
    const name = input.names?.[index] ?? `Variant ${variantNumber}`;
    existingNames.add(name);
    const cast = {
      castId: result.castId,
      mode: input.mode,
      variantIndex,
      variantCount: result.variants.length,
      configVersion: result.configVersion,
    };
    const assembled = assemble(
      {
        projectId: input.projectId,
        template,
        variant,
        cast,
        ...(input.texts ? { texts: input.texts } : {}),
        // BRK1-MAKE: the canvas the cast was made for (the clips' orientation when it isn't the template's).
        canvas: { width: result.canvas.width, height: result.canvas.height },
        aspects,
        keptAudio,
        ...(reel ? { reel } : {}),
        timelineId,
        name,
        now,
      },
      { item: () => newId<'TimelineItem'>() },
    );
    if (!assembled.ok) return err(assembled.error);
    timelines.push(assembled.value);
  }
  return ok(timelines);
}
