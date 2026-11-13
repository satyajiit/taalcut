// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A base cut for P3-V3's variant tests: the synthetic casting world's first variant, assembled, with the plan
 * call around it (ids made here, as the tool makes them from its key).
 */
import {
  CAPTION_PRESETS,
  newId,
  type CaptionTrack,
  type CastId,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { assemble } from '../../src/assembly/assemble';
import { memoryTemplateReader } from '../../src/service/templates';
import type { VariantContext, VariantPlanRequest } from '../../src/variants/axis';
import { planVariants } from '../../src/variants/plan-variants';
import { world, type WorldDef } from './casting';

export const classicCaptions: CaptionTrack = {
  enabled: true,
  language: 'en',
  style: CAPTION_PRESETS.classic,
  styleSource: 'preset',
  cues: [],
};

export function variantWorld(def: WorldDef) {
  const cast = world(def);
  const templates = memoryTemplateReader([cast.template]);
  const projectId = newId<'Project'>();
  const timelineIds: TimelineId[] = Array.from({ length: 5 }, () => newId<'Timeline'>());
  const castId: CastId = newId<'Cast'>();

  async function base(): Promise<Timeline> {
    const result = await cast.engine.cast({
      projectId,
      template: cast.template,
      mode: 'template',
      variants: 1,
      seed: 1,
    });
    if (!result.ok) throw new Error(result.error.code);
    const [variant] = result.value.variants;
    if (!variant) throw new Error('no variant');
    const assembled = assemble(
      {
        projectId,
        template: cast.template,
        variant,
        cast: {
          castId: result.value.castId,
          mode: 'template',
          variantIndex: 0,
          variantCount: 1,
          configVersion: result.value.configVersion,
        },
        timelineId: newId<'Timeline'>(),
        name: 'Beach day',
        now: 100,
      },
      { item: () => newId<'TimelineItem'>() },
    );
    if (!assembled.ok) throw new Error(assembled.error.code);
    return assembled.value;
  }

  function plan(
    timeline: Timeline,
    request: VariantPlanRequest,
    extra: Partial<Omit<VariantContext, 'ids' | 'engine' | 'templates'>> = {},
  ) {
    return planVariants(
      { ...request, base: timeline, timelineIds, castId, seed: 'variants-seed', now: 1_000 },
      { engine: cast.engine, templates, ...extra },
    );
  }

  return { ...cast, templates, projectId, timelineIds, castId, base, plan };
}
