// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Variants of one cut from one request (P3-V3): the asked axes run in VARIANT_AXES order (hook, music, captions),
 * each varying the drafts the one before left. An axis that runs out keeps the set at what it made and is
 * reported as `variantsShort`; an axis that can't vary this base at all is skipped (reported too) so the others
 * still apply. Nothing varied: `timeline.variants_none`. Pure apart from the reads the axes make; the tool
 * creates the result in one `timeline.create`.
 */
import {
  err,
  ok,
  VARIANT_AXES,
  ValidationError,
  type AsyncResult,
  type CastId,
  type Timeline,
  type TimelineId,
  type VariantAxis as VariantAxisId,
  type VariantDifference,
  type VariantsShort,
} from '@taalcut/core';
import { VariantsNone } from '../errors';
import { derivedIds } from '../model/derived-ids';
import type { VariantAxis, VariantContext, VariantPlanRequest } from './axis';
import { VARIANT_AXIS_MODULES } from './axes';
import { variantDifference } from './differences';
import { asVariant } from './variant-identity';

/** How many variants one request makes (PRD G24). */
export const VARIANT_COUNT = { min: 2, max: 5 } as const;

export interface PlanVariantsInput extends VariantPlanRequest {
  readonly base: Timeline;
  /** One per variant, made by the caller (the tool: from its idempotency key). */
  readonly timelineIds: readonly TimelineId[];
  readonly castId: CastId;
  /** Names the items the variants get: one input plans the same variants every time. */
  readonly seed: string;
  readonly now: number;
}

export interface VariantPlan {
  readonly castId: CastId;
  readonly timelines: Timeline[];
  readonly differences: VariantDifference[];
  readonly variantsShort: VariantsShort | null;
}

function checkInput(input: PlanVariantsInput) {
  const { count } = input;
  if (!Number.isInteger(count) || count < VARIANT_COUNT.min || count > VARIANT_COUNT.max)
    return err(ValidationError({ field: 'count' }));
  if (input.axes.length === 0) return err(ValidationError({ field: 'axes' }));
  if (input.timelineIds.length < count) return err(ValidationError({ field: 'timelineIds' }));
  return ok(undefined);
}

export async function planVariants(
  input: PlanVariantsInput,
  context: Omit<VariantContext, 'ids'>,
  axes: Readonly<Record<VariantAxisId, VariantAxis>> = VARIANT_AXIS_MODULES,
): AsyncResult<VariantPlan> {
  const checked = checkInput(input);
  if (!checked.ok) return checked;
  const withIds: VariantContext = {
    ...context,
    ids: derivedIds<'TimelineItem'>(`${input.seed}:edits`, input.now),
  };
  let drafts: Timeline[] = Array.from({ length: input.count }, () => input.base);
  let short: VariantsShort | null = null;
  let varied = false;
  for (const id of VARIANT_AXES) {
    if (!input.axes.includes(id)) continue;
    const made = await axes[id].vary({ base: input.base, drafts, request: input }, withIds);
    if (!made.ok) return made;
    const count = Math.min(made.value.length, drafts.length);
    if (count < drafts.length && (!short || count < short.made))
      short = { axis: id, asked: input.count, made: count };
    if (count === 0) continue;
    drafts = made.value.slice(0, count);
    varied = true;
  }
  if (!varied) return err(VariantsNone());
  // checkInput made sure there is an id for every draft.
  const timelines = drafts.flatMap((draft, index) => {
    const timelineId = input.timelineIds[index];
    if (!timelineId) return [];
    const identity = {
      timelineId,
      baseName: input.base.name,
      castId: input.castId,
      index: index + 1,
      count: drafts.length,
      now: input.now,
    };
    return [asVariant(draft, identity, derivedIds<'TimelineItem'>(`${input.seed}:${index + 1}`, input.now))];
  });
  return ok({
    castId: input.castId,
    timelines,
    differences: timelines.map((timeline) => variantDifference(input.base, timeline)),
    variantsShort: short,
  });
}
