// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A crop rectangle in the upright (display-orientation) source frame: after
 * rotation, a front-camera mirror and the tone-map, before any scale. A screen
 * recording's reel rectangle is the use (templates' breakdown).
 */
import { err, ok, type Result } from '@taalcut/core';
import { fileParams, UnsupportedMedia } from '../errors';
import type { NormalisationPlan } from './types';

export interface GraphCrop {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The upright frame's size, or the crop's when there is one: what scaling starts from. */
export function uprightSource(
  plan: NormalisationPlan,
  crop?: GraphCrop,
): { readonly width: number; readonly height: number } {
  if (crop) return { width: crop.width, height: crop.height };
  return {
    width: Math.max(1, plan.source.displayWidth || plan.source.width),
    height: Math.max(1, plan.source.displayHeight || plan.source.height),
  };
}

/** `media.unsupported_media` unless the crop (when there is one) is even pixels inside the upright frame, ≥ 2×2. */
export function checkCrop(
  path: string,
  plan: NormalisationPlan,
  crop: GraphCrop | undefined,
): Result<GraphCrop | undefined> {
  if (!crop) return ok(undefined);
  const frame = uprightSource(plan);
  const values = [crop.x, crop.y, crop.width, crop.height];
  const whole = values.every((value) => Number.isInteger(value) && value % 2 === 0);
  const inside =
    crop.x >= 0 &&
    crop.y >= 0 &&
    crop.width >= 2 &&
    crop.height >= 2 &&
    crop.x + crop.width <= frame.width &&
    crop.y + crop.height <= frame.height;
  if (whole && inside) return ok(crop);
  const box = `${crop.width}x${crop.height}+${crop.x}+${crop.y}`;
  return err(
    UnsupportedMedia(fileParams(path), {
      detail: `crop ${box} is not even pixels inside the ${frame.width}x${frame.height} frame`,
    }),
  );
}

/** FFmpeg's `crop` for a checked rectangle; `exact` keeps an even x and y where the caller put them. */
export function cropFilter(crop: GraphCrop): string {
  return `crop=w=${crop.width}:h=${crop.height}:x=${crop.x}:y=${crop.y}:exact=1`;
}
