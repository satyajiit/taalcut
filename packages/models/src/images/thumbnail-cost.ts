// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { ok, type AsyncResult, type ThumbnailAspect, type ToolCostEstimate } from '@taalcut/core';
import { chainEstimate, refineImageCost } from './image-chain';
import type { GenerateThumbnailInput, ImageToolDeps } from './thumbnail-tool-io';

export function uniqueAspects(aspects: readonly ThumbnailAspect[] | undefined): ThumbnailAspect[] {
  const list = aspects && aspects.length > 0 ? aspects : (['16:9', '9:16'] as const);
  return [...new Set(list)].slice(0, 4);
}

export function estimateThumbnailCost(deps: ImageToolDeps, input: GenerateThumbnailInput): ToolCostEstimate {
  const aspects = uniqueAspects(input.aspects);
  const takes = (input.takes ?? 1) as 1 | 2 | 3 | 4;
  const totalImages = aspects.length * takes;
  const billed = { unit: 'image', quantity: totalImages } as const;
  if (!deps.selector || !deps.providers) {
    return { usd: Number((0.04 * totalImages).toFixed(4)), billed, basis: `${totalImages} thumbnail images` };
  }
  const perAspect = chainEstimate(deps, { size: 'final', count: takes });
  if (!perAspect) {
    return {
      usd: 0,
      billed,
      basis: 'No paid image price; credential refinement checks subscription allowance',
    };
  }
  const usd = Number((perAspect.usd * aspects.length).toFixed(6));
  const about = perAspect.estimated ? ' (token-priced, about)' : '';
  return {
    usd,
    billed,
    basis: `${totalImages} × ${perAspect.model} (${aspects.join(', ')})${about}`,
  };
}

export async function refineThumbnailCost(
  deps: ImageToolDeps,
  input: GenerateThumbnailInput,
  signal?: AbortSignal,
): AsyncResult<ToolCostEstimate> {
  const estimate = await refineImageCost(
    deps,
    { size: 'final', count: (input.takes ?? 1) as 1 | 2 | 3 | 4 },
    signal,
  );
  if (!estimate.ok) return estimate;
  const count = uniqueAspects(input.aspects).length;
  return ok({
    ...estimate.value,
    usd: estimate.value.usd * count,
    ...(estimate.value.billed
      ? { billed: { ...estimate.value.billed, quantity: estimate.value.billed.quantity * count } }
      : {}),
  });
}
